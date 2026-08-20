from datetime import datetime, timedelta
import borsapy as bp
import httpx
import pandas as pd
import numpy as np

BUFFER_DAYS = 90
PE_YOY_BUFFER_DAYS = 400

ISYATIRIM_MALITABLO_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)


def _fetch_income_stmt_quarters(symbol: str, num_quarters: int = 40) -> pd.Series:
    """
    borsapy'nin get_income_stmt() fonksiyonu, hangi çeyreğin yayınlanmış
    olabileceğini SABİT bir aya göre tahmin ediyor (örn. "Ağustos'ta en
    son Q1 vardır" varsayımı) - gerçekte veri var mı diye hiç sormuyor.
    Bu yüzden THYAO'nun 2026Q2 raporu çoktan yayınlanmışken bile borsapy
    onu bize hiç getirmiyordu.

    Burada aynı İş Yatırım uç noktasına, ŞU ANKİ gerçek çeyrekten geriye
    doğru kendimiz soruyoruz - veri yoksa İş Yatırım zaten boş/0 döner,
    biz de onu (mevcut kodumuzdaki <=0 filtresiyle) zaten eliyoruz.
    """
    now = datetime.now()
    current_q = (now.month - 1) // 3 + 1

    periods = []
    year, q = now.year, current_q
    for _ in range(num_quarters):
        periods.append((year, q * 3))
        q -= 1
        if q == 0:
            q = 4
            year -= 1

    records: dict[str, dict[str, float]] = {}

    for batch_start in range(0, len(periods), 4):
        batch = periods[batch_start : batch_start + 4]
        params = {"companyCode": symbol.upper(), "exchange": "TRY", "financialGroup": "XI_29"}
        for i, (y, p) in enumerate(batch, 1):
            params[f"year{i}"] = y
            params[f"period{i}"] = p

        try:
            # verify=False: borsapy'nin kendisi de aynı domain için sertifika
            # doğrulamasını kapatıyor (BaseProvider'da görüldü), aynısını yapıyoruz.
            resp = httpx.get(ISYATIRIM_MALITABLO_URL, params=params, verify=False, timeout=15)
            items = resp.json().get("value", [])
        except Exception:
            continue

        for item in items:
            if not str(item.get("itemCode", "")).startswith("3Z"):
                continue  # sadece "Ana Ortaklık Payları" (3Z) satırını istiyoruz
            name = item.get("itemDescTr")
            if name != "Ana Ortaklık Payları":
                continue
            for i, (y, p) in enumerate(batch, 1):
                col = f"{y}Q{p // 3}"
                val = item.get(f"value{i}")
                if val is not None:
                    records.setdefault(name, {})[col] = float(val)

    if not records:
        return pd.Series(dtype=float)

    return pd.Series(records["Ana Ortaklık Payları"])


def get_ttm_eps(symbol: str) -> pd.Series:
    """
    TTM EPS = (son 4 gerçek çeyreğin net kârı) / (güncel hisse sayısı).
    İki bilinçli tasarım kararı:
    1) EPS'i borsapy'nin kendi (bozuk) alanından değil, "Ana Ortaklık
       Payları" net kâr rakamından kendimiz hesaplıyoruz.
    2) Bu net kâr rakamını borsapy'nin tarih tahminine güvenmeden,
       gerçek şu anki çeyrekten geriye doğru kendimiz çekiyoruz.
    """
    ticker = bp.Ticker(symbol.upper())
    shares = ticker.fast_info["market_cap"] / ticker.fast_info["last_price"]

    cumulative = _fetch_income_stmt_quarters(symbol)
    if cumulative.empty:
        return pd.Series(dtype=float)

    cumulative = cumulative.sort_index()
    years = [c[:4] for c in cumulative.index]
    quarters = [c[4:] for c in cumulative.index]

    standalone = cumulative.copy()
    for i in range(1, len(cumulative)):
        if years[i] == years[i - 1] and quarters[i] != "Q1":
            standalone.iloc[i] = cumulative.iloc[i] - cumulative.iloc[i - 1]

    quarterly_eps = standalone / shares
    ttm_eps = quarterly_eps.rolling(4).sum()

    dates = [pd.Period(col, freq="Q").end_time.normalize() for col in ttm_eps.index]
    ttm_eps.index = pd.DatetimeIndex(dates)

    return ttm_eps.dropna()


def attach_pe(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    try:
        ttm_eps = get_ttm_eps(symbol)
        if ttm_eps.empty:
            df["PE"] = None
            return df
    except Exception:
        df["PE"] = None
        return df

    df = df.sort_values("Date").copy()
    df["_date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).astype("datetime64[us]")

    ttm_eps_df = ttm_eps.reset_index()
    ttm_eps_df.columns = ["_date", "TTM_EPS"]
    ttm_eps_df["_date"] = pd.to_datetime(ttm_eps_df["_date"]).astype("datetime64[us]")

    df = pd.merge_asof(df, ttm_eps_df, on="_date", direction="backward")
    df["PE"] = df["Close"] / df["TTM_EPS"]
    df.loc[df["TTM_EPS"] <= 0, "PE"] = None
    df = df.drop(columns=["_date", "TTM_EPS"])
    return df


def attach_pe_yoy(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["_date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).astype("datetime64[us]")

    lookup = df[["_date", "PE"]].dropna(subset=["PE"]).copy()
    lookup["_date"] = lookup["_date"] + pd.DateOffset(years=1)
    lookup = lookup.rename(columns={"PE": "PE_PrevYear"}).sort_values("_date")

    df = pd.merge_asof(
        df.sort_values("_date"),
        lookup,
        on="_date",
        direction="backward",
        tolerance=pd.Timedelta(days=10),
    )
    df = df.drop(columns=["_date"])
    return df


def get_price_history(symbol: str, start: str, end: str) -> list[dict]:
    ticker = bp.Ticker(symbol.upper())

    requested_start = datetime.fromisoformat(start)
    buffered_start = requested_start - timedelta(days=max(BUFFER_DAYS, PE_YOY_BUFFER_DAYS))

    df = ticker.history(
        start=buffered_start.strftime("%Y-%m-%d"),
        end=end,
    )
    df = bp.add_indicators(df)
    df = df.reset_index()
    df.columns = [str(c) for c in df.columns]

    df = attach_pe(df, symbol)
    df = attach_pe_yoy(df)

    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records")