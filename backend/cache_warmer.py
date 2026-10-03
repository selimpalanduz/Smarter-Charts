"""Fills the price cache for symbols that have never been opened.

Opening a symbol for the first time still costs one request for the recent
slice (price_cache.ensure_cached), and its deep history then downloads in the
background. This walks the whole symbol list ahead of time so that cost is
paid before anyone opens anything.

It is off unless WARM_CACHE is set, because filling ~500 symbols is thousands
of sequential requests: something to start deliberately, not on every boot.

Hiç açılmamış sembollerin fiyat önbelleğini doldurur.

Bir sembolü ilk kez açmak hâlâ güncel dilim için bir istek demek
(price_cache.ensure_cached), derin geçmişi de ardından arka planda iniyor. Bu
modül tüm sembol listesini önden gezerek o maliyeti kimse bir şey açmadan
önce ödüyor.

WARM_CACHE verilmedikçe kapalıdır: ~500 sembolü doldurmak binlerce ardışık
istek demek, her açılışta değil bilerek başlatılacak bir iş.
"""

import os
import threading
import time

import price_cache
from symbols import get_symbols
from volume_scanner import _load_tickers

# Seconds to wait between symbols, to stay well clear of the provider's rate limit.
# Semboller arasında beklenen saniye; sağlayıcının rate limit'inden uzak durmak için.
DELAY_SECONDS = float(os.getenv("WARM_CACHE_DELAY", "5"))

_started = False
_start_guard = threading.Lock()


def _symbol_order() -> list[str]:
    """Most traded first, so the symbols likely to be opened are ready soonest."""
    try:
        return [row["symbol"] for row in get_symbols()]
    except Exception:
        return _load_tickers()


def _warm() -> None:
    symbols = [s for s in _symbol_order() if price_cache.history_pending(s)]
    print(f"[warm] {len(symbols)} symbols to fill", flush=True)

    for i, symbol in enumerate(symbols, 1):
        started = time.time()
        try:
            price_cache.ensure_cached(symbol)
            price_cache.deep_backfill(symbol)
            print(f"[warm] {i}/{len(symbols)} {symbol} {time.time() - started:.1f}s", flush=True)
        except Exception as e:
            print(f"[warm] {i}/{len(symbols)} {symbol} failed: {type(e).__name__}: {e}", flush=True)
        time.sleep(DELAY_SECONDS)

    print("[warm] done", flush=True)


def start() -> None:
    """Starts the warmer once per process, and only when WARM_CACHE is set."""
    global _started
    if os.getenv("WARM_CACHE", "").lower() not in ("1", "true", "yes"):
        return
    with _start_guard:
        if _started:
            return
        _started = True
    threading.Thread(target=_warm, daemon=True).start()
