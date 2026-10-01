"""
Psychological price levels (anchoring): round numbers and the 52-week high/low,
with how the stock behaved on past approaches to them.

Psikolojik fiyat seviyeleri (çapalama): yuvarlak sayılar ve 52 haftalık zirve/dip,
hissenin bu seviyelere geçmişteki yaklaşmalarda nasıl davrandığıyla birlikte.
"""

import math
import time
from datetime import datetime

import numpy as np
import pandas as pd

import price_cache

# An approach starts when price comes within this distance of the level.
# Fiyat seviyeye bu mesafe kadar yaklaşınca bir test başlar.
TOUCH_PCT = 0.01
# A close this far beyond the level within the horizon counts as a break.
# Süre içinde seviyenin bu kadar ötesinde kapanış kırılım sayılır.
BREAK_PCT = 0.02
HORIZON = 10
# Price must move this far from the level before a new approach counts.
# Yeni bir yaklaşmanın sayılması için fiyat seviyeden bu kadar uzaklaşmalı.
RESET_PCT = 0.04
# Round step is the nice number closest to this fraction of the price.
# Yuvarlak adım, fiyatın bu oranına en yakın "güzel" sayıdır.
STEP_FRACTION = 0.08
NICE_STEPS = (1.0, 2.5, 5.0)
NEAR_PCT = 0.15
# Control levels sit between round numbers, this far into the step.
# Kontrol seviyeleri yuvarlak sayıların arasında, adımın bu kadar içinde durur.
CONTROL_OFFSET = 0.4
YEAR_BARS = 252
FORWARD_BARS = 20
CACHE_TTL = 600

_cache: dict[str, tuple[float, dict]] = {}


def _step(price: float) -> float:
    target = price * STEP_FRACTION
    exp = math.floor(math.log10(target))
    candidates = [base * 10**e for e in (exp - 1, exp, exp + 1) for base in NICE_STEPS]
    return min(candidates, key=lambda s: abs(math.log(s / target)))


def _episodes(high: np.ndarray, low: np.ndarray, close: np.ndarray, level: np.ndarray, from_below: bool) -> list[tuple[int, bool | None]]:
    """
    Approaches to a level as (bar index, broke through); None while the outcome is pending.
    A new approach only counts after price has moved RESET_PCT away from the level.

    Bir seviyeye yaklaşmalar (bar indeksi, kırdı mı) olarak; sonuç belli değilse None.
    Yeni bir yaklaşma ancak fiyat seviyeden RESET_PCT kadar uzaklaştıktan sonra sayılır.
    """
    if from_below:
        armed = np.flatnonzero(close < level * (1 - RESET_PCT))
        touches = np.flatnonzero(high >= level * (1 - TOUCH_PCT))
    else:
        armed = np.flatnonzero(close > level * (1 + RESET_PCT))
        touches = np.flatnonzero(low <= level * (1 + TOUCH_PCT))

    episodes = []
    k = 0
    while k < len(armed):
        t = np.searchsorted(touches, armed[k], side="right")
        if t == len(touches):
            break
        i = int(touches[t])
        window = close[i : i + HORIZON + 1]
        if from_below:
            is_break = bool(np.any(window >= level[i] * (1 + BREAK_PCT)))
        else:
            is_break = bool(np.any(window <= level[i] * (1 - BREAK_PCT)))
        episodes.append((i, True if is_break else (False if len(window) == HORIZON + 1 else None)))
        k = np.searchsorted(armed, i, side="right")
    return episodes


def _tests(high: np.ndarray, low: np.ndarray, close: np.ndarray, level: np.ndarray, from_below: bool) -> dict:
    """
    Counts approaches to a level and whether price held (turned back) or broke through.

    Bir seviyeye yaklaşmaları ve fiyatın dönüp dönmediğini ya da kırıp kırmadığını sayar.
    """
    outcomes = [broke for _, broke in _episodes(high, low, close, level, from_below)]
    return {"held": outcomes.count(False), "broke": outcomes.count(True)}


def _add(a: dict, b: dict) -> dict:
    return {"held": a["held"] + b["held"], "broke": a["broke"] + b["broke"]}


def _round_grid(lo: float, hi: float) -> list[tuple[float, float]]:
    levels = []
    step = _step(lo)
    level = math.ceil(lo / step) * step
    while level <= hi:
        step = _step(level)
        levels.append((round(level, 6), step))
        level = (math.floor(level / step + 1e-9) + 1) * step
    return levels


def _extreme(df: pd.DataFrame, column: str, high: bool) -> dict:
    window = df[column].tail(YEAR_BARS)
    date = window.idxmax() if high else window.idxmin()
    return {"level": round(float(window[date]), 4), "date": date.strftime("%Y-%m-%d")}


def _arrays(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return tuple(df[c].to_numpy(dtype=float) for c in ("High", "Low", "Close"))


def level_stats(df: pd.DataFrame, level: float) -> dict:
    high, low, close = _arrays(df)
    arr = np.full(len(close), level)
    return {
        "resistance": _tests(high, low, close, arr, from_below=True),
        "support": _tests(high, low, close, arr, from_below=False),
    }


def round_effect(df: pd.DataFrame) -> dict:
    """
    Do round numbers hold more often than arbitrary levels in this stock?

    Bu hissede yuvarlak sayılar rastgele seviyelerden daha sık tutuyor mu?
    """
    empty = {"held": 0, "broke": 0}
    totals = {"round": empty, "control": empty}
    for level, step in _round_grid(float(df["Low"].min()), float(df["High"].max())):
        for key, value in (("round", level), ("control", level + step * CONTROL_OFFSET)):
            stats = level_stats(df, value)
            totals[key] = _add(totals[key], _add(stats["resistance"], stats["support"]))
    return totals


def extreme_tests(df: pd.DataFrame) -> tuple[dict, dict]:
    """
    Approaches to the prior 52-week high and low, excluding the current bar.

    Mevcut bar hariç önceki 52 haftalık zirve ve dibe yaklaşmalar.
    """
    high, low, close = _arrays(df)
    prior_high = df["High"].rolling(YEAR_BARS).max().shift(1).to_numpy()
    prior_low = df["Low"].rolling(YEAR_BARS).min().shift(1).to_numpy()
    v = ~np.isnan(prior_high)
    return (
        _tests(high[v], low[v], close[v], prior_high[v], from_below=True),
        _tests(high[v], low[v], close[v], prior_low[v], from_below=False),
    )


def high52_momentum(df: pd.DataFrame) -> dict:
    """
    How the stock behaves near its 52-week high: how often it broke the prior high
    and the average return FORWARD_BARS after an approach, plus today's distance to it.
    The baseline is the average FORWARD_BARS return from any day, since inflation alone lifts prices.

    Hissenin 52 haftalık zirve yakınındaki davranışı: önceki zirveyi ne sıklıkla kırdığı,
    yaklaşmadan FORWARD_BARS sonraki ortalama getiri ve bugün zirveye uzaklığı.
    Kıyas, herhangi bir günden FORWARD_BARS sonraki ortalama getiridir; enflasyon tek başına fiyatı yükseltir.
    """
    high, low, close = _arrays(df)
    prior_high = df["High"].rolling(YEAR_BARS).max().shift(1).to_numpy()
    v = np.flatnonzero(~np.isnan(prior_high))
    offset = int(v[0]) if len(v) else len(close)
    episodes = _episodes(high[offset:], low[offset:], close[offset:], prior_high[offset:], from_below=True)

    outcomes = [broke for _, broke in episodes if broke is not None]
    forward = [close[offset + i + FORWARD_BARS] / close[offset + i] - 1 for i, _ in episodes if offset + i + FORWARD_BARS < len(close)]
    tail = close[offset:]
    baseline = tail[FORWARD_BARS:] / tail[:-FORWARD_BARS] - 1 if len(tail) > FORWARD_BARS else np.array([])
    current_high = float(df["High"].tail(YEAR_BARS).max())
    return {
        "level": round(current_high, 4),
        "distancePct": round(float(close[-1] / current_high - 1) * 100, 2),
        "broke": outcomes.count(True),
        "tests": len(outcomes),
        "forwardPct": round(float(np.mean(forward)) * 100, 2) if forward else None,
        "forwardTests": len(forward),
        "baselinePct": round(float(np.mean(baseline)) * 100, 2) if len(baseline) else None,
    }


def get_anchors(symbol: str) -> dict:
    """
    The price cache is warmed by /api/price, which the frontend calls first.

    Fiyat önbelleğini frontend'in önce çağırdığı /api/price ısıtıyor.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _cache.get(symbol)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    df = price_cache.query_range(symbol, "1990-01-01", datetime.now().strftime("%Y-%m-%d"))
    df = df.dropna(subset=["High", "Low", "Close"])
    if len(df) < YEAR_BARS + HORIZON:
        return {"price": None, "round": [], "high52": None, "low52": None, "roundEffect": None}

    price = float(df["Close"].iloc[-1])
    round_levels = [
        {"level": level, "distancePct": round((level / price - 1) * 100, 2), **level_stats(df, level)}
        for level, _ in _round_grid(price * (1 - NEAR_PCT), price * (1 + NEAR_PCT))
    ]

    high_tests, low_tests = extreme_tests(df)
    high52 = _extreme(df, "High", high=True)
    low52 = _extreme(df, "Low", high=False)
    high52.update(distancePct=round((high52["level"] / price - 1) * 100, 2), **high_tests)
    low52.update(distancePct=round((low52["level"] / price - 1) * 100, 2), **low_tests)

    result = {
        "price": round(price, 4),
        "round": round_levels,
        "high52": high52,
        "low52": low52,
        "roundEffect": round_effect(df),
    }
    _cache[symbol] = (now, result)
    return result
