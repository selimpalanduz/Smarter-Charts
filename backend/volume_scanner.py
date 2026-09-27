"""Hacim anomalisi taraması.

Her sembol için ayrı ayrı geçmiş çekmek yerine TradingView screener'ına
tek bir istek atıyoruz: tüm BIST listesinin son hacmi ve 10 günlük
ortalama hacmi sunucu tarafında hesaplanmış olarak geliyor.
"""

import math
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import borsapy as bp
import pandas as pd

from sr_zones import find_sr_levels

TICKERS_PATH = Path(__file__).parent / "data" / "tickers.txt"
SCAN_CACHE_TTL = 300

BREAKOUT_MIN_RVOL = 2.0
BREAKOUT_MAX_CANDIDATES = 30
BREAKOUT_WORKERS = 4
HISTORY_CACHE_TTL = 3600

_scan_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_KEY = "volume_scan"
_history_cache: dict[str, tuple[float, pd.DataFrame]] = {}


def _load_tickers() -> list[str]:
    if not TICKERS_PATH.exists():
        raise FileNotFoundError(f"{TICKERS_PATH} bulunamadı")
    with open(TICKERS_PATH, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def _run_scan() -> list[dict]:
    symbols = _load_tickers()

    scanner = bp.TechnicalScanner()
    scanner.set_universe(symbols)
    scanner.add_condition("volume > 0")
    scanner.add_column("relative_volume_10d_calc")
    df = scanner.run(limit=len(symbols) + 50)

    results = []
    for row in df.itertuples(index=False):
        rvol = row.relative_volume_10d_calc
        if rvol is None or math.isnan(rvol):
            continue
        results.append(
            {
                "Symbol": row.symbol,
                "Close": round(float(row.close), 2),
                "Volume": int(row.volume),
                "RVOL": round(float(rvol), 2),
            }
        )

    print(f"[scan] {len(results)}/{len(symbols)} sembol sonuç verdi")
    results.sort(key=lambda r: r["RVOL"], reverse=True)
    _attach_breakouts(results)
    return results


def _get_year_history(symbol: str) -> pd.DataFrame | None:
    # SQLite önbelleğine yazmıyoruz: orada bir sembolün varlığı "tüm geçmiş
    # çekildi" anlamına geliyor, 1 yıllık kısmi veri o varsayımı bozar.
    now = time.time()
    cached = _history_cache.get(symbol)
    if cached and (now - cached[0]) < HISTORY_CACHE_TTL:
        return cached[1]
    try:
        df = bp.Ticker(symbol).history(period="1y")
    except Exception:
        return None
    if df is None or df.empty:
        return None
    _history_cache[symbol] = (now, df)
    return df


def _find_breakout(row: dict) -> float | None:
    """Son bardan önceki veriyle direnç bulur; son kapanış onu aştıysa seviyeyi döner."""
    df = _get_year_history(row["Symbol"])
    if df is None:
        return None
    last_day = df.index[-1].date()
    past = df[df.index.date < last_day]
    if len(past) < 30:
        return None

    resistances, _ = find_sr_levels(past)
    broken = [z for z in resistances if row["Close"] > z["max"]]
    if not broken:
        return None
    return round(max(z["mean"] for z in broken), 2)


def _attach_breakouts(results: list[dict]) -> None:
    candidates = [r for r in results if r["RVOL"] >= BREAKOUT_MIN_RVOL][:BREAKOUT_MAX_CANDIDATES]
    for r in results:
        r["Breakout"] = None

    with ThreadPoolExecutor(max_workers=BREAKOUT_WORKERS) as executor:
        for row, level in zip(candidates, executor.map(_find_breakout, candidates)):
            row["Breakout"] = level

    found = sum(1 for r in candidates if r["Breakout"] is not None)
    print(f"[scan] {len(candidates)} adaydan {found} tanesi direnç kırdı")


def get_scan(force_refresh: bool = False) -> list[dict]:
    now = time.time()
    cached = _scan_cache.get(_CACHE_KEY)

    if not force_refresh and cached and (now - cached[0]) < SCAN_CACHE_TTL:
        return cached[1]

    results = _run_scan()
    _scan_cache[_CACHE_KEY] = (now, results)
    return results
