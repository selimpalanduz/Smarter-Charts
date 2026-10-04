"""
Financial statement rows on disk, in SQLite.

Rows are stored exactly as reported — year-to-date cumulative, each in the
purchasing power of its own period end. Unit repair, inflation restatement and
single-quarter differencing all happen on read, so the derivation can be fixed
without refetching 563 symbols. The in-memory caches this replaces were lost on
every restart, and a screener over the whole market cannot run off them.

Mali tablo satırları diskte, SQLite'ta.

Satırlar raporlandığı gibi saklanıyor — yıl başından birikimli, her biri kendi
dönem sonundaki paranın değerinde. Birim onarımı, enflasyon düzeltmesi ve tek
çeyreğe ayrıştırma okuma anında yapılıyor; böylece türetme, 563 sembol yeniden
çekilmeden düzeltilebiliyor. Yerine geçtiği hafıza içi önbellekler her yeniden
başlatmada kayboluyordu ve tüm piyasayı tarayan bir ekran onlarla çalışamaz.
"""

import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "fundamentals.db"
# Seconds. Quarterly data changes four times a year, but a company can file
# late or restate, so a symbol is re-asked about weekly.
# Saniye. Çeyreklik veri yılda dört kez değişiyor, ama şirket geç bildirebilir
# ya da düzeltme yayınlayabilir; o yüzden sembol haftada bir yeniden soruluyor.
TTL = 7 * 24 * 3600


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS facts (
            symbol TEXT NOT NULL,
            period TEXT NOT NULL,
            code   TEXT NOT NULL,
            value  REAL NOT NULL,
            PRIMARY KEY (symbol, period, code)
        );
        CREATE INDEX IF NOT EXISTS facts_symbol ON facts (symbol);
        CREATE INDEX IF NOT EXISTS facts_code ON facts (code, period);
        CREATE TABLE IF NOT EXISTS items (
            code  TEXT PRIMARY KEY,
            label TEXT
        );
        CREATE TABLE IF NOT EXISTS fetched (
            symbol     TEXT PRIMARY KEY,
            quarters   INTEGER NOT NULL,
            fetched_at REAL NOT NULL,
            rows       INTEGER NOT NULL
        );
        """
    )
    return conn


def is_fresh(symbol: str, quarters: int) -> bool:
    """Whether the symbol was fetched recently and over at least this depth."""
    with connect() as conn:
        row = conn.execute(
            "SELECT quarters, fetched_at FROM fetched WHERE symbol = ?", (symbol.upper(),)
        ).fetchone()
    if not row:
        return False
    depth, fetched_at = row
    return depth >= quarters and (time.time() - fetched_at) < TTL


def save(symbol: str, values: dict[str, dict[str, float]], labels: dict[str, str], quarters: int) -> int:
    """Replaces the symbol's rows; returns how many were written."""
    symbol = symbol.upper()
    rows = [
        (symbol, period, code, value)
        for code, series in values.items()
        for period, value in series.items()
    ]
    with connect() as conn:
        conn.execute("DELETE FROM facts WHERE symbol = ?", (symbol,))
        conn.executemany("INSERT INTO facts (symbol, period, code, value) VALUES (?, ?, ?, ?)", rows)
        conn.executemany(
            "INSERT INTO items (code, label) VALUES (?, ?) "
            "ON CONFLICT(code) DO UPDATE SET label = excluded.label",
            [(code, label) for code, label in labels.items() if label],
        )
        conn.execute(
            "INSERT INTO fetched (symbol, quarters, fetched_at, rows) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET "
            "quarters = excluded.quarters, fetched_at = excluded.fetched_at, rows = excluded.rows",
            (symbol, quarters, time.time(), len(rows)),
        )
    return len(rows)


def load(symbol: str) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """({code: {period: value}}, {code: label}) as stored."""
    symbol = symbol.upper()
    with connect() as conn:
        facts = conn.execute(
            "SELECT code, period, value FROM facts WHERE symbol = ?", (symbol,)
        ).fetchall()
        labels = dict(conn.execute("SELECT code, label FROM items").fetchall())

    values: dict[str, dict[str, float]] = {}
    for code, period, value in facts:
        values.setdefault(code, {})[period] = value
    return values, labels


def coverage() -> dict:
    """What is on disk: symbol count, row count, oldest fetch."""
    with connect() as conn:
        symbols, rows, oldest = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(rows), 0), MIN(fetched_at) FROM fetched"
        ).fetchone()
    return {"symbols": symbols, "rows": rows, "oldestFetch": oldest}
