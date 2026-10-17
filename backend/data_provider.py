import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import borsapy as bp
import pandas as pd
import numpy as np
import kap
import price_cache
from fundamentals import schema, statements

BUFFER_DAYS = 90
PE_YOY_BUFFER_DAYS = 400
MA_PERIODS = (5, 9, 12, 20, 21, 50, 100, 200)

_fundamentals_cache: dict[str, tuple[float, pd.Series]] = {}
_net_income_cache: dict[str, tuple[float, pd.Series]] = {}
# Seconds — quarterly data doesn't change more often than this.
# Saniye — çeyreklik veri bu kadar sık değişmiyor.
FUNDAMENTALS_CACHE_TTL = 3600
NET_INCOME_QUARTERS = 20


def get_quarterly_net_income(symbol: str) -> pd.Series:
    """
    Single-quarter net income attributable to the parent, as reported — no
    inflation restatement, so the chart's P/E keeps comparing a nominal price
    against nominal earnings. The real series lives in fundamentals.statements.
    Index format: "2026Q2".

    Ana ortaklığa ait tek çeyrek net kâr, raporlandığı gibi — enflasyon
    düzeltmesi yok, böylece grafiğin F/K'sı nominal fiyatı nominal kârla
    karşılaştırmaya devam ediyor. Reel seri fundamentals.statements içinde.
    Index: "2026Q2" biçiminde.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _net_income_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    periods = statements.quarterly(
        symbol, quarters=NET_INCOME_QUARTERS, real=False
    )["items"].get(schema.NET_INCOME, {}).get("periods", {})

    result = pd.Series(
        {period: (np.nan if value is None else value) for period, value in periods.items()},
        dtype=float,
    )
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
    ttm_eps = quarterly_eps.rolling(4).sum().dropna()

    result = _index_by_publication(symbol, ttm_eps)
    _fundamentals_cache[symbol] = (now, result)
    return result


def _index_by_publication(symbol: str, ttm_eps: pd.Series) -> pd.Series:
    """
    Moves a quarterly series from the quarter's end to the first session that
    could trade on it.

    Dating on the quarter's end instead gives every past P/E a figure the
    market had not seen yet — six weeks early typically, 134 days for BIMAS
    2023Q4 — so the line reacts before the news, in the direction the news
    turned out to be.

    A period KAP has no record of falls back to this symbol's own median lag,
    since a habitually late filer stays late. If KAP gave nothing at all the
    series is dropped rather than guessed.

    Çeyreklik seriyi dönem sonundan, üzerine işlem yapılabilen ilk seansa
    taşır.

    Dönem sonuna tarihlemek her geçmiş F/K'ya piyasanın o gün görmediği bir
    rakamı veriyor — tipik olarak altı hafta, BIMAS 2023Q4'te 134 gün önceden
    — yani çizgi haberden önce, haberin çıktığı yönde tepki veriyor.

    KAP'ta kaydı olmayan dönem sembolün kendi medyan gecikmesine düşüyor;
    alışkanlıkla geç veren şirket geç vermeye devam ediyor. KAP'tan hiçbir şey
    gelmediyse seri tahmin edilmek yerine bırakılıyor.
    """
    if ttm_eps.empty:
        return ttm_eps

    try:
        from_year = int(str(ttm_eps.index[0])[:4])
        published = {r["period"]: r["published"] for r in kap.financial_reports(symbol, from_year)}
    except Exception:
        published = {}
    if not published:
        return pd.Series(dtype=float)

    lags = [
        pd.Timestamp(when) - pd.Period(period, freq="Q").end_time.normalize()
        for period, when in published.items()
    ]
    median_lag = pd.Series(lags).median()

    dated = []
    for period, value in ttm_eps.items():
        when = published.get(period)
        if when is None:
            when = pd.Period(period, freq="Q").end_time.normalize() + median_lag
        dated.append((pd.Timestamp(kap.tradable_from(pd.Timestamp(when).to_pydatetime())), value))

    # A late filing can reach KAP after the next quarter's. Reading the series
    # in date order would then step back to the older figure, so a period is
    # kept only while it precedes every later one.
    # Geç verilen bir rapor sonraki çeyrekten sonra KAP'a düşebilir. Seriyi
    # tarih sırasıyla okumak o zaman eski rakama geri döner, bu yüzden bir
    # dönem ancak kendinden sonraki hepsinden önce geldiği sürece tutuluyor.
    kept = []
    floor = None
    for date, value in reversed(dated):
        if floor is None or date < floor:
            kept.append((date, value))
            floor = date

    kept.reverse()
    return pd.Series(
        [v for _, v in kept], index=pd.DatetimeIndex([d for d, _ in kept]), dtype=float
    )


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