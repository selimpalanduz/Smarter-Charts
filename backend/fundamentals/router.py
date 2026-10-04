"""
Fundamental analysis endpoints, mounted under /api/fundamentals.

The basis is one value rather than a currency plus a flag, because only three
combinations are meaningful: lira restated to a common month, lira as
reported, and dollars. TÜFE is the wrong deflator for a dollar figure, so
"usd-real" does not exist.

Temel analiz uç noktaları, /api/fundamentals altında.

Taban, para birimi + bayrak yerine tek bir değer: yalnızca üç bileşim anlamlı
— ortak bir aya çevrilmiş lira, raporlandığı gibi lira, ve dolar. Dolar
rakamı için TÜFE yanlış deflatör olduğundan "usd-real" diye bir şey yok.
"""

from fastapi import APIRouter, HTTPException, Query

from . import store, warmer
from .schema import CURRENCY_TRY, CURRENCY_USD
from .statements import QUARTERS, quarterly
from .summary import ANNUAL, QUARTER, summarise

router = APIRouter()

BASES = {
    "try-real": (CURRENCY_TRY, True),
    "try-nominal": (CURRENCY_TRY, False),
    "usd": (CURRENCY_USD, False),
}
DEFAULT_BASIS = "try-real"
MAX_QUARTERS = 40


def _resolve(basis: str) -> tuple[str, bool]:
    try:
        return BASES[basis]
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail={"code": "unknown_basis", "allowed": sorted(BASES)},
        )


@router.get("/statements/{symbol}")
def get_statements(
    symbol: str,
    basis: str = DEFAULT_BASIS,
    quarters: int = Query(QUARTERS, ge=4, le=MAX_QUARTERS),
    refresh: bool = False,
):
    """Every reported line, single-quarter, on the requested basis."""
    currency, real = _resolve(basis)
    try:
        return quarterly(symbol, quarters=quarters, real=real, currency=currency, refresh=refresh)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/summary/{symbol}")
def get_summary(
    symbol: str,
    basis: str = DEFAULT_BASIS,
    period: str = QUARTER,
    quarters: int = Query(QUARTERS, ge=4, le=MAX_QUARTERS),
    refresh: bool = False,
):
    """The curated sections, quarterly or annual."""
    if period not in (QUARTER, ANNUAL):
        raise HTTPException(
            status_code=400, detail={"code": "unknown_period", "allowed": [QUARTER, ANNUAL]}
        )
    currency, real = _resolve(basis)
    try:
        statements = quarterly(
            symbol, quarters=quarters, real=real, currency=currency, refresh=refresh
        )
        return summarise(statements, period)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/progress")
def get_progress():
    """What the background filler is doing, when it was started."""
    return warmer.progress()


@router.get("/coverage")
def get_coverage():
    """How much of the market is on disk, per basis currency."""
    try:
        return store.coverage()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
