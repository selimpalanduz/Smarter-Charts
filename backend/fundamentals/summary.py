"""
The headline lines of a statement set, plus the figures that are pure
statement arithmetic: EBITDA, net debt, margins, export share.

Valuation ratios are not here — those need the share count and the price, and
belong next to the price series rather than in the statements themselves.

Annual aggregation knows the flow/stock split: a flow line is the sum of its
four quarters, a stock line is the year's closing snapshot.

Bir tablo setinin başlık satırları ve saf tablo aritmetiğiyle çıkanlar:
FAVÖK, net borç, marjlar, ihracat payı.

Değerleme rasyoları burada değil — onlar hisse sayısı ve fiyat gerektiriyor,
tabloların içinde değil fiyat serisinin yanında durmaları gerekiyor.

Yıllık toplama akış/fotoğraf ayrımını biliyor: akış satırı dört çeyreğinin
toplamı, fotoğraf satırı yılın kapanış değeri.
"""

from .schema import FLOW, STOCK, item_kind

QUARTER = "quarter"
ANNUAL = "annual"

DEBT_CODES = ["2AA", "2BA"]
SPLIT_CODES = ["4BC", "4BD"]

SECTIONS = [
    {
        "id": "income",
        "label": "Gelir Tablosu",
        "rows": [
            {"code": "3C", "label": "Satış Gelirleri"},
            {"code": "3D", "label": "Brüt Kâr"},
            {"code": "3DF", "label": "Faaliyet Kârı"},
            {"derived": "ebitda", "label": "FAVÖK"},
            {"code": "3Z", "label": "Net Kâr (Ana Ortaklık)"},
            {"derived": "grossMargin", "label": "Brüt Marj", "unit": "pct"},
            {"derived": "operatingMargin", "label": "Faaliyet Marjı", "unit": "pct"},
            {"derived": "netMargin", "label": "Net Marj", "unit": "pct"},
        ],
    },
    {
        "id": "balance",
        "label": "Bilanço",
        "rows": [
            {"code": "1BL", "label": "Toplam Varlıklar"},
            {"code": "1AA", "label": "Nakit ve Nakit Benzerleri"},
            {"derived": "financialDebt", "label": "Finansal Borçlar"},
            {"derived": "netDebt", "label": "Net Borç"},
            {"code": "2N", "label": "Özkaynaklar"},
        ],
    },
    {
        "id": "cashflow",
        "label": "Nakit Akım",
        "rows": [
            {"code": "4C", "label": "İşletme Faaliyetlerinden Nakit"},
            {"code": "4CAI", "label": "Sabit Sermaye Yatırımları"},
            {"code": "4CB", "label": "Serbest Nakit Akım"},
            {"code": "4CBB", "label": "Temettü Ödemeleri"},
        ],
    },
    {
        "id": "exposure",
        "label": "Satış Kırılımı ve Döviz",
        "rows": [
            {"code": "4BC", "label": "Yurtiçi Satışlar"},
            {"code": "4BD", "label": "Yurtdışı Satışlar"},
            {"derived": "exportShare", "label": "İhracat Payı", "unit": "pct"},
            {"code": "4BE", "label": "Net Yabancı Para Pozisyonu"},
            {"code": "4BEB", "label": "Net YP Pozisyonu (Hedge Dahil)"},
        ],
    },
]


def _periods_of(entry: dict) -> dict[str, float | None]:
    return entry.get("periods") or {}


def _series(source: dict, code: str) -> dict[str, float | None]:
    return _periods_of(source.get(code) or {})


def _columns(source: dict) -> list[str]:
    seen: set[str] = set()
    for entry in source.values():
        seen |= set(_periods_of(entry))
    return sorted(seen)


def _sum_codes(source: dict, codes: list[str], columns: list[str]) -> dict[str, float | None]:
    """Sum of several lines; None for a column where every component is missing."""
    out: dict[str, float | None] = {}
    for column in columns:
        values = [_series(source, code).get(column) for code in codes]
        present = [value for value in values if value is not None]
        out[column] = sum(present) if present else None
    return out


def _ratio(
    numerator: dict[str, float | None],
    denominator: dict[str, float | None],
    columns: list[str],
) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for column in columns:
        top, bottom = numerator.get(column), denominator.get(column)
        out[column] = (top / bottom * 100) if top is not None and bottom else None
    return out


def _derive(source: dict, columns: list[str]) -> dict[str, dict]:
    """Lines that are arithmetic over the reported ones."""
    sales = _series(source, "3C")
    operating = _series(source, "3DF")
    depreciation = _series(source, "4B")
    cash = _series(source, "1AA")
    debt = _sum_codes(source, DEBT_CODES, columns)
    split = _sum_codes(source, SPLIT_CODES, columns)

    ebitda: dict[str, float | None] = {}
    for column in columns:
        base, added = operating.get(column), depreciation.get(column)
        # Depreciation is added back, so without it there is no EBITDA to report.
        # Amortisman geri eklendiği için o yoksa raporlanacak FAVÖK de yok.
        ebitda[column] = None if base is None or added is None else base + added

    net_debt: dict[str, float | None] = {}
    for column in columns:
        gross, liquid = debt.get(column), cash.get(column)
        net_debt[column] = None if gross is None else gross - (liquid or 0.0)

    return {
        "ebitda": {"kind": FLOW, "periods": ebitda},
        "financialDebt": {"kind": STOCK, "periods": debt},
        "netDebt": {"kind": STOCK, "periods": net_debt},
        "grossMargin": {"kind": FLOW, "periods": _ratio(_series(source, "3D"), sales, columns)},
        "operatingMargin": {"kind": FLOW, "periods": _ratio(operating, sales, columns)},
        "netMargin": {"kind": FLOW, "periods": _ratio(_series(source, "3Z"), sales, columns)},
        "exportShare": {"kind": FLOW, "periods": _ratio(_series(source, "4BD"), split, columns)},
    }


def _to_annual(periods: dict[str, float | None], kind: str) -> dict[str, float | None]:
    """
    Flow: the sum of four quarters, and nothing when any of them is missing — a
    partial year must not pass for a full one. Stock: the closing snapshot.

    Akış: dört çeyreğin toplamı, biri eksikse hiç — eksik yıl tam yıl
    sanılmasın. Fotoğraf: kapanış değeri.
    """
    years: dict[str, list[tuple[int, float | None]]] = {}
    for period, value in periods.items():
        year, quarter = period.split("Q")
        years.setdefault(year, []).append((int(quarter), value))

    out: dict[str, float | None] = {}
    for year, entries in years.items():
        entries.sort()
        if kind == STOCK:
            out[year] = entries[-1][1]
            continue
        values = [value for _, value in entries]
        complete = len(entries) == 4 and all(value is not None for value in values)
        out[year] = sum(values) if complete else None
    return out


def _quarter_counts(items: dict) -> dict[str, int]:
    """How many quarters each year actually has, so a half year can be marked."""
    counts: dict[str, set[str]] = {}
    for entry in items.values():
        for period in _periods_of(entry):
            year, _ = period.split("Q")
            counts.setdefault(year, set()).add(period)
    return {year: len(periods) for year, periods in counts.items()}


def _annualise(items: dict) -> dict:
    return {
        code: {
            "kind": item_kind(code),
            "periods": _to_annual(_periods_of(entry), item_kind(code)),
        }
        for code, entry in items.items()
    }


def summarise(statements: dict, period: str = QUARTER) -> dict:
    """
    The curated sections for one statement set, quarterly or annual.

    Ratio rows are recomputed from the aggregated components instead of being
    averaged over quarters: the mean of four quarterly margins is not the
    annual margin. So the annual view aggregates the reported lines first and
    derives afterwards.

    Bir tablo setinin seçilmiş bölümleri, çeyreklik ya da yıllık.

    Oran satırları çeyreklerin ortalaması alınarak değil toplanmış
    bileşenlerinden yeniden hesaplanıyor: dört çeyreklik marjın ortalaması
    yıllık marj değildir. Bu yüzden yıllık görünüm önce raporlanan satırları
    topluyor, türetmeyi sonra yapıyor.
    """
    items = statements.get("items") or {}
    annual = period == ANNUAL
    source = _annualise(items) if annual else items
    columns = _columns(source)
    derived = _derive(source, columns)

    # A year still in progress keeps its closing balance sheet but has no full
    # income statement; the caller needs to say so rather than show it level
    # with complete years.
    # Süren yıl kapanış bilançosunu koruyor ama tam gelir tablosu yok; çağıran
    # bunu tam yıllarla aynı hizada göstermek yerine belirtmeli.
    partial = (
        [year for year, count in _quarter_counts(items).items() if count < 4 and year in columns]
        if annual
        else []
    )

    sections = []
    for section in SECTIONS:
        rows = []
        for spec in section["rows"]:
            reported = "code" in spec
            key = spec["code"] if reported else spec["derived"]
            entry = (source if reported else derived).get(key)
            if not entry:
                continue
            values = _periods_of(entry)
            # A row with nothing in any column would render as an empty line.
            # Hiçbir kolonunda değer olmayan satır boş bir çizgi olarak çizilirdi.
            if not any(values.get(column) is not None for column in columns):
                continue
            rows.append(
                {
                    "key": key,
                    "label": spec["label"],
                    "unit": spec.get("unit", "currency"),
                    "kind": entry.get("kind", FLOW),
                    "values": [values.get(column) for column in columns],
                }
            )
        if rows:
            sections.append({"id": section["id"], "label": section["label"], "rows": rows})

    return {
        "symbol": statements.get("symbol"),
        "currency": statements.get("currency"),
        "supported": statements.get("supported", True),
        "sector": statements.get("sector"),
        "basis": statements.get("basis"),
        "target": statements.get("target"),
        "period": ANNUAL if annual else QUARTER,
        "columns": columns,
        "partialColumns": sorted(partial),
        "sections": sections,
        "unitDropped": statements.get("unitDropped") or [],
    }
