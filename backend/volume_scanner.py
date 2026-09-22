import random
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

TICKERS_PATH = Path(__file__).parent / "data" / "tickers.txt"
SCAN_LOOKBACK_DAYS = 40
RVOL_WINDOW = 20
SCAN_CACHE_TTL = 1800

MAX_WORKERS = 5
REQUEST_DELAY = 0.3
MAX_RETRIES = 2
FETCH_HARD_TIMEOUT = 6.0
SCAN_OVERALL_DEADLINE = 120.0  # tüm tarama için üst sınır (saniye)

_scan_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_KEY = "volume_scan"


def _load_tickers() -> list[str]:
    if not TICKERS_PATH.exists():
        raise FileNotFoundError(f"{TICKERS_PATH} bulunamadı")
    with open(TICKERS_PATH, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def _fetch_once(symbol: str, start: str) -> tuple[pd.DataFrame | None, str]:
    """
    Tek bir deneme yapar, sonucu VE sebebini döner:
    ("timeout" | "rate_limit" | "empty" | "ok" | "error")
    Sadece "rate_limit" gerçekten tekrar denemeye değer — diğerleri
    (özellikle "empty") o sembolün zaten veri vermeyeceğini gösterir.
    """
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(lambda: bp.Ticker(symbol).history(start=start))
    try:
        df = future.result(timeout=FETCH_HARD_TIMEOUT)
    except FuturesTimeoutError:
        return None, "timeout"
    except Exception as e:
        if "429" in str(e):
            return None, "rate_limit"
        return None, "error"
    finally:
        executor.shutdown(wait=False)

    if df is None or df.empty:
        return None, "empty"
    return df, "ok"


def _fetch_recent(symbol: str) -> pd.DataFrame | None:
    start = (datetime.now() - timedelta(days=SCAN_LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    for attempt in range(MAX_RETRIES + 1):
        time.sleep(REQUEST_DELAY + random.uniform(0, 0.2))
        df, reason = _fetch_once(symbol, start)

        if reason == "ok":
            return df
        if reason != "rate_limit":
            # timeout / empty / error: tekrar denemeye değmez, bu sembolü geç
            return None
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
    deadline = time.time() + SCAN_OVERALL_DEADLINE

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_fetch_recent, sym): sym for sym in symbols}

        for future in as_completed(futures):
            symbol = futures[future]
            done += 1
            if done % 25 == 0 or done == total:
                print(f"[scan] {done}/{total} sembol işlendi")

            try:
                df = future.result()
            except Exception:
                df = None

            if df is not None:
                row = _compute_rvol(symbol, df)
                if row is not None:
                    results.append(row)

            if time.time() > deadline:
                print(f"[scan] süre doldu, {done}/{total} sembolle devam ediliyor")
                break

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