import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from data_provider import get_price_history
from volume_scanner import get_scan
from sr_zones import get_sr_zones
from earnings import get_earnings
from pattern_search import find_similar
from moves import get_moves
from kap import get_text

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/price/{symbol}")
def get_price(symbol: str, start: str, end: str):
    try:
        return get_price_history(symbol, start, end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Veri çekilemedi: {e}")


@app.get("/api/scan/volume")
def get_volume_scan(refresh: bool = False):
    try:
        return get_scan(force_refresh=refresh)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Tarama başarısız: {e}")


@app.get("/api/sr/{symbol}")
def get_sr(symbol: str):
    try:
        return get_sr_zones(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Destek/direnç hesaplanamadı: {e}")

@app.get("/api/earnings/{symbol}")
def get_earnings_markers(symbol: str):
    try:
        return get_earnings(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bilanço verisi alınamadı: {e}")


@app.get("/api/patterns/{symbol}")
def get_similar_patterns(symbol: str, start: str, end: str):
    try:
        return find_similar(symbol, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Formasyon araması başarısız: {e}")


@app.get("/api/moves/{symbol}")
def get_sharp_moves(symbol: str):
    try:
        return get_moves(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sert hareketler hesaplanamadı: {e}")


@app.get("/api/kap/disclosure/{disclosure_id}")
def get_disclosure_text(disclosure_id: int):
    try:
        return {"id": disclosure_id, "text": get_text(disclosure_id)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bildirim metni alınamadı: {e}")
