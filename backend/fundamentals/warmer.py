"""Keeps the statement store filled, as a weekly job.

A symbol costs one request per four quarters per basis, so seven years in both
lira and dollars is fourteen requests — roughly seven thousand for the whole
market. That is something to start deliberately, so it is off unless
WARM_FUNDAMENTALS is set, matching cache_warmer.

Once started it stays running. store.TTL is a week, so the whole store expires
every week and a single pass is not enough: after each pass this sleeps until
the oldest stored symbol is about to expire, then passes again. A pass only
fetches what is stale, so a pass that lands early costs almost nothing.

It runs in whichever process starts it — inside the API, or on its own with
`python -m fundamentals.warmer`, which is the same loop in the foreground.

Banks and insurers are skipped: they report under a different schema and are
out of scope for now. A symbol already classified as financial is not probed
again, so the cost is paid once.

Mali tablo deposunu haftalık bir iş olarak dolu tutar.

Bir sembol, taban başına her dört çeyrek için bir istek demek; yedi yıl hem
lira hem dolar olunca on dört istek — tüm piyasa için yaklaşık yedi bin. Bu,
bilerek başlatılacak bir iş, o yüzden cache_warmer gibi WARM_FUNDAMENTALS
verilmedikçe kapalı.

Başladıktan sonra çalışmaya devam ediyor. store.TTL bir hafta, yani depo her
hafta tümüyle bayatlıyor ve tek pas yetmiyor: her pastan sonra en eski kayıt
bayatlamak üzereyken uyanacak kadar uyuyup yeniden geçiyor. Bir pas yalnızca
bayat olanı çekiyor, o yüzden erken düşen pas neredeyse bedava.

Hangi süreçte başlatılırsa orada koşuyor — API'nin içinde ya da tek başına
`python -m fundamentals.warmer` ile; ikincisi aynı döngünün önplanda hâli.

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
# Shortest wait between passes. Symbols that never store a row — every fetch
# failing, say — would otherwise spin the loop.
# Paslar arası en kısa bekleme. Hiç satır yazamayan semboller (her isteği
# düşen biri gibi) yoksa döngüyü boşa çevirirdi.
MIN_SLEEP_SECONDS = float(os.getenv("WARM_FUNDAMENTALS_MIN_SLEEP", str(3600)))
BASES = ((CURRENCY_TRY, True), (CURRENCY_USD, False))

_started = False
_start_guard = threading.Lock()
_progress = {
    "state": "idle",
    "done": 0,
    "total": 0,
    "symbol": None,
    "skipped": 0,
    "failed": 0,
    "passes": 0,
    "startedAt": None,
    "finishedAt": None,
    "nextRunAt": None,
}


def progress() -> dict:
    """What the filler is doing. state: idle | running | waiting."""
    return dict(_progress)


def _symbol_order() -> list[str]:
    """Most traded first, so the symbols likely to be opened are ready soonest."""
    try:
        return [row["symbol"] for row in get_symbols()]
    except Exception:
        return _load_tickers()


def _pass() -> None:
    """One walk over the market, fetching whatever is stale."""
    known = store.sectors()
    symbols = [s for s in _symbol_order() if known.get(s) != "financial"]
    _progress.update(
        state="running",
        total=len(symbols),
        done=0,
        skipped=0,
        failed=0,
        startedAt=time.time(),
        finishedAt=None,
        nextRunAt=None,
    )
    print(f"[fund] pass {_progress['passes'] + 1}: {len(symbols)} symbols to fill", flush=True)

    for index, symbol in enumerate(symbols, 1):
        _progress.update(done=index, symbol=symbol)
        started = time.time()
        asked = False
        try:
            for currency, real in BASES:
                if store.is_fresh(symbol, QUARTERS, currency):
                    continue
                asked = True
                result = quarterly(symbol, quarters=QUARTERS, real=real, currency=currency)
                if not result.get("supported"):
                    _progress["skipped"] += 1
                    print(f"[fund] {index}/{len(symbols)} {symbol} skipped ({result.get('sector')})", flush=True)
                    break
                time.sleep(DELAY_SECONDS)
            else:
                if asked:
                    print(f"[fund] {index}/{len(symbols)} {symbol} {time.time() - started:.1f}s", flush=True)
        except Exception as e:
            asked = True
            _progress["failed"] += 1
            print(f"[fund] {index}/{len(symbols)} {symbol} failed: {type(e).__name__}: {e}", flush=True)
        # Only the provider needs pacing; a symbol that was already fresh cost nothing.
        # Beklemeye yalnızca sağlayıcı için gerek var; zaten taze olan sembol bedava.
        if asked:
            time.sleep(DELAY_SECONDS)

    _progress.update(symbol=None, passes=_progress["passes"] + 1, finishedAt=time.time())
    print(f"[fund] pass {_progress['passes']} done", flush=True)


def _loop() -> None:
    while True:
        _pass()
        wait = max(store.seconds_until_stale(), MIN_SLEEP_SECONDS)
        _progress.update(state="waiting", nextRunAt=time.time() + wait)
        print(f"[fund] next pass in {wait / 3600:.1f}h", flush=True)
        time.sleep(wait)


def start() -> None:
    """Starts the loop once per process, and only when WARM_FUNDAMENTALS is set."""
    global _started
    if os.getenv("WARM_FUNDAMENTALS", "").lower() not in ("1", "true", "yes"):
        return
    with _start_guard:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, daemon=True).start()


if __name__ == "__main__":
    # Run the same loop in the foreground, without needing the env flag.
    # Aynı döngüyü önplanda, ortam değişkenine gerek kalmadan koşturur.
    _loop()
