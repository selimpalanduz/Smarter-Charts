"""Bilanço açıklama işaretleri.

Açıklanma anı KAP'tan (saniyesine kadar), net kâr İş Yatırım'dan, fiyat
tepkisi yerel fiyat önbelleğinden gelir. KAP sorgu API'si tek istekte en
fazla ~1 yıllık aralık kabul ettiği için yıl yıl soruyoruz.
"""

import math
import time
from datetime import datetime, timedelta

import borsapy as bp
from borsapy._providers.kap import get_kap_provider

import price_cache
from data_provider import get_quarterly_net_income

KAP_QUERY_URL = "https://www.kap.org.tr/tr/api/disclosure/members/byCriteria"
YEARS_BACK = 3
REACTION_DAYS = 5
MARKET_OPEN_HOUR = 10  # bu saatten önceki açıklamaya fiyat aynı gün tepki verir
CACHE_TTL = 3600

_cache: dict[str, tuple[float, dict]] = {}


def _query_kap_year(client, member_oid: str, year: int) -> list[dict]:
    body = {
        "fromDate": f"{year}-01-01",
        "toDate": f"{year}-12-31",
        "memberType": "IGS",
        "mkkMemberOidList": [member_oid],
        "disclosureClass": "FR",
        "inactiveMkkMemberOidList": [],
        "subjectList": [],
        "isLate": "",
        "mainSector": "",
        "sector": "",
        "subSector": "",
        "marketOidList": [],
        "index": "",
        "bdkReview": "",
        "bdkMemberOidList": [],
        "year": "",
        "term": "",
        "ruleType": "",
        "period": "",
        "fromSrc": False,
        "srcCategory": "",
        "discIndex": [],
    }
    try:
        items = client.post(KAP_QUERY_URL, json=body, timeout=15).json()
    except Exception:
        return []
    return items if isinstance(items, list) else []


def _fetch_announcements(symbol: str) -> list[dict]:
    """Her (yıl, çeyrek) için ilk 'Finansal Rapor' bildirimi; düzeltmeler elenir."""
    kap = get_kap_provider()
    member_oid = kap.get_member_oid(symbol)
    if not member_oid:
        return []

    this_year = datetime.now().year
    by_period: dict[tuple[int, int], dict] = {}
    for year in range(this_year - YEARS_BACK, this_year + 1):
        for item in _query_kap_year(kap._client, member_oid, year):
            if item.get("subject") != "Finansal Rapor":
                continue
            try:
                key = (int(item["year"]), int(item["period"]))
                published = datetime.strptime(item["publishDate"], "%d.%m.%Y %H:%M:%S")
            except (KeyError, TypeError, ValueError):
                continue
            if key not in by_period or published < by_period[key]["published"]:
                by_period[key] = {
                    "published": published,
                    "year": key[0],
                    "quarter": key[1],
                    "url": f"https://www.kap.org.tr/tr/Bildirim/{item.get('disclosureIndex')}",
                }

    return sorted(by_period.values(), key=lambda a: a["published"])


def _price_reaction(closes: list[tuple[str, float]], published: datetime) -> tuple[str | None, float | None, int]:
    """(tepki günü, % değişim, kaç işlem günü kullanıldı)."""
    effective = published.date() if published.hour < MARKET_OPEN_HOUR else published.date() + timedelta(days=1)
    effective_str = effective.isoformat()

    idx = next((i for i, (d, _) in enumerate(closes) if d >= effective_str), None)
    if idx is None or idx == 0:
        return None, None, 0

    base = closes[idx - 1][1]
    end_idx = min(idx + REACTION_DAYS - 1, len(closes) - 1)
    days = end_idx - idx + 1
    pct = (closes[end_idx][1] / base - 1) * 100 if base else None
    return closes[idx][0], (round(pct, 2) if pct is not None else None), days


def _next_expected(symbol: str) -> str | None:
    try:
        dates = bp.Ticker(symbol).earnings_dates
    except Exception:
        return None
    today = datetime.now().date()
    upcoming = [d.date() for d in dates.index if d.date() >= today]
    return min(upcoming).isoformat() if upcoming else None


def _clean(value) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return float(value)


def get_earnings(symbol: str) -> dict:
    """
    Fiyat önbelleğini burada ısıtmıyoruz; frontend bu endpoint'i fiyat
    isteğinden sonra çağırıyor (bkz. sr_zones.get_sr_zones).
    """
    symbol = symbol.upper()
    now = time.time()
    cached = _cache.get(symbol)
    if cached and (now - cached[0]) < CACHE_TTL:
        return cached[1]

    announcements = _fetch_announcements(symbol)
    try:
        net_income = get_quarterly_net_income(symbol)
    except Exception:
        net_income = None

    closes: list[tuple[str, float]] = []
    if announcements:
        start = (announcements[0]["published"] - timedelta(days=10)).strftime("%Y-%m-%d")
        end = datetime.now().strftime("%Y-%m-%d")
        df = price_cache.query_range(symbol, start, end)
        closes = [(idx.strftime("%Y-%m-%d"), float(c)) for idx, c in df["Close"].items()] if not df.empty else []

    events = []
    for a in announcements:
        date, reaction, days = _price_reaction(closes, a["published"])
        if date is None:
            continue

        ni = prev_ni = None
        if net_income is not None:
            ni = _clean(net_income.get(f"{a['year']}Q{a['quarter']}"))
            prev_ni = _clean(net_income.get(f"{a['year'] - 1}Q{a['quarter']}"))
        yoy = round((ni - prev_ni) / abs(prev_ni) * 100, 1) if ni is not None and prev_ni else None

        events.append(
            {
                "date": date,
                "publishedAt": a["published"].strftime("%Y-%m-%d %H:%M"),
                "period": f"{a['year']} Q{a['quarter']}",
                "netIncome": ni,
                "netIncomeYoY": yoy,
                "reactionPct": reaction,
                "reactionDays": days,
                "url": a["url"],
            }
        )

    result = {"events": events, "next": _next_expected(symbol)}
    _cache[symbol] = (now, result)
    return result
