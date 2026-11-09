"""Portfolio endpoints, mounted under /api/portfolio.

These are the first endpoints in the project that write. A trade the user
typed cannot be refetched from anywhere, so the handlers validate before
storing rather than letting SQLite's CHECK constraints surface as a 500.

Portfoy uc noktalari, /api/portfolio altinda.

Projede yazan ilk uc noktalar bunlar. Kullanicinin yazdigi bir islem hicbir
yerden yeniden cekilemez; bu yuzden isleyiciler saklamadan once dogruluyor,
SQLite'in CHECK kisitlarinin 500 olarak yuzeye vurmasina birakmak yerine.
"""

from datetime import date as date_cls

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import actions as actions_mod
from . import performance, store

router = APIRouter()


class TradeIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    side: str
    date: str
    # The share count and price of the trade's own day, exactly as it was
    # made. The conversion into adjusted units happens on the way out.
    # Islemin kendi gununun adedi ve fiyati, yapildigi gibi. Duzeltilmis
    # birime cevrim okurken yapiliyor.
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    fee: float = Field(default=0.0, ge=0)
    note: str | None = Field(default=None, max_length=500)


class ActionIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    kind: str
    date: str
    value: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


def _check_date(value: str) -> str:
    try:
        parsed = date_cls.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "bad_date", "value": value})
    if parsed > date_cls.today():
        raise HTTPException(status_code=400, detail={"code": "future_date", "value": value})
    return parsed.strftime("%Y-%m-%d")


@router.get("/trades")
def list_trades(symbol: str | None = None):
    return store.trades(symbol)


@router.post("/trades")
def create_trade(body: TradeIn):
    if body.side not in store.SIDES:
        raise HTTPException(status_code=400, detail={"code": "bad_side", "allowed": list(store.SIDES)})
    trade_id = store.add_trade(
        body.symbol, body.side, _check_date(body.date), body.quantity, body.price, body.fee, body.note
    )
    return {"id": trade_id}


@router.delete("/trades/{trade_id}")
def remove_trade(trade_id: int):
    if not store.delete_trade(trade_id):
        raise HTTPException(status_code=404, detail={"code": "no_such_trade", "id": trade_id})
    return {"deleted": trade_id}


@router.get("/actions/{symbol}")
def list_actions(symbol: str):
    """Dividends and capital changes for one symbol, fetched plus hand-entered."""
    try:
        return actions_mod.actions(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/actions")
def create_action(body: ActionIn):
    if body.kind not in store.ACTION_KINDS:
        raise HTTPException(status_code=400, detail={"code": "bad_kind", "allowed": list(store.ACTION_KINDS)})
    action_id = store.add_manual_action(body.symbol, body.kind, _check_date(body.date), body.value, body.note)
    return {"id": action_id}


@router.delete("/actions/{action_id}")
def remove_action(action_id: int):
    if not store.delete_manual_action(action_id):
        raise HTTPException(status_code=404, detail={"code": "no_such_action", "id": action_id})
    return {"deleted": action_id}


@router.get("/overview")
def get_overview(benchmark: str | None = None):
    """Positions, totals, the value series, and one symbol to read it against."""
    try:
        return performance.overview(benchmark)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
