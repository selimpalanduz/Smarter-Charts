import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

TICKERS_PATH = Path(__file__).parent / "data" / "tickers.txt"
SCAN_LOOKBACK_DAYS = 40  # RVOL penceresi + biraz pay
RVOL_WINDOW = 20
SCAN_CACHE_TTL = 1800  # 30 dakika

_scan_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_KEY = "volume_scan"


def _load_tickers() -> list[str]:
    if not TICKERS_PATH.exists():
        raise FileNotFoundError(f"{TICKERS_PATH} bulunamadı")
    with open(TICKERS_PATH, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def _fetch_recent(symbol: str) -> pd.DataFrame | None:
    """
    Son SCAN_LOOKBACK_DAYS günü doğrudan borsapy'den çeker.
    price_cache.py'ye BİLİNÇLİ OLARAK dokunmuyoruz: oradaki ensure_cached()
    "sembol tabloda var mı" kontrolüyle çalışıyor, "tam geçmişi var mı" diye
    bakmıyor. Buraya kısmi veri yazmak, o sembol ileride chart'ta açıldığında
    tam backfill'in sessizce atlanmasına yol açar. O yüzden tarama tamamen
    ayrı, kendi başına bir fetch yolu kullanıyor.
    """
    start = (datetime.now() - timedelta(days=SCAN_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    try:
        df = bp.Ticker(symbol).history(start=start)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    return df


def _compute_rvol(symbol: str, df: pd.DataFrame, window: int = RVOL_WINDOW) -> dict | None:
    if len(df) < window + 1:
        return None
    df = df.sort_index()
    avg_volume = df["Volume"].rolling(window=window).mean()
    rvol = df["Volume"] / avg_volume
    last = df.iloc[-1]
    last_rvol = rvol.iloc[-1]
    if pd.isna(last_rvol):
        return None
    return {
        "Symbol": symbol,
        "Date": last.name.strftime("%Y-%m-%d"),
        "Close": round(float(last["Close"]), 2),
        "Volume": int(last["Volume"]),
        "RVOL": round(float(last_rvol), 2),
    }


def _run_scan() -> list[dict]:
    symbols = _load_tickers()
    results = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_fetch_recent, sym): sym for sym in symbols}
        for future, symbol in futures.items():
            df = future.result()
            if df is None:
                continue
            row = _compute_rvol(symbol, df)
            if row is not None:
                results.append(row)

    results.sort(key=lambda r: r["RVOL"], reverse=True)
    return results


def get_scan(force_refresh: bool = False) -> list[dict]:
    now = time.time()
    cached = _scan_cache.get(_CACHE_KEY)

    if not force_refresh and cached and (now - cached[0]) < SCAN_CACHE_TTL:
        return cached[1]

    results = _run_scan()
    _scan_cache[_CACHE_KEY] = (now, results)
    return results