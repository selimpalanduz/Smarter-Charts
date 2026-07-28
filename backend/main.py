from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import borsapy as bp
import pandas as pd
import numpy as np

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
        ticker = bp.Ticker(symbol.upper())

        requested_start = datetime.fromisoformat(start)
        buffered_start = requested_start - timedelta(days=90)

        df = ticker.history(
            start=buffered_start.strftime("%Y-%m-%d"),
            end=end,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Veri çekilemedi: {e}")

    df = df.reset_index()
    df.columns = [str(c) for c in df.columns]
    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records")