from datetime import datetime, timedelta
import borsapy as bp
import pandas as pd
import numpy as np

BUFFER_DAYS = 90


def get_ttm_eps(symbol: str) -> pd.Series:
    """
    Çeyreklik EPS'lerin (Hisse Başına Kazanç) son 4'ünün toplamını (TTM EPS),
    her çeyreğin gerçek bitiş tarihine (2026Q1 -> 2026-03-31 gibi) göre indeksli
    bir seri olarak döner.
    """
    ticker = bp.Ticker(symbol.upper())
    income = ticker.get_income_stmt(quarterly=True, last_n=40)

    eps_row = income.loc["Hisse Başına Kazanç"].sort_index()
    ttm_eps = eps_row.rolling(4).sum()

    dates = [pd.Period(col, freq="Q").end_time.normalize() for col in ttm_eps.index]
    ttm_eps.index = pd.DatetimeIndex(dates)

    return ttm_eps.dropna()


def attach_pe(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    try:
        ttm_eps = get_ttm_eps(symbol)
    except Exception:
        df["PE"] = None
        return df

    df = df.sort_values("Date").copy()
    df["_date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None).astype("datetime64[us]")

    ttm_eps_df = ttm_eps.reset_index()
    ttm_eps_df.columns = ["_date", "TTM_EPS"]
    ttm_eps_df["_date"] = pd.to_datetime(ttm_eps_df["_date"]).astype("datetime64[us]")

    df = pd.merge_asof(df, ttm_eps_df, on="_date", direction="backward")
    df["PE"] = df["Close"] / df["TTM_EPS"]
    df = df.drop(columns=["_date", "TTM_EPS"])
    return df


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

    df = attach_pe(df, symbol)

    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str)
        df = df[df["Date"] >= start]

    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)

    return df.to_dict(orient="records")