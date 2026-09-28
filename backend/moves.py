"""
Sharp price moves and the KAP disclosures that may explain them.

Sert fiyat hareketleri ve bunları açıklayabilecek KAP bildirimleri.
"""

import time
from datetime import datetime, time as dtime, timedelta

import numpy as np
import pandas as pd

import kap
import price_cache

LOOKBACK_YEARS = 3
MIN_MOVE_PCT = 3.0
# A move must also be this many times the stock's recent daily volatility.
# Hareket ayrıca hissenin son dönem günlük oynaklığının bu kadar katı olmalı.
VOL_MULTIPLE = 2.5
VOL_WINDOW = 60
RVOL_WINDOW = 20
# Disclosures after this time affect the next trading day.
# Bu saatten sonraki bildirimler bir sonraki işlem gününü etkiler.
MARKET_CLOSE = dtime(18, 0)
EARLIER_DAYS = 2
INDEX_SYMBOL = "XU100"
# Usually a consequence of the move rather than its cause.
# Genelde hareketin sebebi değil, sonucu.
ROUTINE_SUBJECTS = {"Payların Geri Alınmasına İlişkin Bildirim"}
CACHE_TTL = 600

_cache: dict[str, tuple[float, dict]] = {}


def _round(value, digits: int = 2) -> float | None:
    return None if value is None or pd.isna(value) else round(float(value), digits)


def _serialize(d: dict) -> dict:
    return {
        "id": d["id"],
        "publishedAt": d["published"].strftime("%Y-%m-%d %H:%M"),
        "subject": d["subject"],
        "summary": d["summary"],
        "url": kap.disclosure_url(d["id"]),
        "routine": d["subject"] in ROUTINE_SUBJECTS,
    }


def get_moves(symbol: str) -> dict:
    """
    The price cache is warmed by /api/price, which the frontend calls first; only XU100 is warmed here.

    Fiyat önbelleğini frontend'in önce çağırdığı /api/price ısıtıyor; burada sadece XU100 ısıtılır.
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _cache.get(symbol)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    today = datetime.now()
    cutoff = today - timedelta(days=365 * LOOKBACK_YEARS)
    start = (cutoff - timedelta(days=VOL_WINDOW * 2)).strftime("%Y-%m-%d")
    end = today.strftime("%Y-%m-%d")

    df = price_cache.query_range(symbol, start, end)
    if df.empty:
        return {"moves": []}

    price_cache.ensure_cached(INDEX_SYMBOL)
    price_cache.maybe_refresh_recent(INDEX_SYMBOL, end)
    index_close = price_cache.query_range(INDEX_SYMBOL, start, end)["Close"]

    change = df["Close"].pct_change() * 100
    volatility = change.rolling(VOL_WINDOW).std().shift(1)
    rvol = df["Volume"] / df["Volume"].rolling(RVOL_WINDOW).mean().shift(1)
    index_change = (index_close.pct_change() * 100).reindex(df.index)

    is_move = (
        (change.abs() >= MIN_MOVE_PCT)
        & (change.abs() >= VOL_MULTIPLE * volatility)
        & (df.index >= pd.Timestamp(cutoff.date()))
    )

    # Map each disclosure to the trading day whose price it can affect.
    # Her bildirimi, fiyatını etkileyebileceği işlem gününe eşle.
    trading_days = df.index.normalize().to_numpy()
    by_day: dict[int, list[dict]] = {}
    for d in kap.get_disclosures(symbol, cutoff.year):
        day = d["published"].date()
        if d["published"].time() >= MARKET_CLOSE:
            day += timedelta(days=1)
        i = int(np.searchsorted(trading_days, np.datetime64(day)))
        if i < len(trading_days):
            by_day.setdefault(i, []).append(d)

    moves = []
    for i in np.flatnonzero(is_move.to_numpy()):
        pct = change.iloc[i]
        index_pct = index_change.iloc[i]
        earlier = [d for j in range(i - EARLIER_DAYS, i) for d in by_day.get(j, [])]
        moves.append(
            {
                "date": df.index[i].strftime("%Y-%m-%d"),
                "pct": _round(pct),
                "indexPct": _round(index_pct),
                "relPct": _round(pct - index_pct),
                "rvol": _round(rvol.iloc[i], 1),
                "disclosures": [_serialize(d) for d in reversed(by_day.get(i, []))],
                "earlier": [_serialize(d) for d in reversed(earlier)],
            }
        )

    result = {"moves": moves}
    _cache[symbol] = (now, result)
    return result
