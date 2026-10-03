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
MA_PERIODS = (5, 9, 12, 20, 21, 50, 100, 200)

ISYATIRIM_MALITABLO_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)

_fundamentals_cache: dict[str, tuple[float, pd.Series]] = {}
_net_income_cache: dict[str, tuple[float, pd.Series]] = {}
# Seconds — quarterly data doesn't change more often than this.
# Saniye — çeyreklik veri bu kadar sık değişmiyor.
FUNDAMENTALS_CACHE_TTL = 3600
NET_INCOME_QUARTERS = 20


def _fetch_income_stmt_quarters(symbol: str, num_quarters: int = 12) -> pd.Series:
    """
    borsapy's get_income_stmt() guesses which quarter may have been published
    based on a FIXED month - it never checks whether data actually exists.
    So the same İş Yatırım endpoint is queried directly, stepping backwards
    from the ACTUAL current quarter.

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
            resp = httpx.get(ISYATIRIM_MALITABLO_URL, params=params, timeout=15)
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


def get_quarterly_net_income(symbol: str) -> pd.Series:
    """
    İş Yatırım reports year-to-date cumulative figures; the single quarter is
    obtained by subtracting the previous quarter. If the previous quarter is
    missing (e.g. the oldest Q4 in the series) the result is left as NaN —
    otherwise the annual total would be mistaken for a single quarter.
    Index format: "2026Q2".

    İş Yatırım yıl içi kümülatif veriyor; tek çeyreği bulmak için bir önceki
    çeyreği çıkarıyoruz. Önceki çeyrek eksikse (ör. serinin en eski Q4'ü)
    sonucu NaN bırakıyoruz — aksi halde yıllık toplam tek çeyrek sanılır.
    Index: "2026Q2" biçiminde.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _net_income_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    cumulative = _fetch_income_stmt_quarters(symbol, NET_INCOME_QUARTERS).sort_index()
    standalone = {}
    for col, value in cumulative.items():
        year, q = int(col[:4]), int(col[5:])
        if q == 1:
            standalone[col] = value
            continue
        prev = cumulative.get(f"{year}Q{q - 1}")
        standalone[col] = value - prev if prev is not None else np.nan

    result = pd.Series(standalone, dtype=float)
    _net_income_cache[symbol] = (now, result)
    return result


def get_ttm_eps(symbol: str) -> pd.Series:
    """
    TTM EPS = (net income of the last 4 actual quarters) / (current share count).
    Share count is computed directly from `get_company_metrics()` plus the
    cheap "last price" instead of `fast_info` — fast_info downloaded a full
    year of price history again just to compute 52-week high/low and moving
    averages that aren't used.

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
    # Basic quote only, cheap.
    # Sadece temel kotasyon, ucuz.
    last_price = ticker.info.get("last")

    if not metrics.get("market_cap") or not last_price:
        result = pd.Series(dtype=float)
        _fundamentals_cache[symbol] = (now, result)
        return result

    shares = metrics["market_cap"] / last_price

    standalone = get_quarterly_net_income(symbol)
    if standalone.empty:
        result = pd.Series(dtype=float)
        _fundamentals_cache[symbol] = (now, result)
        return result

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


def get_price_history(symbol: str, start: str, end: str) -> tuple[list[dict], bool, bool]:
    """
    Returns the rows plus two flags: "stale" when the last few candles are
    being refreshed in the background, and "history_pending" when the deep
    history is still being walked, so older bars may not be on disk yet. Both
    mean the caller should ask again shortly.

    Satırları ve iki bayrağı döner: "stale" son birkaç mumun arka planda
    tazelendiğini, "history_pending" derin geçmişin hâlâ yürünmekte olduğunu
    (yani eski barlar henüz diskte olmayabilir) söyler. İkisi de çağıranın kısa
    süre sonra tekrar sorması gerektiği anlamına gelir.
    """
    symbol = symbol.upper()

    requested_start = datetime.fromisoformat(start)
    buffered_start = requested_start - timedelta(days=max(BUFFER_DAYS, PE_YOY_BUFFER_DAYS))

    price_cache.ensure_cached(symbol)
    stale = price_cache.maybe_refresh_recent(symbol, end)
    history_pending = price_cache.history_pending(symbol)

    with ThreadPoolExecutor(max_workers=2) as executor:
        price_future = executor.submit(
            price_cache.query_range, symbol, buffered_start.strftime("%Y-%m-%d"), end
        )
        eps_future = executor.submit(get_ttm_eps, symbol)

        df = price_future.result()
        ttm_eps = eps_future.result()

    df = bp.add_indicators(df)
    for period in MA_PERIODS:
        df[f"SMA_{period}"] = df["Close"].rolling(period).mean()
        df[f"EMA_{period}"] = df["Close"].ewm(span=period, adjust=False).mean()
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

    return df.to_dict(orient="records"), stale, history_pending