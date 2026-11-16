"""Note endpoints, mounted under /api/notes.

Like the portfolio's, these write data that cannot be refetched, so the
symbol and the body are bounded before anything reaches the store.

Not uç noktaları, /api/notes altında.

Portföyünkiler gibi bunlar da yeniden çekilemeyen veri yazıyor; bu yüzden
sembol ve metin, depoya ulaşmadan önce sınırlanıyor.
"""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import store

router = APIRouter()

SYMBOL_RE = re.compile(r"^[A-Za-z0-9.]{1,20}$")


class NoteIn(BaseModel):
    body: str = Field(max_length=store.MAX_LENGTH)


def _check_symbol(symbol: str) -> str:
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail={"code": "bad_symbol", "value": symbol})
    return symbol.upper()


@router.get("")
def list_notes(limit: int = 50):
    """Every symbol that has a note, newest first."""
    return store.list_notes(max(1, min(limit, 200)))


@router.get("/{symbol}")
def read_note(symbol: str):
    note = store.get_note(_check_symbol(symbol))
    # A symbol with nothing written is not an error; the panel opens on an
    # empty box either way.
    # Hiçbir şey yazılmamış sembol hata değil; panel iki durumda da boş
    # kutuyla açılıyor.
    return note or {"symbol": _check_symbol(symbol), "body": "", "updatedAt": None}


@router.put("/{symbol}")
def write_note(symbol: str, body: NoteIn):
    saved = store.save_note(_check_symbol(symbol), body.body)
    return saved or {"symbol": _check_symbol(symbol), "body": "", "updatedAt": None}
