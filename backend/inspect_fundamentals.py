import borsapy as bp
import pandas as pd

pd.set_option('display.max_columns', None)
pd.set_option('display.width', 200)

ticker = bp.Ticker("THYAO")

print("=== fast_info ===")
print(dict(ticker.fast_info))

last_price = ticker.fast_info["last_price"]
market_cap = ticker.fast_info["market_cap"]
shares = market_cap / last_price
print(f"\nlast_price: {last_price}")
print(f"market_cap: {market_cap}")
print(f"hesaplanan hisse sayısı: {shares:,.0f}")

income = ticker.get_income_stmt(quarterly=True, last_n=10)
cumulative = income.loc["Ana Ortaklık Payları"].sort_index()
print("\n=== Kümülatif Ana Ortaklık Payları (ham, son 10 çeyrek) ===")
print(cumulative)

years = [c[:4] for c in cumulative.index]
quarters = [c[4:] for c in cumulative.index]
standalone = cumulative.copy()
for i in range(1, len(cumulative)):
    if years[i] == years[i - 1] and quarters[i] != "Q1":
        standalone.iloc[i] = cumulative.iloc[i] - cumulative.iloc[i - 1]

print("\n=== Standalone (kümülatiften ayrıştırılmış) çeyreklik net kâr ===")
print(standalone)

last4 = standalone.tail(4)
ttm_net_income = last4.sum()
print(f"\nTTM için kullanılan çeyrekler: {list(last4.index)}")
print(f"TTM net kâr (bu 4 çeyreğin toplamı): {ttm_net_income:,.0f}")

ttm_eps = ttm_net_income / shares
print(f"\nTTM EPS (hesaplanan): {ttm_eps:.2f}   <-- Fintables'ta 'Hisse Başına Kar': 81.20")
print(f"Şu anki fiyat: {last_price}")
print(f"F/K (hesaplanan): {last_price / ttm_eps:.2f}   <-- Fintables'ta 'F/K': 3.71")
income = ticker.get_income_stmt(quarterly=True, last_n=15)
print(income.columns.tolist())