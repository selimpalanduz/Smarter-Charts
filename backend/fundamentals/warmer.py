"""Fills the statement store for every symbol, in the background.

A symbol costs one request per four quarters per basis, so seven years in both
lira and dollars is fourteen requests — roughly seven thousand for the whole
market. That is something to start deliberately, so it is off unless
WARM_FUNDAMENTALS is set, matching cache_warmer.

Banks and insurers are skipped: they report under a different schema and are
out of scope for now. A symbol already classified as financial is not probed
again, so the cost is paid once.

Mali tablo deposunu tüm semboller için arka planda doldurur.

Bir sembol, taban başına her dört çeyrek için bir istek demek; yedi yıl hem
lira hem dolar olunca on dört istek — tüm piyasa için yaklaşık yedi bin. Bu,
bilerek başlatılacak bir iş, o yüzden cache_warmer gibi WARM_FUNDAMENTALS
verilmedikçe kapalı.

Banka ve sigorta atlanıyor: farklı şemayla raporluyorlar ve şimdilik kapsam
dışı. Finansal olarak sınıflanmış sembol tekrar sorulmuyor, maliyet bir kez
ödeniyor.
"""

import os
import threading
import time

from symbols import get_symbols
from volume_scanner import _load_tickers

from . import store
from .schema import CURRENCY_TRY, CURRENCY_USD
from .statements import QUARTERS, quarterly

# Seconds between requests, to stay well clear of the provider's rate limit.
# İstekler arası saniye; sağlayıcının rate limit'inden uzak durmak için.
DELAY_SECONDS = float(os.getenv("WARM_FUNDAMENTALS_DELAY", "2"))
BASES = ((CURRENCY_TRY, True), (CURRENCY_USD, False))

_started = False
_start_guard = threading.Lock()
_progress = {"state": "idle", "done": 0, "total": 0, "symbol": None, "skipped": 0, "failed": 0}


def progress() -> dict:
    return dict(_progress)


def _symbol_order() -> list[str]:
    """Most traded first, so the symbols likely to be opened are ready soonest."""
    try:
        return [row["symbol"] for row in get_symbols()]
    except Exception:
        return _load_tickers()


def _warm() -> None:
    known = store.sectors()
    symbols = [s for s in _symbol_order() if known.get(s) != "financial"]
    _progress.update(state="running", total=len(symbols), done=0, skipped=0, failed=0)
    print(f"[fund] {len(symbols)} symbols to fill", flush=True)

    for index, symbol in enumerate(symbols, 1):
        _progress.update(done=index, symbol=symbol)
        started = time.time()
        try:
            for currency, real in BASES:
                if store.is_fresh(symbol, QUARTERS, currency):
                    continue
                result = quarterly(symbol, quarters=QUARTERS, real=real, currency=currency)
                if not result.get("supported"):
                    _progress["skipped"] += 1
                    print(f"[fund] {index}/{len(symbols)} {symbol} skipped ({result.get('sector')})", flush=True)
                    break
                time.sleep(DELAY_SECONDS)
            else:
                print(f"[fund] {index}/{len(symbols)} {symbol} {time.time() - started:.1f}s", flush=True)
        except Exception as e:
            _progress["failed"] += 1
            print(f"[fund] {index}/{len(symbols)} {symbol} failed: {type(e).__name__}: {e}", flush=True)
        time.sleep(DELAY_SECONDS)

    _progress.update(state="done", symbol=None)
    print("[fund] done", flush=True)


def start() -> None:
    """Starts the warmer once per process, and only when WARM_FUNDAMENTALS is set."""
    global _started
    if os.getenv("WARM_FUNDAMENTALS", "").lower() not in ("1", "true", "yes"):
        return
    with _start_guard:
        if _started:
            return
        _started = True
    threading.Thread(target=_warm, daemon=True).start()
