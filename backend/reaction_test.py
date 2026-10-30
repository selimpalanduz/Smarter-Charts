"""Is "this stock overreacts" a real property of the stock?

Two separate claims hide in idea 12, and the profile is only worth drawing
if the second one survives.

The pooled claim: after a sharp move, BIST stocks give part of it back (or
keep running). Tested across every symbol in the price cache, index-relative,
with one median per symbol so that a symbol with sixty sharp days does not
outvote one with twenty.

The persistence claim: a symbol's tendency is its own character, not a run
of coincidences. Tested by splitting each symbol's events in half by date and
asking whether the first half's giveback predicts the second's -- Spearman
across symbols, plus the plain out-of-sample question: take the third that
gave most back early, does it still give most back later?

Parameters are fixed here before any result is read. Nothing below is tuned.
Only sharp moves are tested, not earnings announcements: announcement dates
for 87 symbols mean 87 trips to KAP, and the move events are the ones the
chart marks anyway.

Result, 30.10.2026, 77 symbols, 3,130 sharp moves since 2015:

Pooled, nothing. The median symbol gave back 3% of its move over five
sessions and 6% over twenty, with 43 and 44 of 77 symbols on the giveback
side (p=0.36 and p=0.25). On this market and this sample a sharp move is not
systematically overdone in either direction.

Persistence, a hint and not a result. At twenty sessions a symbol's first
half of events ranked against its second half came to rho=+0.23 (p=0.061),
and the third that gave back most early went on to give back 28% of its move
later against the least third's -4%. The direction is the one the idea
predicts and the gap is wide, but it misses the 0.05 bar on a single run of
66 symbols; at five sessions there is nothing (rho=+0.10, p=0.44).

So the number on the chart is history, not a forecast: "sharp moves on this
stock drifted back this much over the following month, over this many
events". The widget labels a symbol's own tendency mixed unless its own sign
test clears 0.05 -- which at twenty-odd events almost nothing does -- and
this test is the reason the UI makes no character claim. Worth re-running
once the price cache holds all 550 symbols; 66 is thin for a rank test.

"Bu hisse asiri tepki veriyor" hissenin gercek bir ozelligi mi?

12. maddenin icinde iki ayri iddia var ve profil ancak ikincisi ayakta
kalirsa cizmeye deger.

Havuz iddiasi: sert hareketten sonra BIST hisseleri bir kismini geri veriyor
(ya da devam ediyor). Fiyat onbellegindeki her sembol uzerinde, endekse gore,
sembol basina tek medyanla test edildi; altmis sert gunu olan sembol yirmi
gunu olani ezmesin.

Kalicilik iddiasi: bir sembolun egilimi kendi karakteri, rastlantilar dizisi
degil. Her sembolun olaylari tarihe gore ikiye bolunup ilk yarinin geri
vermesi ikinciyi yordiyor mu diye bakildi -- semboller arasi Spearman, bir de
duz soru: erken donemde en cok geri veren ucte bir, sonra da en cok geri
veriyor mu?

Parametreler sonuclar okunmadan once burada sabitlendi. Asagida ayar yok.
Sadece sert hareketler test edildi, bilanco aciklamalari degil: 87 sembolun
aciklama tarihi 87 KAP istegi demek, ustelik grafigin isaretledigi olaylar
bunlar.

Sonuc, 30.10.2026, 77 sembol, 2015'ten beri 3.130 sert hareket:

Havuzda hicbir sey. Medyan sembol bes seansta hareketinin %3'unu, yirmi
seansta %6'sini geri verdi; 77 sembolun 43'u ve 44'u geri verme tarafinda
(p=0,36 ve p=0,25). Bu piyasada ve bu orneklemde sert hareket, iki yonde de
sistematik olarak asiri degil.

Kalicilik, sonuc degil ipucu. Yirmi seansta bir sembolun ilk yari olaylarinin
siralamasi ikinci yariya karsi rho=+0,23 (p=0,061) verdi; erken donemde en cok
geri veren ucte bir, sonrasinda hareketinin %28'ini geri verdi, en az veren
ucte bir ise -%4. Yon, maddenin ongordugu yon ve aradaki fark genis, ama 66
sembollu tek bir kosuda 0,05 esigini gecemiyor; bes seansta hicbir sey yok
(rho=+0,10, p=0,44).

Yani grafikteki sayi gecmis, ongoru degil: "bu hissenin sert hareketleri
sonraki ay boyunca su kadar geri suruklendi, su kadar olayda". Pencere,
sembolun kendi isaret testi 0,05'i gecmedikce egilimini karisik olarak
etiketliyor -- yirmi kusur olayda neredeyse hicbiri gecmiyor -- ve arayuzun
karakter iddiasi kurmamasinin sebebi bu test. Fiyat onbellegi 550 sembolun
tamamini tuttugunda yeniden kosulmaya deger; 66, siralama testi icin ince.
"""

import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest, spearmanr

BACKEND = Path(__file__).parent
sys.path.insert(0, str(BACKEND))

import price_cache  # noqa: E402
import reaction  # noqa: E402

START = "2015-01-01"        # deep enough for two halves, past the 2014 cache floor
MIN_BARS = 500              # a symbol needs real history before it has a character
MIN_EVENTS_HALF = 8         # same floor the profile uses, applied to each half
TERCILE = 3                 # thirds, for the out-of-sample ranking question
INDEX = reaction.INDEX_SYMBOL


def cached_symbols() -> list[str]:
    conn = sqlite3.connect(price_cache.DB_PATH)
    try:
        rows = conn.execute(
            "SELECT symbol, COUNT(*) FROM prices WHERE date >= ? GROUP BY symbol", (START,)
        ).fetchall()
    finally:
        conn.close()
    return sorted(s for s, n in rows if s != INDEX and n >= MIN_BARS)


def symbol_events(symbol: str, index_close: pd.Series) -> list[dict]:
    df = price_cache.query_range(symbol, START, pd.Timestamp.today().strftime("%Y-%m-%d"))
    if df.empty or len(df) < MIN_BARS:
        return []
    index = index_close.reindex(df.index).ffill().to_numpy(dtype=float)
    cutoff = df.index[0]
    return reaction.events(df, index, reaction.move_bars(df, cutoff), reaction.MIN_MOVE_PCT)


def giveback(events: list[dict], horizon: int) -> float | None:
    """Median follow-through over median move size, flipped so positive = gave back."""
    sized = [e for e in events if e["forward"][horizon] is not None]
    if len(sized) < MIN_EVENTS_HALF:
        return None
    follow = float(np.median([e["forward"][horizon] for e in sized]))
    size = float(np.median([abs(e["reaction"]) for e in sized]))
    return -follow / size if size else None


def main() -> None:
    symbols = cached_symbols()
    end = pd.Timestamp.today().strftime("%Y-%m-%d")
    price_cache.ensure_cached(INDEX)
    index_close = price_cache.query_range(INDEX, START, end)["Close"]

    per_symbol: dict[str, list[dict]] = {}
    for symbol in symbols:
        events = symbol_events(symbol, index_close)
        if events:
            per_symbol[symbol] = events

    total = sum(len(e) for e in per_symbol.values())
    print(f"{len(per_symbol)} symbols, {total} sharp moves since {START}\n")

    print("POOLED -- one median per symbol, sign test across symbols")
    for horizon in reaction.HORIZONS:
        values = [g for g in (giveback(e, horizon) for e in per_symbol.values()) if g is not None]
        gave_back = sum(1 for v in values if v > 0)
        p = binomtest(gave_back, len(values), 0.5).pvalue
        print(
            f"  {horizon:2d} sessions: median giveback {np.median(values):+.2f} "
            f"of the move, {gave_back}/{len(values)} symbols gave back, p={p:.3f}"
        )

    print("\nPERSISTENCE -- first half of a symbol's events vs its second half")
    for horizon in reaction.HORIZONS:
        pairs = []
        for events in per_symbol.values():
            half = len(events) // 2
            early, late = giveback(events[:half], horizon), giveback(events[half:], horizon)
            if early is not None and late is not None:
                pairs.append((early, late))
        if len(pairs) < TERCILE * 3:
            print(f"  {horizon:2d} sessions: only {len(pairs)} symbols qualify, not tested")
            continue
        early = np.array([p[0] for p in pairs])
        late = np.array([p[1] for p in pairs])
        rho, p = spearmanr(early, late)
        order = np.argsort(early)
        size = len(pairs) // TERCILE
        bottom, top = late[order[:size]], late[order[-size:]]
        print(
            f"  {horizon:2d} sessions: {len(pairs)} symbols, rho={rho:+.2f} (p={p:.3f}); "
            f"top third's later giveback {np.median(top):+.2f} vs bottom third's {np.median(bottom):+.2f}"
        )


if __name__ == "__main__":
    main()
