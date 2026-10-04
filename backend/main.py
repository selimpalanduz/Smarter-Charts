import os

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from data_provider import get_price_history
from volume_scanner import get_scan
from sr_zones import get_sr_zones
from earnings import get_earnings
from pattern_search import find_similar
from moves import get_moves
from kap import get_text
from anchors import get_anchors
from symbols import get_symbols
from fundamentals.router import router as fundamentals_router
from fundamentals import warmer as fundamentals_warmer
import anchor_scanner
import cache_warmer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Price-Stale", "X-History-Pending"],
)

# Off unless WARM_CACHE is set; see cache_warmer.
# WARM_CACHE verilmedikçe kapalı; bkz. cache_warmer.
cache_warmer.start()

# Off unless WARM_FUNDAMENTALS is set; see fundamentals.warmer.
# WARM_FUNDAMENTALS verilmedikçe kapalı; bkz. fundamentals.warmer.
fundamentals_warmer.start()

app.include_router(fundamentals_router, prefix="/api/fundamentals", tags=["fundamentals"])


@app.get("/api/price/{symbol}")
def get_price(symbol: str, start: str, end: str, response: Response):
    try:
        rows, stale, history_pending = get_price_history(symbol, start, end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    response.headers["X-Price-Stale"] = "1" if stale else "0"
    response.headers["X-History-Pending"] = "1" if history_pending else "0"
    return rows


@app.get("/api/symbols")
def list_symbols():
    try:
        return get_symbols()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/scan/volume")
def get_volume_scan(refresh: bool = False):
    try:
        return get_scan(force_refresh=refresh)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/scan/anchors")
def get_anchor_scan(start: bool = False):
    try:
        return anchor_scanner.get_scan(start=start)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/sr/{symbol}")
def get_sr(symbol: str):
    try:
        return get_sr_zones(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

@app.get("/api/earnings/{symbol}")
def get_earnings_markers(symbol: str):
    try:
        return get_earnings(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/patterns/{symbol}")
def get_similar_patterns(symbol: str, start: str, end: str):
    try:
        return find_similar(symbol, start, end)
    except ValueError as e:
        code, *rest = e.args
        raise HTTPException(status_code=400, detail={"code": code, "limit": rest[0] if rest else None})
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/moves/{symbol}")
def get_sharp_moves(symbol: str):
    try:
        return get_moves(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/anchors/{symbol}")
def get_anchor_levels(symbol: str):
    try:
        return get_anchors(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/kap/disclosure/{disclosure_id}")
def get_disclosure_text(disclosure_id: int):
    try:
        return {"id": disclosure_id, "text": get_text(disclosure_id)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
