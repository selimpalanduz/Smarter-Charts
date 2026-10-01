"""BIST symbol list with company names.

tickers.txt holds the tradable symbols but no names. The names come from a
single TradingView screener request and are stored in data/symbols.json, so
the picker works offline and the request is repeated only once a week.

Şirket adlarıyla BIST sembol listesi.

tickers.txt işlem gören sembolleri tutuyor ama adları yok. Adlar tek bir
TradingView screener isteğinden geliyor ve data/symbols.json içine yazılıyor;
böylece seçim listesi ağ olmadan da çalışıyor, istek haftada bir tekrarlanıyor.
"""

import json
import time
from pathlib import Path

import httpx

from volume_scanner import _load_tickers

SCANNER_URL = "https://scanner.tradingview.com/turkey/scan"
CACHE_PATH = Path(__file__).parent / "data" / "symbols.json"
CACHE_TTL = 7 * 24 * 3600

_memory: tuple[float, list[dict]] | None = None


def _fetch_names() -> dict[str, dict]:
    payload = {
        "filter": [{"left": "exchange", "operation": "equal", "right": "BIST"}],
        "columns": ["name", "description", "market_cap_basic"],
        "range": [0, 1500],
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
    }
    resp = httpx.post(SCANNER_URL, json=payload, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    rows = resp.json().get("data", [])

    info = {}
    for i, row in enumerate(rows):
        symbol, name, cap = (row["d"] + [None, None, None])[:3]
        if not symbol:
            continue
        info[symbol] = {"name": name or symbol, "rank": i if cap else len(rows) + i}
    return info


def _build() -> tuple[list[dict], bool]:
    tickers = _load_tickers()
    try:
        info = _fetch_names()
    except Exception:
        info = {}

    out = [
        {
            "symbol": s,
            "name": info.get(s, {}).get("name", s),
            "rank": info.get(s, {}).get("rank", 10_000),
        }
        for s in tickers
    ]
    # Most traded first, so the list reads usefully before anything is typed.
    # En çok işlem görenler başta olsun ki liste bir şey yazılmadan da işe yarasın.
    out.sort(key=lambda r: (r["rank"], r["symbol"]))
    return [{"symbol": r["symbol"], "name": r["name"]} for r in out], bool(info)


def _read_cache() -> tuple[float, list[dict]] | None:
    if not CACHE_PATH.exists():
        return None
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return float(payload["fetched_at"]), payload["symbols"]
    except Exception:
        return None


def _write_cache(symbols: list[dict]) -> None:
    CACHE_PATH.parent.mkdir(exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": time.time(), "symbols": symbols}, f, ensure_ascii=False)


def get_symbols() -> list[dict]:
    global _memory
    now = time.time()

    if _memory and now - _memory[0] < CACHE_TTL:
        return _memory[1]

    cached = _read_cache()
    if cached and now - cached[0] < CACHE_TTL:
        _memory = cached
        return cached[1]

    symbols, named = _build()
    if not named:
        # A nameless list has not earned a week in the cache, and an expired one
        # still carries the names, so it is the better answer until the next try.
        # Adsız liste bir haftalık cache'i hak etmiyor; süresi geçmiş olan adları
        # hâlâ tuttuğu için bir sonraki denemeye kadar daha iyi cevap o.
        return cached[1] if cached else symbols

    _memory = (now, symbols)
    _write_cache(symbols)
    return symbols
