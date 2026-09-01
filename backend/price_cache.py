"""Yerel SQLite fiyat önbelleği.

Fikir basit: geçmiş fiyat verisi asla değişmiyor. Bir sembolü ilk kez
gördüğümüzde elimizdeki tüm geçmişi bir kere çekip burada
saklıyoruz. Sonraki her istekte TradingView'e gitmek yerine önce buraya
bakıyoruz — sadece "en güncel" görünen istekler için (end tarihi bugüne
yakınsa), en fazla birkaç dakikada bir, son birkaç günü tazeliyoruz.

--------------------------ENG------------------------------------

Local SQLite price cache. The idea is simple: historical price data never changes. When we see a
symbol for the first time, we fetch all the history we have and store it here.
On subsequent requests, we check here first instead of going to TradingView — only for requests
that seem "most up-to-date" (if the end date is close to today), 
we refresh the last few days at most every few minutes.
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


def ensure_cached(symbol: str) -> None:
    """Sembol hiç görülmediyse, elde ne kadar geçmiş varsa hepsini bir kere çeker."""
    conn = _get_connection()
    try:
        if _has_symbol(conn, symbol):
            return
        df = bp.Ticker(symbol).history(period="max")
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