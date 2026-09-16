import random
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

TICKERS_PATH = Path(__file__).parent / "data" / "tickers.txt"
SCAN_LOOKBACK_DAYS = 40
RVOL_WINDOW = 20
SCAN_CACHE_TTL = 1800

MAX_WORKERS = 3
REQUEST_DELAY = 0.3
MAX_RETRIES = 2
FETCH_HARD_TIMEOUT = 8.0  # bir sembol için mutlak azami bekleme (saniye)

_scan_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_KEY = "volume_scan"


def _load_tickers() -> list[str]:
    if not TICKERS_PATH.exists():
        raise FileNotFoundError(f"{TICKERS_PATH} bulunamadı")
    with open(TICKERS_PATH, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def _fetch_once_with_hard_timeout(symbol: str, start: str) -> pd.DataFrame | None:
    """
    bp.Ticker(...).history() kendi içinde bir timeout sunmuyor — TradingView
    yanıt vermeden bağlantıyı açık tutarsa bu çağrı SONSUZA kadar bekleyebilir.
    Bunu kendi tek seferlik thread'inde çalıştırıp dışarıdan zaman sınırı
    koyuyoruz: süre dolarsa o thread'i (leaked de olsa) terk edip None
    dönüyoruz, ana worker havuzumuz asla kilitlenmiyor.
    """
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(lambda: bp.Ticker(symbol).history(start=start))
    try:
        return future.result(timeout=FETCH_HARD_TIMEOUT)
    except (FuturesTimeoutError, Exception):
        return None
    finally:
        executor.shutdown(wait=False)


def _fetch_recent(symbol: str) -> pd.DataFrame | None:
    start = (datetime.now() - timedelta(days=SCAN_LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    for attempt in range(MAX_RETRIES + 1):
        time.sleep(REQUEST_DELAY + random.uniform(0, 0.2))
        df = _fetch_once_with_hard_timeout(symbol, start)
        if df is not None and not df.empty:
            return df
        if attempt < MAX_RETRIES:
            time.sleep(2 ** (attempt + 1))
    return None


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
    total = len(symbols)
    done = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_fetch_recent, sym): sym for sym in symbols}
        for future, symbol in futures.items():
            df = future.result()  # artık sonsuza kadar bekleyemez, _fetch_recent kendi içinde sınırlı
            done += 1
            if done % 25 == 0 or done == total:
                print(f"[scan] {done}/{total} sembol işlendi")
            if df is None:
                continue
            row = _compute_rvol(symbol, df)
            if row is not None:
                results.append(row)

    print(f"[scan] tamamlandı: {len(results)}/{total} sembol sonuç verdi")
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