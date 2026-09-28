"""
Similar pattern search: past periods similar to the selection, by correlation of log closes.

Benzer formasyon arama: log kapanışların korelasyonuyla geçmişteki benzer dönemler.
"""

from datetime import datetime

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

import price_cache

MIN_BARS = 10
MAX_BARS = 300
TOP_MATCHES = 5
HORIZONS = (5, 20, 60)
FORWARD_BARS = max(HORIZONS)


def _pct(a: float, b: float) -> float:
    return round(float(b / a - 1) * 100, 2)


def _zscore_rows(windows: np.ndarray) -> np.ndarray:
    mean = windows.mean(axis=1, keepdims=True)
    std = windows.std(axis=1, keepdims=True)
    std[std == 0] = np.nan
    return (windows - mean) / std


def find_similar(symbol: str, start: str, end: str) -> dict:
    symbol = symbol.upper()
    price_cache.ensure_cached(symbol)
    df = price_cache.query_range(symbol, "1900-01-01", datetime.now().strftime("%Y-%m-%d"))
    if df.empty:
        raise ValueError("no_data")

    dates = df.index.strftime("%Y-%m-%d").to_numpy()
    closes = df["Close"].to_numpy(dtype=float)

    ps = int(np.searchsorted(dates, start))
    pe = int(np.searchsorted(dates, end, side="right")) - 1
    length = pe - ps + 1
    if length < MIN_BARS:
        raise ValueError("min_bars", MIN_BARS)
    if length > MAX_BARS:
        raise ValueError("max_bars", MAX_BARS)

    log_closes = np.log(closes)
    pattern = _zscore_rows(log_closes[ps : pe + 1][None, :])[0]
    windows = _zscore_rows(sliding_window_view(log_closes, length))
    corr = windows @ pattern / length

    starts = np.arange(len(corr))
    corr[np.abs(starts - ps) < length] = np.nan
    corr = np.nan_to_num(corr, nan=-np.inf)

    # Most similar non-overlapping windows
    # Birbiriyle çakışmayan en benzer pencereler
    chosen: list[int] = []
    for i in np.argsort(corr)[::-1]:
        if corr[i] == -np.inf:
            break
        if all(abs(i - c) >= length for c in chosen):
            chosen.append(int(i))
            if len(chosen) == TOP_MATCHES:
                break

    matches = []
    for i in chosen:
        me = i + length - 1
        base = closes[me]
        returns = {h: (_pct(base, closes[me + h]) if me + h < len(closes) else None) for h in HORIZONS}
        path_end = min(me + FORWARD_BARS, len(closes) - 1)
        matches.append(
            {
                "start": str(dates[i]),
                "end": str(dates[me]),
                "similarity": round(float(corr[i]) * 100, 1),
                "returns": returns,
                "path": [_pct(base, c) for c in closes[i : path_end + 1]],
            }
        )

    summary = {}
    for h in HORIZONS:
        values = [m["returns"][h] for m in matches if m["returns"][h] is not None]
        summary[h] = (
            {
                "avg": round(float(np.mean(values)), 2),
                "median": round(float(np.median(values)), 2),
                "up": int(sum(v > 0 for v in values)),
                "count": len(values),
            }
            if values
            else None
        )

    return {
        "symbol": symbol,
        "start": str(dates[ps]),
        "end": str(dates[pe]),
        "bars": length,
        "pattern": [_pct(closes[pe], c) for c in closes[ps : pe + 1]],
        "matches": matches,
        "summary": summary,
    }
