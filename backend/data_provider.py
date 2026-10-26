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
_bvps_cache: dict[str, tuple[float, pd.Series]] = {}
_pe_band_cache: dict[str, tuple[float, dict]] = {}
_pb_band_cache: dict[str, tuple[float, dict]] = {}
_net_income_cache: dict[str, tuple[float, pd.Series]] = {}
_equity_cache: dict[str, tuple[float, pd.Series]] = {}
_shares_cache: dict[str, tuple[float, float | None]] = {}
# Seconds — quarterly data doesn't change more often than this.
# Saniye — çeyreklik veri bu kadar sık değişmiyor.
FUNDAMENTALS_CACHE_TTL = 3600
# As deep as the statement store itself, so the P/E has the same history to
# be read against as every other line. Four of them go into the first
# trailing sum, leaving that many fewer points.
# Mali tablo deposu kadar derin, ki F/K da diğer her satırla aynı geçmişe
# karşı okunabilsin. İlk yıllık toplama dördü gittiği için o kadar az nokta
# kalıyor.
NET_INCOME_QUARTERS = statements.QUARTERS
EQUITY_QUARTERS = statements.QUARTERS


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
def _share_count(symbol: str) -> float | None:
    """
    Shares outstanding, as market cap over the last price.

    Read from `get_company_metrics()` plus the cheap "last price" instead of
    `fast_info` — fast_info downloaded a full year of price history again
    just to compute 52-week high/low and moving averages that aren't used.

    Today's count is the right one for every past bar as well, because the
    prices are bonus-adjusted: an adjusted price is the raw price divided by
    the same factor the bonus multiplied the share count by, so the two
    cancel and the product is the market capitalisation as it stood. Using
    the share count of the time instead would apply the adjustment twice.
    Checked on BIMAS (1:1 on 2026-05-14), FROTO (10x on 2025-05-07) and
    TUPRS (7x on 2023-04-04): the raw and adjusted series differ by exactly
    that factor. A capital increase for cash is not adjusted this way and
    stays a known error in the older bars of a symbol that held one.

    Hisse sayısı: piyasa değeri bölü son fiyat.

    `fast_info` yerine `get_company_metrics()` + ucuz "last price" ile
    okunuyor — fast_info, kullanmadığımız 52 haftalık yüksek/düşük ve
    hareketli ortalamaları hesaplamak için tam 1 yıllık fiyat geçmişini
    gereksiz yere bir kez daha indiriyordu.

    Güncel sayı geçmiş barlar için de doğru olanı, çünkü fiyatlar bedelsize
    göre düzeltilmiş: düzeltilmiş fiyat, ham fiyatın bedelsizin hisse
    sayısını çarptığı çarpana bölünmüş hâli; ikisi sadeleşiyor ve çarpım o
    günkü piyasa değerini veriyor. Onun yerine o günün hisse sayısını
    kullanmak düzeltmeyi iki kez uygulamak olurdu. BIMAS (14.05.2026 1'e 1),
    FROTO (07.05.2025 10 kat) ve TUPRS (04.04.2023 7 kat) üzerinde kontrol
    edildi: ham ve düzeltilmiş seri tam o çarpan kadar ayrışıyor. Bedelli
    sermaye artırımı bu şekilde düzeltilmiyor, yapan sembolün eski
    barlarında bilinen bir hata olarak kalıyor.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _shares_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    ticker = bp.Ticker(symbol)
    metrics = ticker._get_isyatirim().get_company_metrics(symbol)
    # Basic quote only, cheap.
    # Sadece temel kotasyon, ucuz.
    last_price = ticker.info.get("last")

    shares = None
    if metrics.get("market_cap") and last_price:
        shares = metrics["market_cap"] / last_price

    _shares_cache[symbol] = (now, shares)
    return shares


def get_quarterly_equity(symbol: str) -> pd.Series:
    """
    Equity attributable to the parent at each quarter's end, as reported —
    no inflation restatement, so a nominal price is held against a nominal
    book the same way the chart's P/E holds it against nominal earnings.

    A report that does not split the parent's share out falls back to total
    equity for that period; the two differ by the minority interests alone.
    Index format: "2026Q2".

    Ana ortaklığa ait özkaynağın çeyrek sonundaki hâli, raporlandığı gibi —
    enflasyon düzeltmesi yok; grafiğin F/K'sı nominal fiyatı nominal kârla
    nasıl karşılaştırıyorsa burada da nominal defter değeriyle
    karşılaştırılıyor.

    Ana ortaklık payını ayırmayan rapor o dönem için toplam özkaynağa
    düşüyor; ikisi yalnızca azınlık payları kadar ayrışıyor.
    Index: "2026Q2" biçiminde.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _equity_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    items = statements.quarterly(symbol, quarters=EQUITY_QUARTERS, real=False)["items"]
    parent = items.get(schema.EQUITY_PARENT, {}).get("periods", {})
    total = items.get(schema.EQUITY_TOTAL, {}).get("periods", {})

    merged = {}
    for period in sorted(set(parent) | set(total)):
        value = parent.get(period)
        if value is None:
            value = total.get(period)
        merged[period] = np.nan if value is None else value

    result = pd.Series(merged, dtype=float)
    _equity_cache[symbol] = (now, result)
    return result


def get_ttm_eps(symbol: str) -> pd.Series:
    """
    TTM EPS = (net income of the last 4 actual quarters) / (share count, see
    `_share_count`), dated from when each report reached the market.

    TTM EPS = (son 4 gerçek çeyreğin net kârı) / (hisse sayısı, bkz.
    `_share_count`), her raporun piyasaya ulaştığı günden tarihlenmiş.
    """
    symbol = symbol.upper()
    now = time.time()

    cached = _fundamentals_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    shares = _share_count(symbol)
    standalone = get_quarterly_net_income(symbol)

    if not shares or standalone.empty:
        result = pd.Series(dtype=float)
        _fundamentals_cache[symbol] = (now, result)
        return result

    quarterly_eps = standalone / shares
    ttm_eps = quarterly_eps.rolling(4).sum().dropna()

    result = _index_by_publication(symbol, ttm_eps)
    _fundamentals_cache[symbol] = (now, result)
    return result


def get_bvps(symbol: str) -> pd.Series:
    """
    Book value per share: the quarter's parent equity over the share count,
    dated from when the report reached the market.

    Equity is a snapshot, not a flow, so no trailing sum is taken. Where TTM
    EPS spends its first four quarters filling one window, book value starts
    at the store's first quarter — the P/B band reaches a year further back
    than the P/E band on the same symbol.

    Hisse başına defter değeri: çeyreğin ana ortaklık özkaynağı bölü hisse
    sayısı, raporun piyasaya ulaştığı günden tarihlenmiş.

    Özkaynak bir akış değil, fotoğraf; bu yüzden yıllık toplam alınmıyor.
    TTM EPS ilk dört çeyreği pencereyi doldurmakla geçirirken defter değeri
    deponun ilk çeyreğinden başlıyor — aynı sembolde PD/DD bandı F/K
    bandından bir yıl daha geriye uzanıyor.
    """
    symbol = symbol.upper()
    now = time.time()

    cached = _bvps_cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    shares = _share_count(symbol)
    equity = get_quarterly_equity(symbol).dropna()

    if not shares or equity.empty:
        result = pd.Series(dtype=float)
    else:
        result = _index_by_publication(symbol, equity / shares)

    _bvps_cache[symbol] = (now, result)
    return result


def _index_by_publication(symbol: str, values: pd.Series) -> pd.Series:
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
    if values.empty:
        return values

    try:
        from_year = int(str(values.index[0])[:4])
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
    for period, value in values.items():
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


def _attach_per_share(df: pd.DataFrame, per_share: pd.Series, column: str) -> pd.DataFrame:
    """
    The price over a per-share figure, the figure carried forward from its
    publication date to every bar until the next one. A denominator at or
    below zero leaves a gap: a multiple over negative earnings or negative
    equity is not a small number, it is no number.

    Fiyatın hisse başına bir rakama bölümü; rakam yayım gününden bir
    sonrakine kadarki her bara taşınıyor. Sıfır ya da altındaki payda boşluk
    bırakıyor: negatif kâra ya da negatif özkaynağa bölünen çarpan küçük bir
    sayı değil, hiçbir sayı değil.
    """
    if per_share.empty:
        df[column] = None
        return df

    df = df.sort_values("Date").copy()
    df["_date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).astype("datetime64[us]")

    per_share_df = per_share.reset_index()
    per_share_df.columns = ["_date", "_per_share"]
    per_share_df["_date"] = pd.to_datetime(per_share_df["_date"]).astype("datetime64[us]")

    df = pd.merge_asof(df, per_share_df, on="_date", direction="backward")
    df[column] = df["Close"] / df["_per_share"]
    df.loc[df["_per_share"] <= 0, column] = None
    df = df.drop(columns=["_date", "_per_share"])
    return df


def attach_pe_series(df: pd.DataFrame, ttm_eps: pd.Series) -> pd.DataFrame:
    return _attach_per_share(df, ttm_eps, "PE")


def attach_pb_series(df: pd.DataFrame, bvps: pd.Series) -> pd.DataFrame:
    return _attach_per_share(df, bvps, "PB")


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


# Below this many days a corridor describes the noise, not the history.
# Bu kadar günün altında koridor geçmişi değil gürültüyü anlatır.
BAND_MIN_DAYS = 250


def _valuation_band(
    symbol: str,
    cache: dict,
    per_share,
    column: str,
    missing: str,
) -> dict:
    """
    The machine behind `pe_band` and `pb_band`: a daily multiple reduced to
    percentiles, with today's reading and the share of the past below it.

    `per_share` is passed unevaluated so a cached answer costs no statement
    lookup at all.

    `pe_band` ve `pb_band`'in arkasındaki makine: günlük çarpanın
    yüzdeliklere indirgenmiş hâli, bugünkü okuma ve geçmişin ne kadarının
    onun altında kaldığı.

    `per_share` çağrılmadan geçiriliyor; böylece önbellekten dönen cevap
    hiçbir tablo sorgusuna mal olmuyor.
    """
    now = time.time()
    cached = cache.get(symbol)
    if cached and (now - cached[0]) < FUNDAMENTALS_CACHE_TTL:
        return cached[1]

    def answer(result: dict) -> dict:
        cache[symbol] = (now, result)
        return result

    series = per_share()
    if series.empty:
        return answer({"symbol": symbol, "supported": False, "reason": missing})

    df = price_cache.query_range(
        symbol, series.index[0].strftime("%Y-%m-%d"), datetime.now().strftime("%Y-%m-%d")
    )
    if df.empty:
        return answer({"symbol": symbol, "supported": False, "reason": "noPrices"})

    daily = _attach_per_share(df.reset_index(), series, column)
    daily = daily.set_index("Date")[column].dropna()
    if len(daily) < BAND_MIN_DAYS:
        return answer({"symbol": symbol, "supported": False, "reason": "tooShort"})

    value = float(daily.iloc[-1])
    below = int((daily < value).sum())

    return answer(
        {
            "symbol": symbol,
            "supported": True,
            "points": len(daily),
            "from": daily.index[0].strftime("%Y-%m-%d"),
            "to": daily.index[-1].strftime("%Y-%m-%d"),
            "low": float(daily.quantile(0.05)),
            "p25": float(daily.quantile(0.25)),
            "median": float(daily.median()),
            "p75": float(daily.quantile(0.75)),
            "high": float(daily.quantile(0.95)),
            "min": float(daily.min()),
            "max": float(daily.max()),
            "value": value,
            "percentile": round(below / (len(daily) - 1) * 100),
            "restatedFrom": _restated_from(symbol),
        }
    )


def pe_band(symbol: str) -> dict:
    """
    Where the P/E stands in its own history: the full daily series reduced to
    percentiles, plus today's value and the share of the past below it.

    The ends are the 5th and 95th percentile, not the lowest and highest
    reading, so that a single day cannot set the scale: a P/E explodes
    whenever trailing earnings pass near zero, and KCHOL tops out at 357
    that way. Where earnings stayed near zero for months the band is wide
    even so — KCHOL spent 257 days above its own third quartile in 2025 —
    and that width is the finding, not a defect: P/E is no yardstick for a
    company whose profit swings through zero. The true extremes are kept as
    `min` and `max`.

    One number alone says nothing — a P/E of 16 is cheap for one company and
    dear for another — and a peer group is a different argument. The symbol's
    own past is the comparison it can be held to.

    `restatedFrom` is the day the first inflation-accounted report reached the
    market. Before it, earnings carry no inflation adjustment at all, so the
    two halves of the corridor measure profit differently; the reader is told
    rather than left to assume one regime.

    F/K'nın kendi geçmişindeki yeri: günlük serinin yüzdeliklere indirgenmiş
    hâli, bugünkü değer ve geçmişin ne kadarının onun altında kaldığı.

    Uçlar en düşük ve en yüksek okuma değil, %5 ve %95 yüzdelikleri; tek bir
    gün ölçeği belirlemesin diye: son dört çeyreğin kârı sıfıra yaklaştığında
    F/K patlıyor, KCHOL'de 357'ye çıkıyor. Kârın aylarca sıfıra yakın kaldığı
    yerde bant buna rağmen geniş — KCHOL 2025'te 257 gün kendi üçüncü
    çeyreğinin üstünde kaldı — ve bu genişlik kusur değil, bulgunun kendisi:
    kârı sıfırın içinden geçen şirkette F/K bir ölçü değil. Gerçek uçlar
    `min` ve `max` olarak duruyor.

    Tek bir rakam hiçbir şey söylemiyor — 16 F/K bir şirket için ucuz,
    başkası için pahalı — emsal grubu ise başka bir tartışma. Sembolün
    hesap verebileceği karşılaştırma kendi geçmişi.

    `restatedFrom`, enflasyon muhasebeli ilk raporun piyasaya ulaştığı gün.
    Öncesinde kârlar hiç enflasyon düzeltmesi içermiyor, yani koridorun iki
    yarısı kârı farklı ölçüyor; okura tek bir rejim varsayması bırakılmıyor,
    söyleniyor.
    """
    symbol = symbol.upper()
    return _valuation_band(
        symbol, _pe_band_cache, lambda: get_ttm_eps(symbol), "PE", "noEarnings"
    )


def pb_band(symbol: str) -> dict:
    """
    Where the price-to-book stands in its own history, on the same machine
    as `pe_band` and answering in the same shape.

    Book value is where this reading earns its place beside P/E. Equity is a
    balance, not a flow: it does not pass through zero from one quarter to
    the next, so the corridor stays a corridor on exactly the companies
    whose P/E band is too wide to read. Where a trailing profit near zero
    throws the P/E to 357, book value moves by the quarter's earnings and
    little else.

    What it cannot survive is equity actually turning negative — then the
    day is dropped rather than drawn, the same as a loss-making quarter in
    the P/E series.

    `restatedFrom` matters more here than it does for earnings. Inflation
    accounting restates paid-in capital and the reserves along with it, so
    book value steps up at the changeover by far more than one quarter's
    profit; the corridor's two halves measure the denominator differently
    and the reader is told where the seam is.

    The known error is the same one the share count carries: a capital
    increase for cash is not price-adjusted, so a symbol that held one has
    wrong book value per share in the bars before it.

    PD/DD'nin kendi geçmişindeki yeri; `pe_band` ile aynı makine, aynı
    biçimde cevap veriyor.

    Defter değerinin F/K'nın yanında yer kazandığı nokta burası. Özkaynak
    bir akış değil bakiye: çeyrekten çeyreğe sıfırın içinden geçmiyor, yani
    koridor tam da F/K bandı okunamayacak kadar geniş olan şirketlerde
    koridor olarak kalıyor. Son dört çeyreğin kârı sıfıra yaklaşınca F/K
    357'ye fırlarken defter değeri o çeyreğin kârı kadar, bir de pek az
    şey kadar oynuyor.

    Kaldıramadığı şey özkaynağın gerçekten negatife dönmesi — o gün
    çizilmek yerine düşüyor, F/K serisindeki zarar çeyreği gibi.

    `restatedFrom` burada kârdakinden daha önemli. Enflasyon muhasebesi
    ödenmiş sermayeyi ve yanındaki yedekleri yeniden ifade ediyor, yani
    defter değeri geçişte bir çeyreğin kârından çok daha fazla yukarı
    sıçrıyor; koridorun iki yarısı paydayı farklı ölçüyor ve dikişin nerede
    olduğu okura söyleniyor.

    Bilinen hata hisse sayısının taşıdığıyla aynı: bedelli sermaye artırımı
    fiyata göre düzeltilmiyor, dolayısıyla bedelli yapan sembolün öncesindeki
    barlarında hisse başına defter değeri yanlış.
    """
    symbol = symbol.upper()
    return _valuation_band(
        symbol, _pb_band_cache, lambda: get_bvps(symbol), "PB", "noEquity"
    )


def _restated_from(symbol: str) -> str | None:
    """The first session that could trade on an inflation-accounted report."""
    try:
        reports = kap.financial_reports(symbol, _period_year(statements.TMS29_FROM))
    except Exception:
        return None
    first = next((r for r in reports if r["period"] >= statements.TMS29_FROM), None)
    return kap.tradable_from(first["published"]).isoformat() if first else None


def _period_year(period: str) -> int:
    return int(period[:4])


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

    with ThreadPoolExecutor(max_workers=3) as executor:
        price_future = executor.submit(
            price_cache.query_range, symbol, buffered_start.strftime("%Y-%m-%d"), end
        )
        eps_future = executor.submit(get_ttm_eps, symbol)
        bvps_future = executor.submit(get_bvps, symbol)

        df = price_future.result()
        ttm_eps = eps_future.result()
        bvps = bvps_future.result()

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

    try:
        df = attach_pb_series(df, bvps)
    except Exception:
        df["PB"] = None

    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records"), stale, history_pending