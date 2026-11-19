"""
Volatility squeeze scan: stocks whose daily range has compressed while no trend
is running.

Two definitions, both from Stock Squeeze Hunter. The percentile one measures the
last three days' range against the range distribution of the twenty days before
them. The classic one is the usual TTM squeeze: the Bollinger band sitting
inside the Keltner channel.

Both are gated the same way -- ADX below 20 so no trend is running, RSI between
40 and 60 so momentum is neutral, and at least three squeeze days inside the
last thirty so a single quiet day does not count.

This module only says a stock is compressed. It makes no claim about what
happens next, and reports no hit rate, because nothing here has been measured
against a control.

Volatilite sıkışması taraması: trend yokken günlük aralığı daralmış hisseler.

İki tanım, ikisi de Stock Squeeze Hunter'dan. Persentil olanı son üç günün
aralığını, onlardan önceki yirmi günün aralık dağılımına göre ölçüyor. Klasik
olan her zamanki TTM sıkışması: Bollinger bandının Keltner kanalının içine
girmesi.

İkisinin kapıları aynı -- ADX 20'nin altında olsun ki trend yürümesin, RSI
40-60 arasında olsun ki momentum nötr kalsın, ve son otuz günde en az üç
sıkışma günü olsun ki tek bir sakin gün sayılmasın.

Bu modül yalnızca hissenin sıkıştığını söylüyor. Sonrasında ne olacağına dair
bir iddiası yok ve bir isabet oranı raporlamıyor, çünkü buradaki hiçbir şey bir
kontrol grubuna karşı ölçülmedi.
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd
from borsapy.technical import (
    calculate_adx,
    calculate_atr,
    calculate_bollinger_bands,
    calculate_rsi,
)

import price_cache
from volume_scanner import _load_tickers

RESULT_PATH = Path(__file__).parent / "data" / "squeeze_scan.json"

HISTORY_DAYS = 730
MIN_BARS = 60
WORKERS = 4

ADX_PERIOD = 14
RSI_PERIOD = 14
ATR_PERIOD = 14
BB_PERIOD = 20
KC_PERIOD = 20
KC_ATR_MULT = 1.5

# No trend running, and momentum neither way.
# Trend yürümüyor, momentum da iki yana değil.
ADX_MAX = 20.0
RSI_LOW = 40.0
RSI_HIGH = 60.0

# The compression window, and the baseline it is measured against.
# Sıkışma penceresi ve karşısında ölçüldüğü taban.
RANGE_WINDOW = 3
BASELINE_WINDOW = 20
DEFAULT_PERCENTILE = 0.25

# A single quiet day is noise; a month that holds several is the pattern.
# Tek sakin gün gürültüdür; birkaçını tutan bir ay örüntüdür.
RECENT_DAYS = 30
MIN_SQUEEZE_DAYS = 3

MODES = ("percentile", "classic")

_lock = threading.Lock()
_state = {"running": False, "done": 0, "total": 0, "failed": 0, "error": None}


def _history(symbol: str) -> pd.DataFrame | None:
    """
    Two years of bars, from the local cache when the symbol is in it. Only 108
    of the 563 are, since the cache fills from what has been charted, so the
    rest are fetched -- that is what makes a full scan take minutes.

    İki yıllık bar, sembol önbellekteyse oradan. 563'ün yalnız 108'i orada,
    çünkü önbellek grafiği açılanlarla doluyor; gerisi çekiliyor -- tam
    taramanın dakikalar sürmesinin sebebi bu.
    """
    start = (datetime.now() - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    df = price_cache.query_range(symbol, start, datetime.now().strftime("%Y-%m-%d"))
    if df is None or df.empty:
        try:
            df = bp.Ticker(symbol).history(start=start)
        except Exception:
            return None
    if df is None or df.empty:
        return None
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    df = df.dropna(subset=["High", "Low", "Close"])
    return df if len(df) >= MIN_BARS else None


def _with_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ADX"] = calculate_adx(out, ADX_PERIOD)
    out["RSI"] = calculate_rsi(out, RSI_PERIOD)
    out["ATR"] = calculate_atr(out, ATR_PERIOD)

    # The plain Bollinger band, SMA and standard deviation over the same window.
    # SSH mixed a 10-bar EMA with a 20-bar deviation, which is not the band the
    # Keltner comparison assumes.
    # Düz Bollinger bandı, SMA ve standart sapma aynı pencerede. SSH 10 barlık
    # EMA ile 20 barlık sapmayı karıştırmış, Keltner karşılaştırmasının
    # varsaydığı bant o değil.
    bands = calculate_bollinger_bands(out, BB_PERIOD)
    out["BB_Upper"] = bands["BB_Upper"]
    out["BB_Lower"] = bands["BB_Lower"]

    kc_mid = out["Close"].ewm(span=KC_PERIOD, adjust=False).mean()
    out["KC_Upper"] = kc_mid + KC_ATR_MULT * out["ATR"]
    out["KC_Lower"] = kc_mid - KC_ATR_MULT * out["ATR"]

    out["RANGE"] = out["High"] - out["Low"]
    out["RANGE_MEAN"] = out["RANGE"].rolling(RANGE_WINDOW).mean()
    return out.dropna(subset=["ADX", "RSI", "BB_Upper", "KC_Upper", "RANGE_MEAN"])


def _gates(df: pd.DataFrame) -> pd.Series:
    return (df["ADX"] < ADX_MAX) & df["RSI"].between(RSI_LOW, RSI_HIGH)


def _compressed(df: pd.DataFrame, mode: str, percentile: float) -> pd.Series:
    """
    The compression test on its own, one boolean per bar, gates not applied.

    Yalnız sıkışma testi, bar başına bir boolean; kapılar uygulanmadan.
    """
    if mode == "classic":
        return (df["BB_Upper"] < df["KC_Upper"]) & (df["BB_Lower"] > df["KC_Lower"])

    # The baseline is shifted off the window being judged, so the three days
    # under test are not part of the distribution they are compared with.
    # Taban, yargılanan pencerenin dışına kaydırılıyor; böylece test edilen üç
    # gün, karşılaştırıldıkları dağılımın parçası olmuyor.
    baseline = df["RANGE"].rolling(BASELINE_WINDOW).quantile(percentile).shift(RANGE_WINDOW)
    return df["RANGE_MEAN"] < baseline


def _tightness(df: pd.DataFrame) -> float | None:
    """
    Where the last three days' range sits in the twenty days before them, as a
    percentile. 0 is the tightest the stock has been in that span. This is the
    continuous reading behind the boolean, and what the list sorts on.

    Son üç günün aralığının, onlardan önceki yirmi gün içindeki yeri, persentil
    olarak. 0, hissenin o aralıktaki en sıkı hâli. Boolean'ın arkasındaki
    sürekli okuma bu, ve liste buna göre sıralanıyor.
    """
    if len(df) < RANGE_WINDOW + BASELINE_WINDOW:
        return None
    current = float(df["RANGE"].iloc[-RANGE_WINDOW:].mean())
    baseline = df["RANGE"].iloc[-(RANGE_WINDOW + BASELINE_WINDOW):-RANGE_WINDOW]
    if baseline.empty:
        return None
    return round(float((baseline < current).mean()) * 100, 1)


def _analyze(symbol: str, mode: str, percentile: float) -> dict | None:
    raw = _history(symbol)
    if raw is None:
        return None
    df = _with_indicators(raw)
    if df.empty or len(df) < RANGE_WINDOW + BASELINE_WINDOW:
        return None

    squeeze = _gates(df) & _compressed(df, mode, percentile)
    cutoff = pd.Timestamp(datetime.now().date()) - pd.Timedelta(days=RECENT_DAYS)
    days = int(squeeze.loc[df.index >= cutoff].sum())
    if days < MIN_SQUEEZE_DAYS:
        return None

    adx = float(df["ADX"].iloc[-1])
    rsi = float(df["RSI"].iloc[-1])
    return {
        "symbol": symbol,
        "close": round(float(df["Close"].iloc[-1]), 2),
        "adx": round(adx, 1),
        "rsi": round(rsi, 1),
        "squeezeDays": days,
        "squeezeNow": bool(squeeze.iloc[-1]),
        "tightness": _tightness(df),
        "lastSqueeze": squeeze[squeeze].index[-1].strftime("%Y-%m-%d") if squeeze.any() else None,
    }


def _run(mode: str, percentile: float) -> None:
    try:
        symbols = _load_tickers()
        _state.update(done=0, total=len(symbols), failed=0, error=None)

        def work(symbol: str) -> dict | None:
            try:
                return _analyze(symbol, mode, percentile)
            except Exception as e:
                print(f"[squeeze] {symbol}: {e}")
                with _lock:
                    _state["failed"] += 1
                return None
            finally:
                with _lock:
                    _state["done"] += 1

        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            results = [r for r in executor.map(work, symbols) if r]

        results.sort(key=lambda r: (not r["squeezeNow"], r["tightness"] if r["tightness"] is not None else 101))
        payload = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "mode": mode,
            "percentile": percentile,
            "results": results,
        }
        RESULT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        now = sum(1 for r in results if r["squeezeNow"])
        print(f"[squeeze] {len(results)}/{len(symbols)} sembol sıkışmada, {now} tanesi şu an, {_state['failed']} hata")
    except Exception as e:
        _state["error"] = str(e)
    finally:
        _state["running"] = False


def _saved() -> dict | None:
    if not RESULT_PATH.exists():
        return None
    return json.loads(RESULT_PATH.read_text(encoding="utf-8"))


def get_scan(start: bool = False, mode: str = "percentile", percentile: float = DEFAULT_PERCENTILE) -> dict:
    """
    Returns the saved scan and progress; starts a new one only when asked, never blocks.

    Kayıtlı taramayı ve ilerlemeyi döner; yenisini sadece istenirse başlatır, beklemez.
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if not 0 < percentile < 1:
        raise ValueError("percentile must be between 0 and 1")

    with _lock:
        if start and not _state["running"]:
            _state.update(running=True, done=0, total=0, failed=0, error=None)
            threading.Thread(target=_run, args=(mode, percentile), daemon=True).start()
        state = dict(_state)

    saved = _saved()
    return {
        **state,
        "updatedAt": saved["updatedAt"] if saved else None,
        "mode": saved["mode"] if saved else mode,
        "results": saved["results"] if saved else [],
    }


def status_for(symbol: str, mode: str = "percentile", percentile: float = DEFAULT_PERCENTILE) -> dict | None:
    """One symbol, for the chart rather than the scan list."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    raw = _history(symbol)
    if raw is None:
        return None
    df = _with_indicators(raw)
    if df.empty or len(df) < RANGE_WINDOW + BASELINE_WINDOW:
        return None

    squeeze = _gates(df) & _compressed(df, mode, percentile)
    cutoff = pd.Timestamp(datetime.now().date()) - pd.Timedelta(days=RECENT_DAYS)
    return {
        "symbol": symbol,
        "adx": round(float(df["ADX"].iloc[-1]), 1),
        "rsi": round(float(df["RSI"].iloc[-1]), 1),
        "squeezeNow": bool(squeeze.iloc[-1]),
        "squeezeDays": int(squeeze.loc[df.index >= cutoff].sum()),
        "tightness": _tightness(df),
        "bars": [
            {"date": d.strftime("%Y-%m-%d"), "squeeze": bool(v)}
            for d, v in squeeze.loc[df.index >= cutoff].items()
        ],
    }
