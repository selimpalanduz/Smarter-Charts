from datetime import datetime, timedelta
import borsapy as bp
import pandas as pd
import numpy as np


BUFFER_DAYS = 90 


def get_price_history(symbol: str, start: str, end: str) -> list[dict]:
    ticker = bp.Ticker(symbol.upper())

    requested_start = datetime.fromisoformat(start)
    buffered_start = requested_start - timedelta(days=BUFFER_DAYS)

    df = ticker.history(
        start=buffered_start.strftime("%Y-%m-%d"),
        end=end,
    )
    df = bp.add_indicators(df)

    df = df.reset_index()
    df.columns = [str(c) for c in df.columns]
    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records")