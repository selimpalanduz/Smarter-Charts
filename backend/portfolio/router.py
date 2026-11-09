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


# Ceilings far above any real BIST trade, there to keep a typo or a pasted
# junk value out of the store. Without them `inf` and 1e308 were both
# accepted, and the overview then died with "Out of range float values are
# not JSON compliant" -- a stored record that took the whole screen down
# until it was deleted. allow_inf_nan=False is what refuses inf and NaN.
# Gercek bir BIST islemine gore fersah fersah yuksek tavanlar; amac bir
# yanlis tusu ya da yapistirilmis cop degeri depoya sokmamak. Olmadiginda
# `inf` de 1e308 de kabul ediliyordu ve ozet "Out of range float values are
# not JSON compliant" ile oluyordu -- silinene kadar butun ekrani goturen
# bir kayit. inf ve NaN'i reddeden sey allow_inf_nan=False.
MAX_QUANTITY = 1e12
MAX_PRICE = 1e9
MAX_FEE = 1e9
MAX_ACTION_VALUE = 1e9


class TradeIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    side: str
    date: str
    # The share count and price of the trade's own day, exactly as it was
    # made. The conversion into adjusted units happens on the way out.
    # Islemin kendi gununun adedi ve fiyati, yapildigi gibi. Duzeltilmis
    # birime cevrim okurken yapiliyor.
    quantity: float = Field(gt=0, le=MAX_QUANTITY, allow_inf_nan=False)
    price: float = Field(ge=0, le=MAX_PRICE, allow_inf_nan=False)
    fee: float = Field(default=0.0, ge=0, le=MAX_FEE, allow_inf_nan=False)
    note: str | None = Field(default=None, max_length=500)


class ActionIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    kind: str
    date: str
    value: float = Field(gt=0, le=MAX_ACTION_VALUE, allow_inf_nan=False)
    note: str | None = Field(default=None, max_length=500)


def _check_date(value: str, trading_day: bool = False) -> str:
    """Parses the date, and for a trade also refuses a day the exchange was shut.

    Only the weekend is refused outright. A public holiday is just as closed
    but cannot be derived from the calendar, and refusing every weekday that
    has no bar in our cache would turn a gap in our own data into a rejection
    of the user's real trade. Those are reported as a note on the overview
    instead.

    Tarihi cozumluyor, islem icinse borsanin kapali oldugu gunu de reddediyor.

    Yalnizca hafta sonu dogrudan reddediliyor. Resmi tatil de en az o kadar
    kapali ama takvimden cikarilamiyor; onbellegimizde bari olmayan her hafta
    ici gunu reddetmek de kendi verimizdeki bir bosluğu kullanicinin gercek
    isleminin reddine cevirirdi. Onlar bunun yerine ozet ekraninda not olarak
    bildiriliyor.
    """
    try:
        parsed = date_cls.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "bad_date", "value": value})
    if parsed > date_cls.today():
        raise HTTPException(status_code=400, detail={"code": "future_date", "value": value})
    if trading_day and parsed.weekday() >= 5:
        raise HTTPException(
            status_code=400,
            detail={"code": "market_closed", "value": value, "weekday": parsed.strftime("%A")},
        )
    return parsed.strftime("%Y-%m-%d")


@router.get("/trades")
def list_trades(symbol: str | None = None):
    return store.trades(symbol)


@router.post("/trades")
def create_trade(body: TradeIn):
    if body.side not in store.SIDES:
        raise HTTPException(status_code=400, detail={"code": "bad_side", "allowed": list(store.SIDES)})
    trade_id = store.add_trade(
        body.symbol,
        body.side,
        _check_date(body.date, trading_day=True),
        body.quantity,
        body.price,
        body.fee,
        body.note,
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
