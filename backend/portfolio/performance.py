"""What the portfolio did, and what the same money would have done elsewhere.

Everything is computed in adjusted units. A trade arrives in the share count
of its own day; `actions.factor_since` converts it, so a pre-bonus buy and
today's price can sit in the same column. Cash amounts need no conversion --
lira paid is lira paid.

Two conventions are worth stating because they change the numbers:

* Cost is average cost, not FIFO. A sale takes its cost from the running
  average of what is held, which is how Turkish brokers show maliyet.
* Dividends are counted as cash received, never reinvested. The benchmark is
  treated the same way, so the two sides stay comparable.

The benchmark answers one question: the same lira, on the same days, into
that symbol instead. Not "what did the index do since January" -- with
staged buying that comparison flatters or punishes the portfolio for nothing
but the timing of its deposits.

Portfoy ne yapti, ayni para baska yerde ne yapardi.

Her sey duzeltilmis birimde hesaplaniyor. Islem, kendi gununun hisse
adedinde geliyor; `actions.factor_since` onu ceviriyor, boylece bedelsiz
oncesi bir alim ile bugunun fiyati ayni sutunda durabiliyor. Nakit tutarlar
cevrim istemiyor -- odenen lira odenen liradir.

Iki kabul, rakamlari degistirdigi icin acikca yaziliyor:

* Maliyet, FIFO degil ortalama maliyet. Satis, elde olanin yuruyen
  ortalamasindan maliyet aliyor; Turkiye'deki araci kurumlarin "maliyet"
  gosterme bicimi bu.
* Temettu, alinan nakit olarak sayiliyor, asla yeniden yatirilmiyor. Olcut
  de ayni muameleyi goruyor, boylece iki taraf kiyaslanabilir kaliyor.

Olcut tek bir soruyu cevapliyor: ayni lira, ayni gunlerde, o hisseye
girseydi. "Endeks ocaktan beri ne yapti" degil -- kademeli alimda o kiyas,
portfoyu yalnizca para yatirma zamanlamasi yuzunden haksizca yukseltir ya da
cezalandirir.
"""

from datetime import date as date_cls

import pandas as pd

import price_cache

from . import actions as actions_mod
from . import store


def _today() -> str:
    return date_cls.today().strftime("%Y-%m-%d")


def _closes(symbol: str, start: str, end: str) -> tuple[pd.Series, bool]:
    """Daily closes plus whether the last candles are being refreshed.

    A portfolio screen says what a holding is worth *now*, so it goes through
    the same refresh path the price endpoint uses rather than reading the
    cache as it stands. The refresh runs in the background, so the first call
    after a quiet spell still answers from disk and flags itself; the flag is
    what lets the screen say so instead of quietly showing last month.

    Gunluk kapanislar ve son mumlarin tazelenmekte olup olmadigi.

    Portfoy ekrani bir pozisyonun *su anki* degerini soyluyor; bu yuzden
    onbellegi oldugu gibi okumak yerine fiyat uc noktasinin kullandigi
    tazeleme yolundan geciyor. Tazeleme arka planda kostugu icin, uzun bir
    sessizlikten sonraki ilk cagri yine diskten cevapliyor ve kendini
    isaretliyor; o isaret sayesinde ekran durumu soyleyebiliyor, sessizce
    gecen ayi gostermek yerine.
    """
    price_cache.ensure_cached(symbol)
    stale = price_cache.maybe_refresh_recent(symbol, end)
    df = price_cache.query_range(symbol, start, end)
    if df is None or df.empty:
        return pd.Series(dtype=float), stale
    closes = df["Close"].astype(float)
    closes.index = pd.to_datetime(closes.index).normalize()
    return closes[~closes.index.duplicated(keep="last")].sort_index(), stale


def _adjusted_trades(rows: list[dict], bonus: list[tuple[str, float]]) -> list[dict]:
    out = []
    for row in rows:
        factor = actions_mod.factor_since(row["date"], bonus)
        out.append(
            {
                **row,
                "factor": factor,
                "shares_adj": row["quantity"] * factor,
                "price_adj": row["price"] / factor,
            }
        )
    return out


def _dividend_cash(symbol, trades_adj, rows, bonus, until) -> list[dict]:
    """Dividends actually received, per payment.

    Entitlement goes by the shares held *before* the ex-date: a buy on the
    ex-date itself buys the price that already dropped, so it collects
    nothing. A dividend dated ahead of today is declared, not paid, and is
    left out.

    Gercekten alinmis temettuler, odeme basina.

    Hak, ex-tarihinden *once* elde olan adede gore: ex-tarihinde yapilan
    alim, zaten dusmus fiyati aliyor, dolayisiyla bir sey toplamiyor. Bugunun
    ilerisine tarihli temettu ilan edilmis, odenmis degil; disarida kaliyor.
    """
    paid = []
    for row in rows:
        if row["kind"] != "dividend" or row["date"] > until:
            continue
        held = sum(
            t["shares_adj"] if t["side"] == "buy" else -t["shares_adj"]
            for t in trades_adj
            if t["date"] < row["date"]
        )
        if held <= 0:
            continue
        per_share = row["value"] / actions_mod.factor_since(row["date"], bonus)
        paid.append(
            {
                "date": row["date"],
                "symbol": symbol,
                "per_share": per_share,
                "shares": held,
                "amount": per_share * held,
                "source": row.get("source", "feed"),
            }
        )
    return paid


def _position(trades_adj: list[dict]) -> dict:
    """Walk the trades once, carrying average cost."""
    shares = 0.0
    cost = 0.0
    realized = 0.0
    fees = 0.0
    for t in trades_adj:
        fees += t["fee"]
        if t["side"] == "buy":
            shares += t["shares_adj"]
            cost += t["shares_adj"] * t["price_adj"] + t["fee"]
        else:
            if shares <= 1e-9:
                # A sale with nothing held is the user's data to fix, not
                # ours to guess at; _oversold reports it instead.
                # Elde bir sey yokken satis, bizim tahmin edecegimiz degil
                # kullanicinin duzeltecegi veri; _oversold bunu bildiriyor.
                continue
            sold = min(t["shares_adj"], shares)
            unit_cost = cost / shares
            realized += sold * (t["price_adj"] - unit_cost) - t["fee"]
            cost -= sold * unit_cost
            shares -= sold
    return {"shares": shares, "cost": cost, "realized": realized, "fees": fees}


def _oversold(trades_adj: list[dict]) -> bool:
    shares = 0.0
    for t in trades_adj:
        shares += t["shares_adj"] if t["side"] == "buy" else -t["shares_adj"]
        if shares < -1e-9:
            return True
    return False


def _share_series(trades_adj: list[dict], index) -> pd.Series:
    held = pd.Series(0.0, index=index)
    for t in trades_adj:
        day = pd.Timestamp(t["date"]).normalize()
        signed = t["shares_adj"] if t["side"] == "buy" else -t["shares_adj"]
        held.loc[held.index >= day] += signed
    return held


def _value_series(closes, shares, dividends, all_trades) -> list[dict]:
    if not closes:
        return []
    index = None
    for s in closes.values():
        index = s.index if index is None else index.union(s.index)
    index = index.sort_values()

    value = pd.Series(0.0, index=index)
    for symbol, series in closes.items():
        price = series.reindex(index).ffill()
        held = shares[symbol].reindex(index).ffill().fillna(0.0)
        value = value.add((price * held).fillna(0.0), fill_value=0.0)

    invested = pd.Series(0.0, index=index)
    for t in all_trades:
        day = pd.Timestamp(t["date"]).normalize()
        cash = t["quantity"] * t["price"]
        signed = cash + t["fee"] if t["side"] == "buy" else -(cash - t["fee"])
        invested.loc[invested.index >= day] += signed

    div_cum = pd.Series(0.0, index=index)
    for d in dividends:
        day = pd.Timestamp(d["date"]).normalize()
        div_cum.loc[div_cum.index >= day] += d["amount"]

    return [
        {
            "date": day.strftime("%Y-%m-%d"),
            "value": round(float(value.loc[day]), 2),
            "invested": round(float(invested.loc[day]), 2),
            "dividends": round(float(div_cum.loc[day]), 2),
            "total": round(float(value.loc[day] + div_cum.loc[day]), 2),
        }
        for day in index
    ]


def _benchmark(symbol, all_trades, series, start, today, notes) -> dict | None:
    """The same cash flows, on the same days, into one symbol."""
    symbol = symbol.upper()
    closes, stale = _closes(symbol, start, today)
    if closes.empty:
        notes.append({"code": "no_benchmark_prices", "symbol": symbol})
        return None
    if stale:
        notes.append({"code": "prices_refreshing", "symbol": symbol})

    action_rows = actions_mod.actions(symbol)
    bonus = actions_mod.bonus_events(symbol, action_rows)

    shares = 0.0
    bench_trades: list[dict] = []
    for t in sorted(all_trades, key=lambda r: (r["date"], r["id"])):
        day = pd.Timestamp(t["date"]).normalize()
        window = closes[closes.index <= day]
        if window.empty:
            continue
        price = float(window.iloc[-1])
        cash = t["quantity"] * t["price"]
        cash = cash + t["fee"] if t["side"] == "buy" else -(cash - t["fee"])
        qty = cash / price
        # A sale bigger than the benchmark stake would short it; the stake is
        # emptied instead, which is what "take the money out" means here.
        # Olcut pozisyonundan buyuk bir satis onu aciga satardi; yerine
        # pozisyon bosaltiliyor, burada "parayi cek" bu demek.
        if qty < 0:
            qty = max(qty, -shares)
        shares += qty
        bench_trades.append(
            {
                "date": t["date"],
                "side": "buy" if qty >= 0 else "sell",
                "shares_adj": abs(qty),
                "fee": 0.0,
            }
        )

    bench_divs = _dividend_cash(symbol, bench_trades, action_rows, bonus, today)
    div_total = sum(d["amount"] for d in bench_divs)
    if div_total == 0:
        # An index carries no dividend of its own: XU100 is a price index, so
        # the portfolio's side of the comparison includes payouts and the
        # benchmark's does not. Saying so is the only honest fix available
        # here -- the return index is a different series we do not hold.
        # Bir endeksin kendi temettusu yok: XU100 fiyat endeksi, yani kiyasin
        # portfoy tarafi odemeleri iceriyor, olcut tarafi icermiyor. Burada
        # yapilabilecek tek durust duzeltme bunu soylemek -- getiri endeksi
        # elimizde olmayan baska bir seri.
        notes.append({"code": "benchmark_without_dividends", "symbol": symbol})
    price_now = float(closes.iloc[-1])
    value = shares * price_now
    invested = series[-1]["invested"] if series else 0.0
    total = value + div_total

    # The same days as the portfolio's own series, so the two lines can be
    # drawn against one axis without the reader aligning dates by eye.
    # Portfoyun kendi serisiyle ayni gunler, boylece iki cizgi tek eksende
    # cizilebiliyor ve okuyan tarihleri gozuyle hizalamak zorunda kalmiyor.
    bench_series: list[dict] = []
    if series:
        index = pd.DatetimeIndex([pd.Timestamp(r["date"]) for r in series])
        price_line = closes.reindex(index).ffill()
        held = _share_series(bench_trades, index)
        div_cum = pd.Series(0.0, index=index)
        for d in bench_divs:
            day = pd.Timestamp(d["date"]).normalize()
            div_cum.loc[div_cum.index >= day] += d["amount"]
        for day in index:
            day_value = float(price_line.loc[day] * held.loc[day]) if not pd.isna(price_line.loc[day]) else 0.0
            day_divs = float(div_cum.loc[day])
            bench_series.append(
                {
                    "date": day.strftime("%Y-%m-%d"),
                    "value": round(day_value, 2),
                    "dividends": round(day_divs, 2),
                    "total": round(day_value + day_divs, 2),
                }
            )

    return {
        "symbol": symbol,
        "shares": shares,
        "price": price_now,
        "value": value,
        "dividends": div_total,
        "total": total,
        "total_return": total - invested,
        "total_return_pct": ((total - invested) / invested * 100) if invested else None,
        "series": bench_series,
    }


def _empty_totals() -> dict:
    out = {k: 0.0 for k in ("cost", "value", "unrealized", "realized", "dividends", "fees", "total_return")}
    out["total_return_pct"] = None
    return out


def _totals(rows: list[dict]) -> dict:
    out = _empty_totals()
    for key in ("cost", "value", "unrealized", "realized", "dividends", "fees", "total_return"):
        out[key] = sum((r[key] or 0.0) for r in rows)
    out["total_return_pct"] = (out["total_return"] / out["cost"] * 100) if out["cost"] else None
    return out


def overview(benchmark: str | None = None) -> dict:
    all_trades = store.trades()
    if not all_trades:
        return {
            "positions": [],
            "totals": _empty_totals(),
            "series": [],
            "benchmark": None,
            "dividends": [],
            "notes": [],
        }

    today = _today()
    start = min(t["date"] for t in all_trades)
    notes: list[dict] = []
    by_symbol: dict[str, list[dict]] = {}
    for t in all_trades:
        by_symbol.setdefault(t["symbol"], []).append(t)

    rows_out = []
    dividends_all: list[dict] = []
    close_frames: dict[str, pd.Series] = {}
    share_frames: dict[str, pd.Series] = {}

    for symbol, rows in by_symbol.items():
        action_rows = actions_mod.actions(symbol)
        bonus = actions_mod.bonus_events(symbol, action_rows)
        trades_adj = _adjusted_trades(rows, bonus)
        pos = _position(trades_adj)
        divs = _dividend_cash(symbol, trades_adj, action_rows, bonus, today)
        dividends_all.extend(divs)

        closes, stale = _closes(symbol, start, today)
        price = float(closes.iloc[-1]) if not closes.empty else None
        value = pos["shares"] * price if price is not None else None

        if stale:
            notes.append({"code": "prices_refreshing", "symbol": symbol})
        if _oversold(trades_adj):
            notes.append({"code": "oversold", "symbol": symbol})
        for r in action_rows:
            if r["kind"] == "rights" and r["date"] >= start:
                notes.append({"code": "rights_issue", "symbol": symbol, "date": r["date"], "value": r["value"]})
        if closes.empty:
            notes.append({"code": "no_prices", "symbol": symbol})

        dividend_total = sum(d["amount"] for d in divs)
        unrealized = (value - pos["cost"]) if value is not None else None
        total = None if unrealized is None else unrealized + pos["realized"] + dividend_total
        basis = pos["cost"] if pos["cost"] > 1e-9 else 0.0
        rows_out.append(
            {
                "symbol": symbol,
                "shares": pos["shares"],
                "cost": pos["cost"],
                "avg_cost": (pos["cost"] / pos["shares"]) if pos["shares"] > 1e-9 else None,
                "price": price,
                "value": value,
                "unrealized": unrealized,
                "realized": pos["realized"],
                "dividends": dividend_total,
                "fees": pos["fees"],
                "total_return": total,
                "total_return_pct": (total / basis * 100) if total is not None and basis else None,
                "trade_count": len(rows),
            }
        )

        if not closes.empty:
            close_frames[symbol] = closes
            share_frames[symbol] = _share_series(trades_adj, closes.index)

    series = _value_series(close_frames, share_frames, dividends_all, all_trades)
    bench = _benchmark(benchmark, all_trades, series, start, today, notes) if benchmark else None

    rows_out.sort(key=lambda r: (r["value"] is None, -(r["value"] or 0)))
    return {
        "positions": rows_out,
        "totals": _totals(rows_out),
        "series": series,
        "benchmark": bench,
        "dividends": sorted(dividends_all, key=lambda d: d["date"]),
        "notes": notes,
    }
