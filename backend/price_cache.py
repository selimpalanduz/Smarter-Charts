"""Yerel SQLite fiyat önbelleği.

Fikir basit: geçmiş fiyat verisi asla değişmiyor. Bir sembolü ilk kez
gördüğümüzde elimizdeki tüm geçmişi bir kere çekip burada saklıyoruz.
Sonraki her istekte TradingView'e gitmek yerine önce buraya bakıyoruz —
sadece "en güncel" görünen istekler için (end tarihi bugüne yakınsa),
en fazla birkaç dakikada bir, son birkaç günü tazeliyoruz.
"""

import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

import borsapy as bp
import pandas as pd

DB_PATH = Path(__file__).parent / "data" / "prices.db"
DB_PATH.parent.mkdir(exist_ok=True)

REFRESH_WINDOW_DAYS = 14
REFRESH_CHECK_INTERVAL = 300  # saniye

_last_refresh_check: dict[str, float] = {}


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
    earliest_sane_year = 1985  # güvenlik sınırı, sonsuz döngüye girmesin diye

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
    """Sembol hiç görülmediyse, gerçek en eskiye kadar parça parça çeker."""
    conn = _get_connection()
    try:
        if _has_symbol(conn, symbol):
            return
        df = _backfill_full_history(symbol)
        _upsert(conn, symbol, df)
    finally:
        conn.close()


def maybe_refresh_recent(symbol: str, requested_end: str) -> None:
    """
    İstenen aralığın sonu bugüne yakınsa, son birkaç günü tazeler — ama
    aynı sembol için en fazla REFRESH_CHECK_INTERVAL saniyede bir dener.
    """
    end_date = datetime.fromisoformat(requested_end).date()
    today = datetime.now().date()
    if (today - end_date).days > 2:
        return

    now = time.time()
    if now - _last_refresh_check.get(symbol, 0) < REFRESH_CHECK_INTERVAL:
        return
    _last_refresh_check[symbol] = now

    refresh_start = today - timedelta(days=REFRESH_WINDOW_DAYS)
    conn = _get_connection()
    try:
        df = bp.Ticker(symbol).history(start=refresh_start.strftime("%Y-%m-%d"))
        _upsert(conn, symbol, df)
    except Exception:
        pass  # tazeleme başarısız olsa da eldeki önbellek geçerliliğini korur
    finally:
        conn.close()


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