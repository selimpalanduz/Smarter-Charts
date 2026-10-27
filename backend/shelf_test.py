"""
Does a heavy shelf in the cost profile turn price back?

The claim being tested is the directional one: investors stuck above the
price sell at breakeven, so a heavy shelf ABOVE price should hold more
often than one BELOW it holds. A level that merely sees a lot of volume is
not enough -- that would be the old volume-profile claim, which failed.

Every level is computed from past bars only and tested on the bars after.
The control for a shelf is a thin bin at the same distance from price, so
the pair differs in volume and not in how far price has to travel.

Parameters are fixed here before any result is read. Nothing below is tuned.

Result, 28.10.2026, 86 symbols: nothing. A heavy shelf above price held 40.6%
of its approaches against 42.5% for a thin level at the same distance, and the
directional difference came to -0.99pp (p=0.51). The pairs are real -- the
shelf carries about three times the control's volume and sits within a
percentage point of its distance -- so the test had something to find and did
not find it. The resistance label stays off the chart.

Testin sonucu, 28.10.2026, 86 sembol: yok. Fiyatın üstündeki ağır raf
yaklaşmaların %40,6'sında tuttu, aynı mesafedeki ince seviye %42,5'inde;
yönlü fark -0,99 puan (p=0,51). Eşleşme gerçek -- raf kontrolün yaklaşık üç
katı hacim taşıyor ve mesafeleri bir puan içinde -- yani testin bulacak bir
şeyi vardı, bulamadı. Direnç etiketi grafiğe konmuyor.
"""

import math
import sqlite3
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).parent
sys.path.insert(0, str(BACKEND))

import anchors  # noqa: E402
import price_cache  # noqa: E402
from cost_profile import BINS, CLIP_HIGH, CLIP_LOW, _distribute  # noqa: E402

LOOKBACK_BARS = 500          # ~2 years of trading days, the window the chart shows
HALF_LIFE_BARS = 252         # old volume turns over; one year to half weight
STEP_BARS = 40               # walk-forward stride, as in the earlier S/R test
FORWARD_BARS = 120           # bars a level is given to be tested
MIN_DIST, MAX_DIST = 0.05, 0.25   # under 5% the episode logic cannot arm (RESET_PCT is 4%)
MATCH_TOL = 0.25             # control distance within +/-25% of the shelf's
CONTRAST = 0.5               # control must weigh at most half the shelf
MIN_EPISODES = 10            # per symbol and side, before its rate is used
SEED = 20261028


def profile(low, high, volume, close):
    """Decayed volume laid out by price, as (bin centers, weights)."""
    age = np.arange(len(volume))[::-1]
    weighted = volume * 0.5 ** (age / HALF_LIFE_BARS)
    floor = min(float(np.percentile(low, CLIP_LOW)), close)
    ceiling = max(float(np.percentile(high, CLIP_HIGH)), close)
    if not ceiling > floor:
        return None, None
    edges = np.linspace(floor, ceiling, BINS + 1)
    weight = _distribute(np.clip(low, floor, ceiling), np.clip(high, floor, ceiling), weighted, edges)
    if weight.sum() <= 0:
        return None, None
    centers = (edges[:-1] + edges[1:]) / 2
    return centers, weight


def pick_pair(centers, weight, close, above):
    """
    The heaviest bin on one side, and the thinnest bin at the same distance.
    None when no thin enough match sits at a comparable distance.
    """
    dist = centers / close - 1 if above else 1 - centers / close
    band = np.flatnonzero((dist >= MIN_DIST) & (dist <= MAX_DIST))
    if len(band) < 3:
        return None

    shelf = band[int(np.argmax(weight[band]))]
    target = dist[shelf]
    near = band[(dist[band] >= target * (1 - MATCH_TOL)) & (dist[band] <= target * (1 + MATCH_TOL))]
    near = near[near != shelf]
    if not len(near):
        return None

    control = near[int(np.argmin(weight[near]))]
    if weight[control] > weight[shelf] * CONTRAST:
        return None
    return float(centers[shelf]), float(centers[control])


def outcomes(high, low, close, level, above):
    """held, broke over the forward window, for one level."""
    arr = np.full(len(close), level)
    results = [broke for _, broke in anchors._episodes(high, low, close, arr, from_below=above)]
    return results.count(False), results.count(True)


def run(symbols, scramble):
    rng = np.random.default_rng(SEED)
    tally = {}
    for symbol in symbols:
        df = price_cache.query_range(symbol, "1990-01-01", "2026-12-31")
        df = df.dropna(subset=["High", "Low", "Close", "Volume"])
        df = df[(df["Volume"] > 0) & (df["High"] >= df["Low"])]
        if len(df) < LOOKBACK_BARS + FORWARD_BARS:
            continue

        h = df["High"].to_numpy(float)
        l = df["Low"].to_numpy(float)
        c = df["Close"].to_numpy(float)
        v = df["Volume"].to_numpy(float)
        if scramble:
            v = rng.permutation(v)

        counts = {(side, kind): [0, 0] for side in (True, False) for kind in ("shelf", "control")}
        for t in range(LOOKBACK_BARS, len(df) - FORWARD_BARS, STEP_BARS):
            past = slice(t - LOOKBACK_BARS, t)
            fwd = slice(t, t + FORWARD_BARS)
            centers, weight = profile(l[past], h[past], v[past], c[t - 1])
            if centers is None:
                continue
            for side in (True, False):
                pair = pick_pair(centers, weight, c[t - 1], above=side)
                if pair is None:
                    continue
                for kind, level in zip(("shelf", "control"), pair):
                    held, broke = outcomes(h[fwd], l[fwd], c[fwd], level, side)
                    counts[(side, kind)][0] += held
                    counts[(side, kind)][1] += broke
        tally[symbol] = counts
    return tally


def rate(pair):
    held, broke = pair
    total = held + broke
    return (held / total if total else None), total


def advantage(counts, side):
    """shelf hold rate minus control hold rate, or None if either side is thin."""
    s_rate, s_n = rate(counts[(side, "shelf")])
    c_rate, c_n = rate(counts[(side, "control")])
    if s_rate is None or c_rate is None or s_n < MIN_EPISODES or c_n < MIN_EPISODES:
        return None
    return s_rate - c_rate


def wilcoxon(x):
    """Signed-rank statistic as a normal approximation; ties get average ranks."""
    x = np.asarray([v for v in x if v != 0], dtype=float)
    n = len(x)
    if n < 6:
        return None
    order = np.argsort(np.abs(x))
    absx = np.abs(x)[order]
    adjusted = np.empty(n)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and absx[j + 1] == absx[i]:
            j += 1
        adjusted[i : j + 1] = np.mean(np.arange(i + 1, j + 2))
        i = j + 1
    ranks = np.empty(n)
    ranks[order] = adjusted
    w = float(np.sum(ranks[x > 0]))
    mean = n * (n + 1) / 4
    sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24)
    z = (w - mean) / sd
    p = math.erfc(abs(z) / math.sqrt(2))
    return z, p, n


def boot_ci(x, rng):
    x = np.asarray(x, dtype=float)
    draws = rng.choice(x, size=(4000, len(x)), replace=True).mean(axis=1)
    return float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))


def report(label, tally):
    rng = np.random.default_rng(SEED + 1)
    up, down, diff = [], [], []
    for counts in tally.values():
        a_up = advantage(counts, True)
        a_down = advantage(counts, False)
        if a_up is not None:
            up.append(a_up)
        if a_down is not None:
            down.append(a_down)
        if a_up is not None and a_down is not None:
            diff.append(a_up - a_down)

    print("\n--- %s ---" % label)
    for name, values in (("above (resistance)", up), ("below (support)", down), ("above minus below", diff)):
        if len(values) < 6:
            print("%-22s too few symbols (%d)" % (name, len(values)))
            continue
        lo, hi = boot_ci(values, rng)
        stat = wilcoxon(values)
        z, p, n = stat if stat else (float("nan"), float("nan"), len(values))
        print("%-22s n=%3d  mean=%+6.2fpp  CI=[%+6.2f,%+6.2f]  z=%+5.2f  p=%.4f"
              % (name, n, np.mean(values) * 100, lo * 100, hi * 100, z, p))
    return diff


def totals(tally):
    """Raw episode counts, so the rates above can be read against their size."""
    agg = {}
    for counts in tally.values():
        for key, (held, broke) in counts.items():
            a, b = agg.get(key, (0, 0))
            agg[key] = (a + held, b + broke)
    for side in (True, False):
        for kind in ("shelf", "control"):
            held, broke = agg[(side, kind)]
            total = held + broke
            label = ("above" if side else "below") + " " + kind
            print("%-16s episodes=%5d  held=%5.1f%%" % (label, total, 100 * held / total if total else 0))


if __name__ == "__main__":
    conn = sqlite3.connect(BACKEND / "data" / "prices.db")
    symbols = [s for (s,) in conn.execute("SELECT DISTINCT symbol FROM prices ORDER BY symbol") if s != "XU100"]
    conn.close()
    print("%d symbols" % len(symbols))

    real = run(symbols, scramble=False)
    totals(real)
    report("real volume", real)

    placebo = run(symbols, scramble=True)
    print()
    totals(placebo)
    report("placebo: volume shuffled across bars", placebo)
