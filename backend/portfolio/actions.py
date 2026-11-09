"""Dividends, bonus issues and rights issues, and the units they live in.

Three facts drive everything here, each checked against the feed:

1. The price series is bonus-adjusted. A bonus issue therefore needs no
   return correction at all — it is already in the prices. What it does need
   is a unit conversion, because a trade entered before it is in that day's
   share count while the series is in today's.
2. The price series is not dividend-adjusted. A dividend is real return that
   the prices drop out, so it has to be added back by hand.
3. Dividend amounts are reported in the share count of their own date, not
   today's. FROTO paid 43.30 on 2024-04-08 and split 10x in 2025, so the
   figure belongs next to prices ten times larger than today's. Dividing it
   by the bonus factor since then is what puts it in the series' units.

A rights issue is a cash subscription: new shares bought with new money. The
price series does not adjust for it and neither do we — it belongs in the
trade list as the purchase it was. The feed's rights rows are kept only so
the user can be told one happened.

Temettü, bedelsiz ve bedelli; ve hangi birimde durdukları.

Buradaki her şeyi üç olgu belirliyor, üçü de kaynak üzerinde doğrulandı:

1. Fiyat serisi bedelsize göre düzeltilmiş. Yani bedelsiz için getiri
   düzeltmesi gerekmiyor, zaten fiyatın içinde. Gereken şey birim çevrimi:
   öncesinde girilmiş bir işlem o günün adedinde, seri ise bugünün.
2. Fiyat serisi temettüye göre düzeltilmemiş. Temettü, fiyatın düşürdüğü
   gerçek getiri; elle geri eklenmesi gerekiyor.
3. Temettü tutarları bugünün değil, kendi tarihinin hisse adedinde
   bildiriliyor. FROTO 08.04.2024'te 43.30 dağıttı ve 2025'te 10'a bölündü;
   yani o rakam, bugünkünün on katı fiyatların yanına ait. O tarihten
   sonraki bedelsiz çarpanına bölmek, onu serinin birimine getiriyor.

Bedelli artırım nakit taahhüt: yeni parayla alınan yeni hisse. Fiyat serisi
onu düzeltmiyor, biz de düzeltmiyoruz — olduğu gibi, bir alım olarak işlem
listesine girer. Kaynağın bedelli satırları yalnızca kullanıcıya "böyle bir
şey oldu" diyebilmek için tutuluyor.
"""

import time

import borsapy as bp
import pandas as pd

from . import store

# A symbol's actions are refetched at most this often. Dividends are declared
# weeks ahead and a bonus issue is not a surprise either, so a day is plenty.
# Bir sembolün hareketleri en sık bu aralıkla yeniden çekiliyor. Temettü
# haftalar önceden ilan ediliyor, bedelsiz de sürpriz değil; bir gün bol.
MAX_AGE_SECONDS = 24 * 60 * 60


def _as_date(value) -> str | None:
    try:
        ts = pd.Timestamp(value)
    except (ValueError, TypeError):
        return None
    return None if pd.isna(ts) else ts.strftime("%Y-%m-%d")


def _fetch(symbol: str) -> list[tuple[str, str, float]]:
    ticker = bp.Ticker(symbol)
    rows: list[tuple[str, str, float]] = []

    try:
        divs = ticker.dividends
    except Exception:
        divs = None
    if divs is not None and not getattr(divs, "empty", True):
        for date, row in divs.iterrows():
            day = _as_date(date)
            if day is None:
                continue
            # NetRate is withholding already taken off, which is what reached
            # the account; it is a percentage of the nominal, hence /100.
            # NetRate stopajı düşülmüş hâli, yani hesaba geçen tutar; nominalin
            # yüzdesi olduğu için /100.
            net = row.get("NetRate")
            amount = net / 100 if net is not None and not pd.isna(net) else row.get("Amount")
            if amount is None or pd.isna(amount) or amount <= 0:
                continue
            rows.append(("dividend", day, float(amount)))

    try:
        splits = ticker.splits
    except Exception:
        splits = None
    if splits is not None and not getattr(splits, "empty", True):
        for date, row in splits.iterrows():
            day = _as_date(date)
            if day is None:
                continue
            bonus = 0.0
            for column in ("BonusFromCapital", "BonusFromDividend"):
                value = row.get(column)
                if value is not None and not pd.isna(value):
                    bonus += float(value)
            if bonus > 0:
                rows.append(("bonus", day, bonus))
            rights = row.get("RightsIssue")
            if rights is not None and not pd.isna(rights) and float(rights) > 0:
                rows.append(("rights", day, float(rights)))

    return rows


def refresh(symbol: str, force: bool = False) -> None:
    symbol = symbol.upper()
    fetched_at = store.feed_fetched_at(symbol)
    if not force and fetched_at is not None and time.time() - fetched_at < MAX_AGE_SECONDS:
        return
    try:
        rows = _fetch(symbol)
    except Exception:
        # A dead feed must not take the portfolio down with it; what is
        # already cached keeps serving, and the age is left alone so the
        # next request tries again.
        # Ölü bir kaynak portföyü de yanında götürmesin; önbellekteki
        # çalışmaya devam eder, yaş da dokunulmadan bırakılır ki sonraki
        # istek tekrar denesin.
        return
    store.save_feed_actions(symbol, rows, time.time())


def actions(symbol: str, refresh_first: bool = True) -> list[dict]:
    """Fetched and hand-entered actions as one list. A hand-entered one wins.

    The override is by kind and date: that is the grain the user can see and
    correct. Without it a wrong feed figure could never be fixed, only
    doubled.

    Çekilen ve elle girilen hareketler tek liste. Elle girilen kazanır.

    Üstüne yazma tür ve tarih bazında: kullanıcının görüp düzeltebildiği
    ayrım bu. Olmasa, kaynaktaki yanlış bir rakam düzeltilemez, sadece iki
    katına çıkarılabilirdi.
    """
    symbol = symbol.upper()
    if refresh_first:
        refresh(symbol)
    merged: dict[tuple[str, str], dict] = {}
    for row in store.feed_actions(symbol):
        merged[(row["kind"], row["date"])] = {
            "kind": row["kind"],
            "date": row["date"],
            "value": row["value"],
            "source": "feed",
        }
    for row in store.manual_actions(symbol):
        merged[(row["kind"], row["date"])] = {
            "kind": row["kind"],
            "date": row["date"],
            "value": row["value"],
            "source": "manual",
            "note": row["note"],
        }
    return sorted(merged.values(), key=lambda r: (r["date"], r["kind"]))


def bonus_events(symbol: str, rows: list[dict] | None = None) -> list[tuple[str, float]]:
    """(date, factor) per bonus issue; factor 7.0 means one share became seven."""
    rows = actions(symbol) if rows is None else rows
    return [(r["date"], 1.0 + r["value"] / 100.0) for r in rows if r["kind"] == "bonus"]


def factor_since(date: str, events: list[tuple[str, float]]) -> float:
    """Bonus factor applied strictly after `date`.

    Strictly after, because a trade on the bonus date itself already prices
    the new shares — the adjusted series and the exchange both switched that
    morning.

    `date` tarihinden kesinlikle sonra uygulanan bedelsiz çarpanı.

    Kesinlikle sonra, çünkü bedelsiz gününde yapılan işlem yeni adedi zaten
    fiyatlıyor — düzeltilmiş seri de borsa da o sabah geçiş yaptı.
    """
    factor = 1.0
    for event_date, event_factor in events:
        if event_date > date:
            factor *= event_factor
    return factor
