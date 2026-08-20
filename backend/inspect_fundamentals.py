# Geçici inceleme scripti — projeye kalıcı olarak eklenmeyecek.
# backend/ içinde (venv aktifken) çalıştır: python inspect_fundamentals.py

import borsapy as bp
import pandas as pd

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 200)
pd.set_option('display.max_rows', 100)

ticker = bp.Ticker("THYAO")

print("=" * 60)
print("quarterly_income_stmt")
print("=" * 60)
income = ticker.quarterly_income_stmt
print(type(income))
print(income)
if hasattr(income, "columns"):
    print("\nColumns:", list(income.columns))
if hasattr(income, "index"):
    print("Index:", list(income.index))

print()
print("=" * 60)
print("earnings_dates")
print("=" * 60)
dates = ticker.earnings_dates
print(type(dates))
print(dates)
if hasattr(dates, "columns"):
    print("\nColumns:", list(dates.columns))