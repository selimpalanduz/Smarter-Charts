"""
Scans the BIST list for stocks whose investors respect round numbers the most.
Fetching every symbol takes minutes, so the scan runs in a background thread
and its result is saved to disk.

BIST listesinde yatırımcıları yuvarlak sayılara en çok uyan hisseleri tarar.
Tüm sembolleri çekmek dakikalar sürdüğü için tarama arka plan thread'inde
çalışır ve sonucu diske kaydedilir.
"""

import json
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

import anchors
import price_cache
from volume_scanner import _load_tickers

RESULT_PATH = Path(__file__).parent / "data" / "anchor_scan.json"
# Round numbers use the last 3 years; the 52-week high needs more, since its first year only builds the level.
# Yuvarlak sayılar son 3 yılı kullanır; 52 haftalık zirveye daha fazlası gerekir, ilk yıl sadece seviyeyi oluşturur.
ROUND_YEARS = 3
HIGH52_YEARS = 5
WORKERS = 4
# Fewer approaches than this on either side make the comparison meaningless.
# Herhangi bir tarafta bundan az yaklaşma karşılaştırmayı anlamsız kılar.
MIN_TESTS = 15

_lock = threading.Lock()
_state = {"running": False, "done": 0, "total": 0, "failed": 0, "error": None}


def _history(symbol: str, start: str) -> pd.DataFrame | None:
    # Symbols already in the price cache need no request.
    # Fiyat önbelleğinde olan semboller için istek gerekmez.
    df = price_cache.query_range(symbol, start, datetime.now().strftime("%Y-%m-%d"))
    if df.empty:
        df = bp.Ticker(symbol).history(start=start)
    if df is None or df.empty:
        return None
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    return df.dropna(subset=["High", "Low", "Close"])


def _rate(s: dict) -> float | None:
    total = s["held"] + s["broke"]
    return s["held"] / total if total else None


def _z_score(a: dict, b: dict) -> float:
    """
    Two-proportion z-score: how unlikely the gap is if round numbers had no effect.

    İki oran z-skoru: yuvarlak sayıların etkisi olmasaydı bu farkın ne kadar olası olmadığı.
    """
    n1, n2 = a["held"] + a["broke"], b["held"] + b["broke"]
    pooled = (a["held"] + b["held"]) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    return (_rate(a) - _rate(b)) / se if se else 0.0


def _round_stats(df: pd.DataFrame) -> dict | None:
    effect = anchors.round_effect(df)
    r, c = effect["round"], effect["control"]
    if r["held"] + r["broke"] < MIN_TESTS or c["held"] + c["broke"] < MIN_TESTS:
        return None
    return {
        "roundRate": round(_rate(r) * 100, 1),
        "controlRate": round(_rate(c) * 100, 1),
        "edge": round((_rate(r) - _rate(c)) * 100, 1),
        "z": round(_z_score(r, c), 2),
        "tests": r["held"] + r["broke"],
    }


def _analyze(symbol: str) -> dict | None:
    now = datetime.now()
    df = _history(symbol, (now - timedelta(days=365 * HIGH52_YEARS)).strftime("%Y-%m-%d"))
    if df is None or len(df) < anchors.YEAR_BARS + anchors.HORIZON:
        return None

    recent = df[df.index >= pd.Timestamp(now - timedelta(days=365 * ROUND_YEARS))]
    return {
        "symbol": symbol,
        "close": round(float(df["Close"].iloc[-1]), 2),
        "round": _round_stats(recent),
        "high52": anchors.high52_momentum(df),
    }


def _run() -> None:
    try:
        symbols = _load_tickers()
        _state.update(done=0, total=len(symbols), failed=0, error=None)

        def work(symbol: str) -> dict | None:
            try:
                return _analyze(symbol)
            except Exception as e:
                print(f"[anchor-scan] {symbol}: {e}")
                with _lock:
                    _state["failed"] += 1
                return None
            finally:
                with _lock:
                    _state["done"] += 1

        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            results = [r for r in executor.map(work, symbols) if r]

        payload = {"updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"), "results": results}
        RESULT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"[anchor-scan] {len(results)}/{len(symbols)} sembol sonuç verdi, {_state['failed']} hata")
    except Exception as e:
        _state["error"] = str(e)
    finally:
        _state["running"] = False


def _saved() -> dict | None:
    if not RESULT_PATH.exists():
        return None
    return json.loads(RESULT_PATH.read_text(encoding="utf-8"))


def get_scan(start: bool = False) -> dict:
    """
    Returns the saved scan and progress; starts a new scan only when asked, never blocks.

    Kayıtlı taramayı ve ilerlemeyi döner; yeni taramayı sadece istenirse başlatır, beklemez.
    """
    with _lock:
        if start and not _state["running"]:
            _state.update(running=True, done=0, total=0, failed=0, error=None)
            threading.Thread(target=_run, daemon=True).start()
        state = dict(_state)

    saved = _saved()
    return {
        **state,
        "updatedAt": saved["updatedAt"] if saved else None,
        "results": saved["results"] if saved else [],
    }
