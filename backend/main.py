from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from data_provider import get_price_history

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