import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import borsapy as bp
import httpx
import pandas as pd
import numpy as np
import price_cache

BUFFER_DAYS = 90
PE_YOY_BUFFER_DAYS = 400

ISYATIRIM_MALITABLO_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)

_fundamentals_cache: dict[str, tuple[float, pd.Series]] = {}
FUNDAMENTALS_CACHE_TTL = 3600  # saniye — çeyreklik veri bu kadar sık değişmiyor


def _fetch_income_stmt_quarters(symbol: str, num_quarters: int = 12) -> pd.Series:
    """
    borsapy'nin get_income_stmt() fonksiyonu, hangi çeyreğin yayınlanmış
    olabileceğini SABİT bir aya göre tahmin ediyor - gerçekte veri var mı
    diye hiç sormuyor. Bu yüzden aynı İş Yatırım uç noktasına, ŞU ANKİ
    gerçek çeyrekten geriye doğru kendimiz soruyoruz.
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
            resp = httpx.get(ISYATIRIM_MALITABLO_URL, params=params, verify=False, timeout=15)
            items = resp.json().get("value", [])
        except Exception:
            continue

        for item in items:
            if not str(item.get("itemCode", "")).startswith("3Z"):
                continue
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
    Hisse sayısını `fast_info` yerine doğrudan `get_company_metrics()` +
    ucuz "last price" ile hesaplıyoruz — fast_info, kullanmadığımız 52
    haftalık yüksek/düşük ve hareketli ortalamaları hesaplamak için tam
    1 yıllık fiyat geçmişini gereksiz yere bir kez daha indiriyordu.
    """
    symbol = symbol.upper()
    now = time.time()

    cached = _fundamentals_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    ticker = bp.Ticker(symbol)
    metrics = ticker._get_isyatirim().get_company_metrics(symbol)
    last_price = ticker.info.get("last")  # sadece temel kotasyon, ucuz

    if not metrics.get("market_cap") or not last_price:
        result = pd.Series(dtype=float)
        _fundamentals_cache[symbol] = (now, result)
        return result

    shares = metrics["market_cap"] / last_price

    cumulative = _fetch_income_stmt_quarters(symbol)
    if cumulative.empty:
        result = pd.Series(dtype=float)
        _fundamentals_cache[symbol] = (now, result)
        return result

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

    result = ttm_eps.dropna()
    _fundamentals_cache[symbol] = (now, result)
    return result


def attach_pe_series(df: pd.DataFrame, ttm_eps: pd.Series) -> pd.DataFrame:
    if ttm_eps.empty:
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
    symbol = symbol.upper()

    requested_start = datetime.fromisoformat(start)
    buffered_start = requested_start - timedelta(days=max(BUFFER_DAYS, PE_YOY_BUFFER_DAYS))

    price_cache.ensure_cached(symbol)
    price_cache.maybe_refresh_recent(symbol, end)

    with ThreadPoolExecutor(max_workers=2) as executor:
        price_future = executor.submit(
            price_cache.query_range, symbol, buffered_start.strftime("%Y-%m-%d"), end
        )
        eps_future = executor.submit(get_ttm_eps, symbol)

        df = price_future.result()
        ttm_eps = eps_future.result()

    df = bp.add_indicators(df)
    df = df.reset_index()
    df.columns = [str(c) for c in df.columns]

    try:
        df = attach_pe_series(df, ttm_eps)
    except Exception:
        df["PE"] = None
    df = attach_pe_yoy(df)

    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records")