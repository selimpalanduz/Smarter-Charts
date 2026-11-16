"""One free-text note per symbol, in its own SQLite file.

Hand-typed and unrecoverable, like the trades, so it is kept apart from the
price cache for the same reason: a lost cache refills itself, a lost note
does not.

Sembol başına bir serbest metin notu, kendi SQLite dosyasında.

İşlemler gibi elle yazılmış ve geri getirilemez; bu yüzden fiyat
önbelleğinden aynı sebeple ayrı tutuluyor: kaybolan önbellek kendini
doldurur, kaybolan not dolmaz.
"""

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "notes.db"
DB_PATH.parent.mkdir(exist_ok=True)

MAX_LENGTH = 4000


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # The symbol is the key: one note per symbol, rewritten in place rather
    # than versioned. Nobody asked for a history and an edit box that grows
    # a revision list every keystroke would be its own problem.
    # Anahtar sembol: sembol başına tek not, sürümlenmek yerine yerinde
    # yeniden yazılıyor. Geçmiş isteyen olmadı ve her tuşta bir revizyon
    # listesi büyüten bir metin kutusu başlı başına sorun olurdu.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            symbol TEXT PRIMARY KEY,
            body TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    return conn


@contextmanager
def _session():
    """Commits on the way out, and closes either way.

    Same reason as portfolio/store.py: `with sqlite3.connect(...)` leaves the
    connection open and on Windows the file stays locked.

    Çıkarken commit, her hâlükârda close.

    portfolio/store.py ile aynı sebep: `with sqlite3.connect(...)` bağlantıyı
    açık bırakıyor ve Windows'ta dosya kilitli kalıyor.
    """
    conn = _connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _row(row: sqlite3.Row) -> dict:
    return {"symbol": row["symbol"], "body": row["body"], "updatedAt": row["updated_at"]}


def get_note(symbol: str) -> dict | None:
    with _session() as conn:
        row = conn.execute(
            "SELECT symbol, body, updated_at FROM notes WHERE symbol = ?", (symbol.upper(),)
        ).fetchone()
        return _row(row) if row else None


def save_note(symbol: str, body: str) -> dict | None:
    """Writes the note, or deletes it when the box was emptied.

    Clearing the box is how a note is removed -- there is no delete button to
    press and no empty row left behind to make the other-notes list look
    like it still has something in it.

    Notu yazıyor, kutu boşaltıldıysa siliyor.

    Kutuyu boşaltmak notu kaldırmanın yolu -- basılacak bir sil düğmesi yok
    ve diğer notlar listesini hâlâ bir şey varmış gibi gösterecek boş bir
    satır geride kalmıyor.
    """
    symbol = symbol.upper()
    body = body.strip()
    if not body:
        delete_note(symbol)
        return None
    now = time.time()
    with _session() as conn:
        conn.execute(
            "INSERT INTO notes (symbol, body, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT (symbol) DO UPDATE SET body = excluded.body,"
            " updated_at = excluded.updated_at",
            (symbol, body[:MAX_LENGTH], now),
        )
    return {"symbol": symbol, "body": body[:MAX_LENGTH], "updatedAt": now}


def delete_note(symbol: str) -> bool:
    with _session() as conn:
        return conn.execute("DELETE FROM notes WHERE symbol = ?", (symbol.upper(),)).rowcount > 0


def list_notes(limit: int = 50) -> list[dict]:
    """Every note, newest first, so the panel can list what else is written.

    Bütün notlar, en yenisi başta; panel başka ne yazıldığını listeleyebilsin.
    """
    with _session() as conn:
        rows = conn.execute(
            "SELECT symbol, body, updated_at FROM notes ORDER BY updated_at DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
        return [_row(row) for row in rows]
