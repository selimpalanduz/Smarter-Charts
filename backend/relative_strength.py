"""How a symbol did against its own sector and against XU100.

A rise on its own says little: the whole market may have risen more. What the
reader wants is the difference — the symbol's return minus what its sector
did over the same stretch, and minus what the index did. Plus five percent
while XU100 fell eleven is a different stock from plus five while XU100 rose
fifteen.

The data is two requests to the TradingView scanner: one for every BIST
symbol's sector and four ready-made return columns, one for XU100's. Both
answer in well under a second and the snapshot is held for fifteen minutes,
so a chart that opens twenty symbols pays for it once.

Three things to know before trusting the number:

The sector is TradingView's, in English, and it is sometimes wrong — KCHOL
comes back "Energy Minerals". The sector name is returned with the figures so
a wrong grouping is visible rather than silent.

The sector's return is the median of its other members, not a cap-weighted
index. The median ignores the one member that tripled, which is what makes it
readable; it also means a sector of four is a weak reading, so fewer than
three peers is reported unsupported rather than drawn.

The returns are the scanner's own, computed from unadjusted prices as far as
we can tell, and we do not recompute them. They are good enough for "stronger
or weaker than its peers" and should not be read to the second decimal.

Bir hissenin kendi başına yükselmesi az şey söyler: bütün piyasa daha fazla
yükselmiş olabilir. Okurun istediği şey fark — hissenin getirisi eksi aynı
dönemde sektörünün yaptığı, bir de eksi endeksin yaptığı. XU100 %11 düşerken
%5 artı, XU100 %15 yükselirken %5 artıdan başka bir hissedir.

Veri, TradingView scanner'ına iki istek: biri her BIST sembolünün sektörü ve
dört hazır getiri kolonu için, biri XU100 için. İkisi de bir saniyenin çok
altında cevap veriyor ve anlık görüntü on beş dakika tutuluyor; yani yirmi
sembol açan bir grafik bunu bir kez ödüyor.

Sayıya güvenmeden önce bilinmesi gereken üç şey:

Sektör TradingView'ın sektörü, İngilizce, ve bazen yanlış — KCHOL "Energy
Minerals" olarak geliyor. Sektör adı rakamlarla birlikte dönüyor ki yanlış
gruplama sessiz kalmak yerine görünür olsun.

Sektörün getirisi, diğer üyelerinin medyanı; piyasa değeriyle ağırlıklı bir
endeks değil. Medyan üçe katlanan tek üyeyi görmezden geliyor, okunabilir
olmasını sağlayan da bu; aynı zamanda dört üyeli bir sektörün zayıf bir okuma
olduğu anlamına geliyor, o yüzden üçten az emsal çizilmek yerine desteklenmiyor
olarak bildiriliyor.

Getiriler scanner'ın kendi getirileri, anlayabildiğimiz kadarıyla düzeltilmemiş
fiyatlardan hesaplanıyor ve biz yeniden hesaplamıyoruz. "Emsallerinden güçlü mü
zayıf mı" için yeterli, ikinci ondalığına kadar okunmamalı.
"""

import time
from statistics import median

import httpx

SCANNER_URL = "https://scanner.tradingview.com/turkey/scan"
INDEX_SYMBOL = "XU100"
INDEX_TICKER = f"BIST:{INDEX_SYMBOL}"
CACHE_TTL = 15 * 60
MIN_PEERS = 3

# Period key -> the scanner's column for it.
# Dönem anahtarı -> scanner'daki kolonu.
PERIODS = {"1w": "Perf.W", "1m": "Perf.1M", "3m": "Perf.3M", "ytd": "Perf.YTD"}

_COLUMNS = ["name", "sector", "market_cap_basic", *PERIODS.values()]
_HEADERS = {"User-Agent": "Mozilla/5.0"}

_memory: tuple[float, dict] | None = None


def _rows(payload: dict) -> list[dict]:
    resp = httpx.post(SCANNER_URL, json=payload, timeout=20, headers=_HEADERS)
    resp.raise_for_status()
    return resp.json().get("data", [])


def _perf(values: list) -> dict[str, float]:
    """The four return columns, by period key, skipping the ones that came back empty."""
    out = {}
    for key, column in PERIODS.items():
        value = values[_COLUMNS.index(column)]
        if isinstance(value, (int, float)):
            out[key] = float(value)
    return out


def _fetch() -> dict:
    market = _rows(
        {
            "filter": [{"left": "exchange", "operation": "equal", "right": "BIST"}],
            "columns": _COLUMNS,
            "range": [0, 1500],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        }
    )
    index = _rows(
        {
            "symbols": {"tickers": [INDEX_TICKER], "query": {"types": []}},
            "columns": _COLUMNS,
        }
    )

    symbols = {}
    for row in market:
        values = (row["d"] + [None] * len(_COLUMNS))[: len(_COLUMNS)]
        symbol = values[0]
        if not symbol:
            continue
        symbols[symbol.upper()] = {"sector": values[1], "cap": values[2], "perf": _perf(values)}

    index_perf = {}
    for row in index:
        values = (row["d"] + [None] * len(_COLUMNS))[: len(_COLUMNS)]
        index_perf = _perf(values)

    return {"symbols": symbols, "index": index_perf}


def _snapshot() -> dict:
    """The market snapshot, refetched once the held one is a quarter of an hour old."""
    global _memory
    now = time.time()
    if _memory and now - _memory[0] < CACHE_TTL:
        return _memory[1]
    try:
        snapshot = _fetch()
    except Exception:
        # An expired snapshot still answers "stronger or weaker"; nothing does not.
        # Süresi geçmiş görüntü hâlâ "güçlü mü zayıf mı"yı cevaplıyor; hiçbir şey cevaplamıyor.
        if _memory:
            return _memory[1]
        raise
    _memory = (now, snapshot)
    return snapshot


def relative_strength(symbol: str) -> dict:
    """The symbol's return against its sector's median and against XU100, by period."""
    symbol = symbol.upper()
    snapshot = _snapshot()
    own = snapshot["symbols"].get(symbol)
    if not own:
        return {"symbol": symbol, "supported": False, "reason": "notListed"}
    if not own["perf"]:
        return {"symbol": symbol, "supported": False, "reason": "noReturns"}

    sector = own["sector"]
    peers = [
        row["perf"]
        for name, row in snapshot["symbols"].items()
        if name != symbol and sector and row["sector"] == sector
    ]
    index_perf = snapshot["index"]

    periods = {}
    for key in PERIODS:
        if key not in own["perf"]:
            continue
        values = [p[key] for p in peers if key in p]
        sector_perf = median(values) if len(values) >= MIN_PEERS else None
        entry = {
            "symbol": round(own["perf"][key], 2),
            "sector": round(sector_perf, 2) if sector_perf is not None else None,
            "index": round(index_perf[key], 2) if key in index_perf else None,
            "peers": len(values),
        }
        entry["vsSector"] = round(entry["symbol"] - entry["sector"], 2) if entry["sector"] is not None else None
        entry["vsIndex"] = round(entry["symbol"] - entry["index"], 2) if entry["index"] is not None else None
        periods[key] = entry

    return {
        "symbol": symbol,
        "supported": True,
        "sector": sector,
        "sectorSource": "tradingview",
        "periods": periods,
    }


# The heat map's own figures. Same snapshot, so the map costs no extra request.
# Isı haritasının rakamları. Aynı anlık görüntü, yani harita ek istek maliyeti
# getirmiyor.
MIN_MEMBERS = 3


def _median_by_period(rows: list[dict]) -> dict[str, float]:
    """The median return per period over the given rows, skipping empty columns."""
    out = {}
    for key in PERIODS:
        values = [row["perf"][key] for row in rows if key in row["perf"]]
        if values:
            out[key] = round(median(values), 2)
    return out


def _weighted_by_period(rows: list[dict]) -> dict[str, float]:
    """The cap-weighted return per period, which is what XU100 can be compared with."""
    out = {}
    for key in PERIODS:
        pairs = [
            (row["perf"][key], row["cap"])
            for row in rows
            if key in row["perf"] and isinstance(row.get("cap"), (int, float)) and row["cap"] > 0
        ]
        total = sum(cap for _, cap in pairs)
        if total:
            out[key] = round(sum(perf * cap for perf, cap in pairs) / total, 2)
    return out


def sector_map() -> dict:
    """
    Every sector's return next to the market's, so the question "which sector is
    the money going into" has an answer, and each sector's members with it, so
    "the strongest stock in the strongest sector" does too.

    A sector row is the MEDIAN of its members, and it is compared against the
    MEDIAN OF THE WHOLE MARKET, not against XU100. The two medians are the
    comparable pair: XU100 is cap-weighted, so measuring an equal-weighted
    sector median against it reads as sector strength whenever small caps beat
    large ones across the board, which is a market-wide fact, not a sector's.
    XU100 is still reported, next to the cap-weighted sector return that is
    actually comparable with it.

    Her sektörün getirisi, piyasanın getirisinin yanında — "para hangi sektöre
    akıyor" sorusunun cevabı olsun diye; üyeleriyle birlikte, "güçlü sektörün
    en güçlü hissesi hangisi" sorusunun da cevabı olsun diye.

    Sektör satırı üyelerinin MEDYANI ve karşılaştırıldığı şey XU100 değil, TÜM
    PİYASANIN MEDYANI. Karşılaştırılabilir çift bu iki medyan: XU100 piyasa
    değeriyle ağırlıklı, yani eşit ağırlıklı bir sektör medyanını ona karşı
    ölçmek, küçük hisseler büyükleri topluca geçtiğinde sektör gücü gibi
    okunuyor — oysa bu piyasanın geneline ait bir olgu, o sektöre ait değil.
    XU100 yine veriliyor; yanında da onunla gerçekten karşılaştırılabilir olan,
    piyasa değeriyle ağırlıklı sektör getirisi.
    """
    snapshot = _snapshot()
    rows = [row for row in snapshot["symbols"].values() if row["perf"]]

    groups: dict[str, list] = {}
    for name, row in snapshot["symbols"].items():
        if row["sector"] and row["perf"]:
            groups.setdefault(row["sector"], []).append({**row, "symbol": name})

    market = _median_by_period(rows)
    sectors = []
    dropped = 0
    for sector, members in groups.items():
        if len(members) < MIN_MEMBERS:
            # Too few to read a median from; the badge drops these the same way.
            # Medyan okunamayacak kadar az; rozet de bunları aynı şekilde atıyor.
            dropped += 1
            continue
        sectors.append(
            {
                "sector": sector,
                "members": len(members),
                "median": _median_by_period(members),
                "weighted": _weighted_by_period(members),
                "symbols": sorted(
                    (
                        {
                            "symbol": m["symbol"],
                            "cap": m["cap"] if isinstance(m.get("cap"), (int, float)) else None,
                            "perf": m["perf"],
                        }
                        for m in members
                    ),
                    key=lambda m: m["cap"] or 0,
                    reverse=True,
                ),
            }
        )

    sectors.sort(key=lambda s: s["median"].get("1m", float("-inf")), reverse=True)

    return {
        "periods": list(PERIODS),
        "market": market,
        "index": {k: round(v, 2) for k, v in snapshot["index"].items()},
        "indexSymbol": INDEX_SYMBOL,
        "sectors": sectors,
        "dropped": dropped,
        "asOf": _memory[0] if _memory else None,
        "sectorSource": "tradingview",
    }
