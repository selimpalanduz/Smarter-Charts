"""Does this stock give a sharp move back, or keep going?

The question is about character. Two stocks can both jump five percent on
news; one drifts back over the following month and the other keeps climbing.
Item 12 in the ideas file calls the first an overreaction and the second an
underreaction, and asks which one a given symbol tends to be.

The events are the ones already drawn on the chart: the sharp moves that
moves.py marks (same thresholds, imported from there, so the profile answers
for the markers the reader can see) and the financial-report announcements
that earnings.py marks, each attached to the first session that could trade
on it. The reaction is measured on the event day; what happens over the next
five and twenty sessions is the follow-through.

Everything is measured against XU100, because a stock that fell 3% while the
index fell 4% did not give anything back -- it outperformed. The forward
figure is the symbol's return minus the index's over the same sessions.

Signs are flipped so that both directions can be counted together: a figure
is positive when price kept going the way it moved and negative when it came
back. "Giveback" is the median follow-through as a share of the median event,
so 0.4 reads as "about two fifths of the move comes back within the window".

Four things to know before trusting it:

The sample is small. Five years leaves most symbols twenty to forty sharp
moves and a dozen announcements, so the share is reported with the count and
a sign-test p-value next to it, and fewer than eight events is reported
unsupported rather than drawn.

Sharp moves cluster -- a crash is often three sharp days in a row -- and
overlapping forward windows would be counted as independent evidence. Only
the first event of a cluster is kept, the rest are dropped.

Past character need not be future character. reaction_test.py checks whether
a symbol's tendency in one half of its history predicts the other half; read
its result before reading this as a forecast.

Prices are the local cache's, unadjusted for rights issues, so a capital
increase inside a window shows up as a giveback that never happened. Item 18
is the fix for that and is not in yet.

Bu hisse sert hareketi geri veriyor mu, devam mi ediyor?

Soru karakterle ilgili. Iki hisse de haberle %5 yukselebilir; biri sonraki ay
boyunca geri suruklenir, oteki yukselmeye devam eder. Fikirler dosyasindaki 12.
madde ilkine asiri tepki, ikincisine yetersiz tepki diyor ve bir hissenin
hangisi olmaya meyilli oldugunu soruyor.

Olaylar grafikte zaten cizili olanlar: moves.py'nin isaretledigi sert
hareketler (esikler oradan aliniyor, boylece profil okurun gorebildigi
isaretlerin cevabini veriyor) ve earnings.py'nin isaretledigi mali tablo
aciklamalari; her biri kendisiyle islem yapilabilecek ilk seansa bagli. Tepki
olay gununde olculuyor; sonraki bes ve yirmi seansta olan sey devami.

Her sey XU100'e karsi olculuyor, cunku endeks %4 duserken %3 dusen hisse bir
sey geri vermedi -- endeksi yendi. Ileri rakam, hissenin getirisi eksi ayni
seanslarda endeksin getirisi.

Iki yon birlikte sayilabilsin diye isaretler cevriliyor: rakam, fiyat hareket
ettigi yone devam ettiyse arti, geri donduyse eksi. "Geri verme", medyan
devamin medyan olaya orani; yani 0,4 "hareketin yaklasik beste ikisi pencere
icinde geri geliyor" diye okunuyor.

Guvenmeden once bilinmesi gereken dort sey:

Orneklem kucuk. Bes yil, cogu sembolde yirmi-kirk sert hareket ve bir duzine
aciklama birakiyor; o yuzden oran, sayisi ve yanindaki isaret testi p degeriyle
birlikte veriliyor, sekizden az olay cizilmek yerine desteklenmiyor olarak
bildiriliyor.

Sert hareketler kumeleniyor -- cokus genelde ust uste uc sert gundur -- ve
ust uste binen ileri pencereler bagimsiz kanit gibi sayilirdi. Kumenin sadece
ilk olayi tutuluyor, kalani dusuyor.

Gecmis karakter, gelecek karakter olmak zorunda degil. reaction_test.py bir
sembolun gecmisinin bir yarisindaki egiliminin oteki yarisini yordayip
yordamadigina bakiyor; bunu ongoru olarak okumadan once onun sonucunu oku.

Fiyatlar yerel onbellegin fiyatlari, bedelli icin duzeltilmemis; yani pencere
icine dusen bir sermaye artirimi, olmamis bir geri verme gibi gorunur. 18.
madde bunun duzeltmesi ve henuz girmedi.
"""

import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy.stats import binomtest

import kap
import price_cache
from moves import INDEX_SYMBOL, MIN_MOVE_PCT, VOL_MULTIPLE, VOL_WINDOW

LOOKBACK_YEARS = 5
# Sessions given to the follow-through; both are reported.
# Devama verilen seanslar; ikisi de bildiriliyor.
HORIZONS = (5, 20)
# Keep only the first event within this many sessions, so the forward windows
# of one episode are not counted as separate evidence.
# Bu kadar seans içindeki ilk olay tutulur; tek bir olayın ileri pencereleri
# ayrı kanıt sayılmasın.
CLUSTER_BARS = 5
# An announcement day that barely moved has no reaction to follow.
# Neredeyse hareket etmemiş bir açıklama gününün izlenecek tepkisi yok.
MIN_REACTION_PCT = 1.0
MIN_EVENTS = 8
CACHE_TTL = 3600

_cache: dict[str, tuple[float, dict]] = {}


def _rel_return(close: np.ndarray, index: np.ndarray, i: int, n: int) -> float | None:
    """The symbol's return over n sessions from bar i, minus the index's."""
    j = i + n
    if j >= len(close) or not close[i] or not index[i] or not index[j]:
        return None
    return float(((close[j] / close[i] - 1) - (index[j] / index[i] - 1)) * 100)


def move_bars(df: pd.DataFrame, cutoff: pd.Timestamp) -> list[int]:
    """Bar positions of the sharp moves moves.py would mark."""
    change = df["Close"].pct_change() * 100
    volatility = change.rolling(VOL_WINDOW).std().shift(1)
    is_move = (
        (change.abs() >= MIN_MOVE_PCT)
        & (change.abs() >= VOL_MULTIPLE * volatility)
        & (df.index >= cutoff)
    )
    return [int(i) for i in np.flatnonzero(is_move.to_numpy())]


def earnings_bars(symbol: str, df: pd.DataFrame, cutoff: pd.Timestamp) -> list[int]:
    """Bar positions of the first session that could trade on each report."""
    days = df.index.normalize().to_numpy()
    bars = []
    for report in kap.financial_reports(symbol, cutoff.year):
        day = np.datetime64(kap.tradable_from(report["published"]))
        i = int(np.searchsorted(days, day))
        if i and i < len(days) and days[i] >= np.datetime64(cutoff.date()):
            bars.append(i)
    return bars


def _declustered(bars: list[int]) -> list[int]:
    kept: list[int] = []
    for i in sorted(set(bars)):
        if not kept or i - kept[-1] > CLUSTER_BARS:
            kept.append(i)
    return kept


def events(df: pd.DataFrame, index: np.ndarray, bars: list[int], min_pct: float) -> list[dict]:
    """Each kept event as its day-0 index-relative reaction plus its follow-through."""
    close = df["Close"].to_numpy(dtype=float)
    out = []
    for i in _declustered(bars):
        if i < 1:
            continue
        reaction = _rel_return(close, index, i - 1, 1)
        if reaction is None or abs(reaction) < min_pct:
            continue
        direction = 1.0 if reaction > 0 else -1.0
        forward = {}
        for n in HORIZONS:
            value = _rel_return(close, index, i, n)
            # Signed so that positive means price kept going its way.
            # İşaret, artı "fiyat yoluna devam etti" anlamına gelecek şekilde.
            forward[n] = None if value is None else value * direction
        out.append(
            {
                "date": df.index[i].strftime("%Y-%m-%d"),
                "reaction": round(reaction, 2),
                "forward": {n: None if v is None else round(v, 2) for n, v in forward.items()},
            }
        )
    return out


def stats(kept: list[dict], horizon: int) -> dict:
    """What the events say at one horizon: share that came back, how much, and a sign test."""
    sized = [e for e in kept if e["forward"][horizon] is not None]
    if len(sized) < MIN_EVENTS:
        return {"events": len(sized), "supported": False}

    follow = np.array([e["forward"][horizon] for e in sized], dtype=float)
    sizes = np.abs(np.array([e["reaction"] for e in sized], dtype=float))
    reverted = int((follow < 0).sum())
    median_follow = float(np.median(follow))
    median_size = float(np.median(sizes))
    p = float(binomtest(reverted, len(sized), 0.5).pvalue)

    if p < 0.05:
        verdict = "reverts" if reverted * 2 > len(sized) else "continues"
    else:
        verdict = "mixed"

    return {
        "events": len(sized),
        "supported": True,
        # The count, not a share: at twenty events a percentage invents a
        # precision the sample does not have.
        # Oran değil sayı: yirmi olayda yüzde, örneklemde olmayan bir
        # hassasiyet uyduruyor.
        "reverted": reverted,
        "medianFollow": round(median_follow, 2),
        "medianMove": round(median_size, 2),
        "giveback": round(-median_follow / median_size, 2) if median_size else None,
        "p": round(p, 3),
        "verdict": verdict,
    }


def frames(symbol: str, start: str, end: str) -> tuple[pd.DataFrame, np.ndarray] | tuple[None, None]:
    """The symbol's bars and XU100's closes laid onto the same sessions."""
    df = price_cache.query_range(symbol, start, end)
    if df.empty:
        return None, None
    price_cache.ensure_cached(INDEX_SYMBOL)
    price_cache.maybe_refresh_recent(INDEX_SYMBOL, end)
    index_close = price_cache.query_range(INDEX_SYMBOL, start, end)["Close"]
    return df, index_close.reindex(df.index).ffill().to_numpy(dtype=float)


def reaction_profile(symbol: str) -> dict:
    """Whether the symbol's sharp moves and earnings reactions came back or ran on."""
    symbol = symbol.upper()
    now = time.time()
    cached = _cache.get(symbol)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    today = datetime.now()
    cutoff = pd.Timestamp((today - timedelta(days=365 * LOOKBACK_YEARS)).date())
    start = (cutoff - timedelta(days=VOL_WINDOW * 2)).strftime("%Y-%m-%d")

    df, index = frames(symbol, start, today.strftime("%Y-%m-%d"))
    if df is None:
        return {"symbol": symbol, "supported": False, "reason": "noPrices"}

    kinds = {"moves": events(df, index, move_bars(df, cutoff), MIN_MOVE_PCT)}
    try:
        kinds["earnings"] = events(df, index, earnings_bars(symbol, df, cutoff), MIN_REACTION_PCT)
    except Exception:
        # Without KAP the sharp moves still answer the question; the
        # announcements are the part that needs the network.
        # KAP olmadan sert hareketler soruyu yine cevaplıyor; ağa ihtiyacı
        # olan kısım açıklamalar.
        kinds["earnings"] = []

    result = {
        "symbol": symbol,
        "supported": True,
        "years": LOOKBACK_YEARS,
        "horizons": [str(n) for n in HORIZONS],
        "against": INDEX_SYMBOL,
        **{
            kind: {
                "horizons": {str(n): stats(kept, n) for n in HORIZONS},
                "recent": kept[-8:][::-1],
            }
            for kind, kept in kinds.items()
        },
    }
    _cache[symbol] = (now, result)
    return result
