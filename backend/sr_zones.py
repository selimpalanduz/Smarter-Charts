"""Support/resistance zone detection.

The logic is taken from the SupportResistanceDetector project: pivot points
(scipy find_peaks) are combined with price density sampling, and prices
close to each other (within 0.4%) are grouped into a single "zone".
The difference from the original: data comes from this project's existing
SQLite price cache (price_cache) instead of yfinance.

Destek/direnç zone tespiti.

Mantık SupportResistanceDetector projesinden alındı: pivot noktaları
(scipy find_peaks) ile fiyat yoğunluğu örneklemesini birleştirip,
birbirine yakın (%0.4 içinde) fiyatları tek bir "zone"da topluyoruz.
Orijinalinden farkı: veriyi yfinance yerine bu projenin zaten sahip
olduğu SQLite fiyat önbelleğinden (price_cache) alıyoruz.
"""

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy.signal import find_peaks

import price_cache

LOOKBACK_DAYS = 365
# Prices closer than this percentage fall into the same zone.
# Bu yüzdeden yakın fiyatlar aynı zone'a girer.
CLUSTER_GAP_PCT = 0.004
EXTREME_TOLERANCE_PCT = 0.005
PIVOT_DISTANCE = 5
MAX_SUPPORTS = 8


def find_sr_levels(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    if df is None or df.empty:
        return [], []

    current_price = float(df["Close"].iloc[-1])
    std_dev = float(df["Close"].std())
    if std_dev == 0 or np.isnan(std_dev):
        return [], []

    prominence = std_dev * 0.05
    res_idx, _ = find_peaks(df["High"].values, distance=PIVOT_DISTANCE, prominence=prominence)
    sup_idx, _ = find_peaks(-df["Low"].values, distance=PIVOT_DISTANCE, prominence=prominence)

    recent = df.tail(30)
    sampled_means = df["Close"].rolling(window=3).mean().dropna()
    sample_n = max(1, int(len(sampled_means) * 0.2))
    sampled_means = sampled_means.sample(n=sample_n, random_state=0) if len(sampled_means) else sampled_means

    local_max, local_min = float(df["High"].max()), float(df["Low"].min())

    raw_candidates = (
        df["High"].iloc[res_idx].tolist()
        + df["Low"].iloc[sup_idx].tolist()
        + recent["Close"].tolist() * 2
        + sampled_means.tolist()
        + [local_max] * 5
        + [local_min] * 5
    )

    def _is_extreme(group: list[float]) -> bool:
        return any(abs(x - local_max) / local_max < EXTREME_TOLERANCE_PCT for x in group) or any(
            abs(x - local_min) / local_min < EXTREME_TOLERANCE_PCT for x in group
        )

    zones = []
    sorted_candidates = sorted(raw_candidates)
    if sorted_candidates:
        current_group = [sorted_candidates[0]]
        for price in sorted_candidates[1:]:
            if (price - current_group[-1]) / current_group[-1] < CLUSTER_GAP_PCT:
                current_group.append(price)
            else:
                if len(current_group) >= 3 or _is_extreme(current_group):
                    zones.append(
                        {
                            "min": float(min(current_group)),
                            "max": float(max(current_group)),
                            "mean": float(np.mean(current_group)),
                            "touches": len(current_group),
                        }
                    )
                current_group = [price]

        if len(current_group) >= 3 or _is_extreme(current_group):
            zones.append(
                {
                    "min": float(min(current_group)),
                    "max": float(max(current_group)),
                    "mean": float(np.mean(current_group)),
                    "touches": len(current_group),
                }
            )

    ath_already_in = any(abs(z["mean"] - local_max) / local_max < 0.01 for z in zones)
    if not ath_already_in:
        zones.append(
            {
                "min": float(local_max * 0.995),
                "max": float(local_max * 1.005),
                "mean": float(local_max),
                "touches": 1,
            }
        )

    supports = [z for z in zones if z["mean"] < current_price]
    resistances = [z for z in zones if z["mean"] > current_price]

    sorted_res = sorted(resistances, key=lambda z: z["mean"])
    sorted_sup = sorted(supports, key=lambda z: z["mean"], reverse=True)[:MAX_SUPPORTS]

    return sorted_res, sorted_sup


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
