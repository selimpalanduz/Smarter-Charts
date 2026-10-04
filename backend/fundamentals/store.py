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

from .schema import CURRENCY_TRY

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "fundamentals.db"
# Seconds. Quarterly data changes four times a year, but a company can file
# late or restate, so a symbol is re-asked about weekly.
# Saniye. Çeyreklik veri yılda dört kez değişiyor, ama şirket geç bildirebilir
# ya da düzeltme yayınlayabilir; o yüzden sembol haftada bir yeniden soruluyor.
TTL = 7 * 24 * 3600


# Bumped when the layout changes. This file is a cache of a public endpoint,
# so an older one is discarded rather than migrated.
# Düzen değiştiğinde artırılıyor. Bu dosya açık bir uç noktanın önbelleği,
# o yüzden eskisi taşınmak yerine atılıyor.
SCHEMA_VERSION = 3


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
        conn.executescript(
            "DROP TABLE IF EXISTS facts;"
            "DROP TABLE IF EXISTS fetched;"
            "DROP TABLE IF EXISTS sectors;"
        )
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS facts (
            symbol   TEXT NOT NULL,
            currency TEXT NOT NULL,
            period   TEXT NOT NULL,
            code     TEXT NOT NULL,
            value    REAL NOT NULL,
            PRIMARY KEY (symbol, currency, period, code)
        );
        CREATE INDEX IF NOT EXISTS facts_symbol ON facts (symbol, currency);
        CREATE INDEX IF NOT EXISTS facts_code ON facts (code, currency, period);
        CREATE TABLE IF NOT EXISTS items (
            code  TEXT PRIMARY KEY,
            label TEXT
        );
        CREATE TABLE IF NOT EXISTS sectors (
            symbol     TEXT PRIMARY KEY,
            kind       TEXT NOT NULL,
            checked_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fetched (
            symbol     TEXT NOT NULL,
            currency   TEXT NOT NULL,
            quarters   INTEGER NOT NULL,
            fetched_at REAL NOT NULL,
            rows       INTEGER NOT NULL,
            PRIMARY KEY (symbol, currency)
        );
        """
    )
    return conn


def is_fresh(symbol: str, quarters: int, currency: str = CURRENCY_TRY) -> bool:
    """Whether the symbol was fetched recently and over at least this depth."""
    with connect() as conn:
        row = conn.execute(
            "SELECT quarters, fetched_at FROM fetched WHERE symbol = ? AND currency = ?",
            (symbol.upper(), currency),
        ).fetchone()
    if not row:
        return False
    depth, fetched_at = row
    return depth >= quarters and (time.time() - fetched_at) < TTL


def save(
    symbol: str,
    values: dict[str, dict[str, float]],
    labels: dict[str, str],
    quarters: int,
    currency: str = CURRENCY_TRY,
) -> int:
    """Replaces the symbol's rows in this currency; returns how many were written."""
    symbol = symbol.upper()
    rows = [
        (symbol, currency, period, code, value)
        for code, series in values.items()
        for period, value in series.items()
    ]
    with connect() as conn:
        conn.execute("DELETE FROM facts WHERE symbol = ? AND currency = ?", (symbol, currency))
        conn.executemany(
            "INSERT INTO facts (symbol, currency, period, code, value) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
        conn.executemany(
            "INSERT INTO items (code, label) VALUES (?, ?) "
            "ON CONFLICT(code) DO UPDATE SET label = excluded.label",
            [(code, label) for code, label in labels.items() if label],
        )
        conn.execute(
            "INSERT INTO fetched (symbol, currency, quarters, fetched_at, rows) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol, currency) DO UPDATE SET "
            "quarters = excluded.quarters, fetched_at = excluded.fetched_at, rows = excluded.rows",
            (symbol, currency, quarters, time.time(), len(rows)),
        )
    return len(rows)


def load(
    symbol: str, currency: str = CURRENCY_TRY
) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """({code: {period: value}}, {code: label}) as stored."""
    symbol = symbol.upper()
    with connect() as conn:
        facts = conn.execute(
            "SELECT code, period, value FROM facts WHERE symbol = ? AND currency = ?",
            (symbol, currency),
        ).fetchall()
        labels = dict(conn.execute("SELECT code, label FROM items").fetchall())

    values: dict[str, dict[str, float]] = {}
    for code, period, value in facts:
        values.setdefault(code, {})[period] = value
    return values, labels


def remember_sector(symbol: str, kind: str) -> None:
    """Records whether a symbol is in scope, so the probe is not repeated."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO sectors (symbol, kind, checked_at) VALUES (?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET kind = excluded.kind, checked_at = excluded.checked_at",
            (symbol.upper(), kind, time.time()),
        )


def sectors() -> dict[str, str]:
    """{symbol: "nonfinancial" | "financial" | "unknown"} as far as it is known."""
    with connect() as conn:
        return dict(conn.execute("SELECT symbol, kind FROM sectors").fetchall())


def coverage() -> dict:
    """What is on disk, per currency: symbol count, row count, oldest fetch."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT currency, COUNT(*), COALESCE(SUM(rows), 0), MIN(fetched_at) "
            "FROM fetched GROUP BY currency"
        ).fetchall()
    return {
        currency: {"symbols": symbols, "rows": total, "oldestFetch": oldest}
        for currency, symbols, total, oldest in rows
    }
