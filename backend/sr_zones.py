"""Support/resistance zone detection.

Only clear swing highs/lows count: a pivot must stand out by at least
PIVOT_PROMINENCE_ATR times the average true range. Pivots within ZONE_SPAN_ATR
of each other form a zone; a zone is kept if it was touched at least twice,
comes from one major or recent swing, or is the window high/low. Stronger zones
suppress weaker ones within MIN_SEPARATION_ATR, and only the nearest few on each
side are returned so the chart stays readable.

Out-of-sample tests on BIST daily data showed no horizontal level method holds
price more often than random levels, so these zones are a visual reference only.

Destek/direnç zone tespiti.

Sadece belirgin dönüş noktaları sayılır: bir pivot ortalama gerçek aralığın
(ATR) en az PIVOT_PROMINENCE_ATR katı kadar öne çıkmalı. Birbirine ZONE_SPAN_ATR
içinde olan pivotlar bir zone oluşturur; zone en az iki kez test edildiyse,
tek bir büyük ya da yakın tarihli dönüşten geliyorsa veya pencerenin zirve/dibiyse tutulur. Güçlü
zone'lar MIN_SEPARATION_ATR içindeki zayıfları bastırır ve grafik okunur kalsın diye
her yönde sadece en yakın birkaç zone döner.

BIST günlük verisindeki örneklem dışı testlerde hiçbir yatay seviye yöntemi
fiyatı rastgele seviyelerden daha sık tutmadı; bu zone'lar sadece görsel referanstır.
"""

import math
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy.signal import find_peaks

import price_cache

LOOKBACK_DAYS = 730
ATR_PERIOD = 14
PIVOT_DISTANCE = 5
PIVOT_PROMINENCE_ATR = 1.0
# A single swing this prominent, or this recent, is a level on its own.
# Bu kadar belirgin ya da yakın tarihli tek bir dönüş tek başına seviyedir.
MAJOR_PROMINENCE_ATR = 4.0
RECENT_BARS = 60
ZONE_SPAN_ATR = 1.0
MIN_SEPARATION_ATR = 1.5
MIN_HALF_WIDTH_ATR = 0.25
MIN_TOUCHES = 2
MAX_PER_SIDE = 4


def _atr_pct(df: pd.DataFrame) -> float:
    """
    Median ATR as a fraction of price. Everything is measured in log price so a
    stock that multiplied over the window is judged the same at every price level.

    Fiyatın oranı olarak medyan ATR. Her şey log fiyatta ölçülür; böylece pencere
    boyunca katlanan bir hisse her fiyat seviyesinde aynı ölçüyle değerlendirilir.
    """
    prev_close = df["Close"].shift(1)
    true_range = pd.concat(
        [df["High"] - df["Low"], (df["High"] - prev_close).abs(), (df["Low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    return float((true_range.rolling(ATR_PERIOD).mean() / df["Close"]).median())


def _pivots(log_high: np.ndarray, log_low: np.ndarray, atr: float) -> list[tuple[float, float, int]]:
    """
    Swing highs and lows as (log price, prominence in ATR, bar index), plus the window extremes.

    Dönüş tepeleri ve dipleri (log fiyat, ATR cinsinden belirginlik, bar indeksi) olarak; artı pencerenin uç noktaları.
    """
    min_prominence = atr * PIVOT_PROMINENCE_ATR
    hi_idx, hi_props = find_peaks(log_high, distance=PIVOT_DISTANCE, prominence=min_prominence)
    lo_idx, lo_props = find_peaks(-log_low, distance=PIVOT_DISTANCE, prominence=min_prominence)
    pivots = [(log_high[i], p / atr, int(i)) for i, p in zip(hi_idx, hi_props["prominences"])]
    pivots += [(log_low[i], p / atr, int(i)) for i, p in zip(lo_idx, lo_props["prominences"])]

    # find_peaks skips the edges, where the extremes may sit.
    # find_peaks kenarları atlıyor, uç noktalar orada olabilir.
    for values in (log_high, -log_low):
        i = int(values.argmax())
        if not any(idx == i for _, _, idx in pivots):
            pivots.append((abs(values[i]), MAJOR_PROMINENCE_ATR, i))
    return sorted(pivots)


def _cluster(pivots: list[tuple[float, float, int]], span: float) -> list[list[tuple[float, float, int]]]:
    groups: list[list[tuple[float, float, int]]] = []
    for pivot in pivots:
        if groups and pivot[0] - groups[-1][0][0] <= span:
            groups[-1].append(pivot)
        else:
            groups.append([pivot])
    return groups


def find_sr_levels(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    if df is None or len(df) < ATR_PERIOD * 2:
        return [], []

    atr = _atr_pct(df)
    if not atr or np.isnan(atr):
        return [], []

    log_high = np.log(df["High"].to_numpy(dtype=float))
    log_low = np.log(df["Low"].to_numpy(dtype=float))
    current = math.log(float(df["Close"].iloc[-1]))
    extremes = {log_high.max(), log_low.min()}

    recent_start = len(df) - RECENT_BARS
    zones = []
    for group in _cluster(_pivots(log_high, log_low, atr), atr * ZONE_SPAN_ATR):
        levels = [p for p, _, _ in group]
        is_extreme = any(p in extremes for p in levels)
        is_major = max(s for _, s, _ in group) >= MAJOR_PROMINENCE_ATR
        is_recent = max(i for _, _, i in group) >= recent_start
        if len(group) < MIN_TOUCHES and not (is_major or is_recent or is_extreme):
            continue
        mean = float(np.mean(levels))
        half = atr * MIN_HALF_WIDTH_ATR
        zones.append(
            {
                "lo": min(min(levels), mean - half),
                "hi": max(max(levels), mean + half),
                "mean": mean,
                "touches": len(group),
                "extreme": is_extreme,
                "score": sum(min(s, MAJOR_PROMINENCE_ATR) for _, s, _ in group),
            }
        )

    # Strongest first; weaker zones too close to a kept one are dropped.
    # Önce en güçlüler; tutulan birine çok yakın zayıf zone'lar atılır.
    kept: list[dict] = []
    for z in sorted(zones, key=lambda z: z["score"], reverse=True):
        if all(abs(z["mean"] - k["mean"]) >= atr * MIN_SEPARATION_ATR for k in kept):
            kept.append(z)

    # The period's extreme zone is exempt from the distance cut: it is the high
    # or low the whole window is measured against, however far price has moved.
    # Dönemin uç zone'u mesafe elemesinden muaf: fiyat ne kadar uzaklaşmış olursa
    # olsun, tüm pencerenin ölçüldüğü zirve ya da dip orası.
    def nearest(side: list[dict]) -> list[dict]:
        picked = sorted(side, key=lambda z: abs(z["mean"] - current))[:MAX_PER_SIDE]
        extreme = next((z for z in side if z["extreme"]), None)
        if extreme is not None and not any(z is extreme for z in picked):
            picked.append(extreme)
        return picked

    def to_price(z: dict) -> dict:
        return {
            "min": round(math.exp(z["lo"]), 4),
            "max": round(math.exp(z["hi"]), 4),
            "mean": round(math.exp(z["mean"]), 4),
            "touches": z["touches"],
        }

    resistances = sorted(nearest([z for z in kept if z["mean"] > current]), key=lambda z: z["mean"])
    supports = sorted(nearest([z for z in kept if z["mean"] <= current]), key=lambda z: z["mean"], reverse=True)
    return [to_price(z) for z in resistances], [to_price(z) for z in supports]


def get_sr_zones(symbol: str) -> dict:
    """
    The price cache is NOT warmed separately here (no ensure_cached /
    maybe_refresh_recent calls) - /api/price already does that for the same
    symbol. Calling both in parallel sent duplicate simultaneous requests to
    TradingView and caused 429s (rate limit). The frontend calls this endpoint
    AFTER the price request, so the cache is already warm here.

    Fiyat cache'ini burada AYRICA ısıtmıyoruz (ensure_cached/maybe_refresh_recent
    çağırmıyoruz) - /api/price zaten aynı sembol için bunu yapıyor. İkisini
    paralel çağırmak TradingView'e aynı anda çifte istek atıp 429'a
    (rate limit) yol açıyordu. Frontend bu endpoint'i fiyat isteğinden SONRA
    çağırıyor, o yüzden cache burada zaten sıcak.
    """
    symbol = symbol.upper()
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    df = price_cache.query_range(symbol, start, end)
    resistances, supports = find_sr_levels(df)

    return {"resistance": resistances, "support": supports}
