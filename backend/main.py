from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from data_provider import get_price_history
from volume_scanner import get_scan
from sr_zones import get_sr_zones

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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