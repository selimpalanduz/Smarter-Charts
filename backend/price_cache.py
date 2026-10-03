"""Local SQLite price cache.

The idea is simple: historical price data never changes. The first time a
symbol is seen, its full history is fetched once and stored here. Every
later request checks here first instead of going to TradingView; only
requests that look "current" (end date close to today) refresh the last
few days, at most once every few minutes.

Yerel SQLite fiyat önbelleği.

Fikir basit: geçmiş fiyat verisi asla değişmiyor. Bir sembolü ilk kez
gördüğümüzde elimizdeki tüm geçmişi bir kere çekip burada saklıyoruz.
Sonraki her istekte TradingView'e gitmek yerine önce buraya bakıyoruz —
sadece "en güncel" görünen istekler için (end tarihi bugüne yakınsa),
en fazla birkaç dakikada bir, son birkaç günü tazeliyoruz.
"""

import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

DB_PATH = Path(__file__).parent / "data" / "prices.db"
DB_PATH.parent.mkdir(exist_ok=True)

REFRESH_WINDOW_DAYS = 14
# seconds
# saniye
REFRESH_CHECK_INTERVAL = 300
# How far behind the cache may be and still be worth showing right away.
# Covers a weekend: on Monday the newest candle is Friday's.
# Önbellek en fazla bu kadar geride olup da hemen gösterilmeye değer sayılır.
# Hafta sonunu kapsar: pazartesi en yeni mum cumanın.
SERVE_STALE_MAX_DAYS = 3

_last_refresh_check: dict[str, float] = {}
_refreshing: set[str] = set()
_refresh_guard = threading.Lock()


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prices (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            PRIMARY KEY (symbol, date)
        )
        """
    )
    return conn


def _upsert(conn: sqlite3.Connection, symbol: str, df: pd.DataFrame) -> None:
    if df.empty:
        return
    rows = [
        (
            symbol,
            idx.strftime("%Y-%m-%d"),
            float(row["Open"]),
            float(row["High"]),
            float(row["Low"]),
            float(row["Close"]),
            float(row["Volume"]),
        )
        for idx, row in df.iterrows()
    ]
    conn.executemany(
        """
        INSERT INTO prices (symbol, date, open, high, low, close, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, date) DO UPDATE SET
            open=excluded.open, high=excluded.high, low=excluded.low,
            close=excluded.close, volume=excluded.volume
        """,
        rows,
    )
    conn.commit()


def _has_symbol(conn: sqlite3.Connection, symbol: str) -> bool:
    row = conn.execute("SELECT 1 FROM prices WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
    return row is not None


def _backfill_full_history(symbol: str) -> pd.DataFrame:
    """
    borsapy's period='max' option hits TradingView's per-request depth limit
    (for some stocks it cuts off a few decades back) even though much older
    data may exist. The same "fetch backwards chunk by chunk" logic as the
    frontend is applied here during the initial seed: step back in 2-year
    slices until an empty response is returned.

    borsapy'nin period='max' seçeneği, TradingView'in tek istekteki
    derinlik sınırına takılıyor (bazı hisselerde birkaç on yıl önce
    kesiliyor) - oysa gerçekte çok daha eskiye veri olabiliyor.
    Frontend'deki "geriye doğru parça parça çek" mantığının aynısını
    burada, ilk seed sırasında uyguluyoruz: boş bir yanıt alana kadar
    2 yıllık dilimler halinde geriye gidiyoruz.
    """
    ticker = bp.Ticker(symbol)
    chunks = []
    end = datetime.now()
    # Safety limit to avoid an infinite loop.
    # Güvenlik sınırı, sonsuz döngüye girmesin diye.
    earliest_sane_year = 1985

    while end.year >= earliest_sane_year:
        start = end - timedelta(days=730)
        try:
            chunk = ticker.history(
                start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d")
            )
        except Exception:
            break
        if chunk.empty:
            break
        chunks.append(chunk)
        end = start - timedelta(days=1)

    if not chunks:
        return pd.DataFrame()

    full = pd.concat(chunks)
    full = full[~full.index.duplicated(keep="first")]
    return full.sort_index()


def ensure_cached(symbol: str) -> None:
    """
    If the symbol has never been seen, fetches it chunk by chunk back to the earliest available date.

    Sembol hiç görülmediyse, gerçek en eskiye kadar parça parça çeker.
    """
    conn = _get_connection()
    try:
        if _has_symbol(conn, symbol):
            return
        df = _backfill_full_history(symbol)
        _upsert(conn, symbol, df)
    finally:
        conn.close()


def _last_cached_date(symbol: str):
    conn = _get_connection()
    try:
        last = conn.execute("SELECT MAX(date) FROM prices WHERE symbol = ?", (symbol,)).fetchone()[0]
    finally:
        conn.close()
    return datetime.fromisoformat(last[:10]).date() if last else None


def _refresh_recent(symbol: str) -> None:
    """
    Fetches the last few days. Starts from the cache's last date when that is
    older than the refresh window, so no gap is left.

    Son birkaç günü çeker. Önbelleğin son tarihi tazeleme penceresinden
    eskiyse oradan başlar, böylece boşluk kalmaz.
    """
    refresh_start = datetime.now().date() - timedelta(days=REFRESH_WINDOW_DAYS)
    last = _last_cached_date(symbol)
    if last:
        refresh_start = min(refresh_start, last)

    conn = _get_connection()
    try:
        df = bp.Ticker(symbol).history(start=refresh_start.strftime("%Y-%m-%d"))
        _upsert(conn, symbol, df)
    except Exception:
        # Even if the refresh fails, the existing cache remains valid.
        # Tazeleme başarısız olsa da eldeki önbellek geçerliliğini korur.
        pass
    finally:
        conn.close()


def _refresh_in_background(symbol: str) -> None:
    with _refresh_guard:
        if symbol in _refreshing:
            return
        _refreshing.add(symbol)

    def run():
        try:
            _refresh_recent(symbol)
        finally:
            with _refresh_guard:
                _refreshing.discard(symbol)

    threading.Thread(target=run, daemon=True).start()


def maybe_refresh_recent(symbol: str, requested_end: str) -> bool:
    """
    If the requested range ends close to today, refreshes the last few days,
    at most once every REFRESH_CHECK_INTERVAL seconds per symbol.

    When the cache is already within SERVE_STALE_MAX_DAYS of today the refresh
    runs in a background thread and this returns True, so the caller can serve
    what is on disk immediately instead of waiting on the provider. Only an
    empty or genuinely out-of-date cache is refreshed synchronously.

    İstenen aralığın sonu bugüne yakınsa son birkaç günü tazeler — aynı sembol
    için en fazla REFRESH_CHECK_INTERVAL saniyede bir.

    Önbellek bugünden en fazla SERVE_STALE_MAX_DAYS geride ise tazeleme arka
    plan thread'inde çalışır ve bu fonksiyon True döner; böylece çağıran,
    sağlayıcıyı beklemeden diskteki veriyi hemen sunabilir. Yalnızca boş ya da
    gerçekten eskimiş önbellek senkron tazelenir.
    """
    end_date = datetime.fromisoformat(requested_end).date()
    today = datetime.now().date()
    if (today - end_date).days > 2:
        return False

    now = time.time()
    if now - _last_refresh_check.get(symbol, 0) < REFRESH_CHECK_INTERVAL:
        return False
    _last_refresh_check[symbol] = now

    last = _last_cached_date(symbol)
    if last is None or (today - last).days > SERVE_STALE_MAX_DAYS:
        _refresh_recent(symbol)
        return False

    _refresh_in_background(symbol)
    return True


def query_range(symbol: str, start: str, end: str) -> pd.DataFrame:
    conn = _get_connection()
    try:
        df = pd.read_sql_query(
            """
            SELECT date AS "Date", open AS "Open", high AS "High", low AS "Low",
                   close AS "Close", volume AS "Volume"
            FROM prices
            WHERE symbol = ? AND date >= ? AND date <= ?
            ORDER BY date ASC
            """,
            conn,
            params=(symbol, start, end),
        )
    finally:
        conn.close()

    if df.empty:
        return df

    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date")
    return df