"""Trades and hand-entered corporate actions, in their own SQLite file.

Separate from prices.db because this is the only data in the project the
user cannot get back by refetching: a lost price cache refills itself, a
lost trade does not.

İşlemler ve elle girilen sermaye hareketleri, kendi SQLite dosyasında.

prices.db'den ayrı, çünkü projede yeniden çekilerek geri gelmeyen tek veri
bu: kaybolan fiyat önbelleği kendini doldurur, kaybolan işlem dolmaz.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "portfolio.db"
DB_PATH.parent.mkdir(exist_ok=True)

SIDES = ("buy", "sell")
# A dividend is net lira per share as of its own date; bonus and rights are
# percentages, the same units the feed reports.
# Temettü, kendi tarihindeki hisse başına net lira; bedelsiz ve bedelli
# yüzde, yani kaynağın bildirdiği birim.
ACTION_KINDS = ("dividend", "bonus", "rights")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
            date TEXT NOT NULL,
            quantity REAL NOT NULL CHECK (quantity > 0),
            price REAL NOT NULL CHECK (price >= 0),
            fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
            note TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS trades_symbol_date ON trades (symbol, date)")
    # Hand-entered actions, for what the feed misses or gets wrong. Kept apart
    # from the fetched ones so a refetch cannot wipe them.
    # Elle girilen hareketler, kaynağın atladığı ya da yanlış verdiği için.
    # Çekilenlerden ayrı tutuluyor ki yeniden çekim bunları silmesin.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS manual_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('dividend', 'bonus', 'rights')),
            date TEXT NOT NULL,
            value REAL NOT NULL,
            note TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS manual_symbol_date ON manual_actions (symbol, date)")
    # Fetched actions, cached. fetched_at lets a stale symbol be refreshed
    # without touching the ones already current.
    # Çekilen hareketler, önbellekte. fetched_at sayesinde bayatlamış sembol,
    # güncel olanlara dokunmadan yenilenebiliyor.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS feed_actions (
            symbol TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('dividend', 'bonus', 'rights')),
            date TEXT NOT NULL,
            value REAL NOT NULL,
            PRIMARY KEY (symbol, kind, date)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS feed_state (
            symbol TEXT PRIMARY KEY,
            fetched_at REAL NOT NULL
        )
        """
    )
    return conn


def add_trade(symbol, side, date, quantity, price, fee=0.0, note=None) -> int:
    if side not in SIDES:
        raise ValueError("unknown_side", side)
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO trades (symbol, side, date, quantity, price, fee, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (symbol.upper(), side, date, float(quantity), float(price), float(fee), note),
        )
        return cur.lastrowid


def delete_trade(trade_id: int) -> bool:
    with _connect() as conn:
        return conn.execute("DELETE FROM trades WHERE id = ?", (trade_id,)).rowcount > 0


def trades(symbol: str | None = None) -> list[dict]:
    sql = "SELECT * FROM trades"
    args: tuple = ()
    if symbol:
        sql += " WHERE symbol = ?"
        args = (symbol.upper(),)
    # Same-day trades settle in insertion order, so id breaks the tie.
    # Aynı gün işlemleri giriş sırasına göre, eşitliği id çözüyor.
    sql += " ORDER BY date, id"
    with _connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


def held_symbols() -> list[str]:
    with _connect() as conn:
        return [r["symbol"] for r in conn.execute("SELECT DISTINCT symbol FROM trades ORDER BY symbol")]


def add_manual_action(symbol, kind, date, value, note=None) -> int:
    if kind not in ACTION_KINDS:
        raise ValueError("unknown_kind", kind)
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO manual_actions (symbol, kind, date, value, note) VALUES (?, ?, ?, ?, ?)",
            (symbol.upper(), kind, date, float(value), note),
        )
        return cur.lastrowid


def delete_manual_action(action_id: int) -> bool:
    with _connect() as conn:
        return conn.execute("DELETE FROM manual_actions WHERE id = ?", (action_id,)).rowcount > 0


def manual_actions(symbol: str | None = None) -> list[dict]:
    sql = "SELECT * FROM manual_actions"
    args: tuple = ()
    if symbol:
        sql += " WHERE symbol = ?"
        args = (symbol.upper(),)
    sql += " ORDER BY date, id"
    with _connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


def save_feed_actions(symbol: str, rows: list[tuple[str, str, float]], fetched_at: float) -> None:
    """Replace a symbol's fetched actions. Hand-entered ones are untouched."""
    symbol = symbol.upper()
    with _connect() as conn:
        conn.execute("DELETE FROM feed_actions WHERE symbol = ?", (symbol,))
        conn.executemany(
            "INSERT OR REPLACE INTO feed_actions (symbol, kind, date, value) VALUES (?, ?, ?, ?)",
            [(symbol, kind, date, float(value)) for kind, date, value in rows],
        )
        conn.execute(
            "INSERT OR REPLACE INTO feed_state (symbol, fetched_at) VALUES (?, ?)",
            (symbol, fetched_at),
        )


def feed_actions(symbol: str) -> list[dict]:
    with _connect() as conn:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM feed_actions WHERE symbol = ? ORDER BY date", (symbol.upper(),)
            )
        ]


def feed_fetched_at(symbol: str) -> float | None:
    with _connect() as conn:
        row = conn.execute("SELECT fetched_at FROM feed_state WHERE symbol = ?", (symbol.upper(),)).fetchone()
        return row["fetched_at"] if row else None
