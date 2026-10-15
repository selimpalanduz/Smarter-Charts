"""
Quarterly financial statements, derived from the raw İş Yatırım rows.

Flow items are reported year-to-date, so a single quarter is the difference
from the previous one. The subtraction happens AFTER restating both to a
common month: the figures either side are in different purchasing power, and
differencing them raw overstates the later quarter. If the previous quarter is
missing the result is left as None rather than letting a year-to-date total
pass for a single quarter.

Ham İş Yatırım satırlarından türetilen çeyreklik mali tablolar.

Akış satırları yıl başından itibaren birikimli raporlanıyor, dolayısıyla tek
çeyrek bir öncekinden çıkarılarak bulunuyor. Çıkarma, ikisi de ortak bir aya
çevrildikten SONRA yapılıyor: iki taraftaki rakamlar farklı paranın değerinde
ve ham halleriyle çıkarmak sonraki çeyreği şişiriyor. Önceki çeyrek eksikse
sonuç None bırakılıyor; yıl başından birikimli toplamın tek çeyrek sanılması
yerine.
"""

from . import inflation, store
from .isyatirim import fetch_quarters, recent_quarters
from .schema import (
    CURRENCY_TRY,
    GROUP_FINANCIAL,
    CURRENCY_USD,
    FLOW,
    REVENUE,
    UNIT_UNSTABLE,
    item_kind,
)

QUARTERS = 28
# Accepted band for (domestic + foreign sales) / revenue once rescaled.
# Yurtiçi+yurtdışı satışın satış gelirine oranı için kabul bandı.
_UNIT_BAND = (0.75, 1.3)
_UNIT_SCALES = (1.0, 1e3, 1e6, 1e-3)


def _previous(period: str) -> str | None:
    """Previous quarter within the same year; None for Q1."""
    year, quarter = period.split("Q")
    return f"{year}Q{int(quarter) - 1}" if int(quarter) > 1 else None


# The first inflation-adjusted report (TMS 29, mandatory from the annual
# report for the period ending 31.12.2023). A column is only moved when the
# report it is served from is itself adjusted: the comparatives in the
# nominal reports before it arrive unscaled.
# İlk enflasyon düzeltmeli rapor (TMS 29, 31.12.2023'te sona eren dönemin
# yıllık raporundan itibaren zorunlu). Bir kolon, ancak servis edildiği rapor
# da düzeltmeliyse taşınıyor: ondan önceki nominal raporların karşılaştırma
# kolonları ölçeksiz geliyor.
TMS29_FROM = "2023Q4"


def _period_key(period: str) -> tuple[int, int]:
    year, quarter = period.split("Q")
    return int(year), int(quarter)


def _mid_month(period: str) -> str:
    """"2022Q2" -> "2022-05", the middle month of the quarter."""
    year, quarter = _period_key(period)
    return f"{year}-{quarter * 3 - 1:02d}"


def _restatement_source(periods: list[str], period: str) -> str | None:
    """
    The report a column is served from: the latest one that carries `period`
    as a comparative, or None when nothing later carries it and the column is
    still in its own money.

    An interim report's comparative income statement is the same period of
    the previous year, so Q1-Q3 are carried by that one report. Its
    comparative balance sheet is the previous YEAR END instead, which makes
    the Q4 column a comparative in every interim report of the following
    year; it arrives in the money of the latest of them.

    Bir kolonun servis edildiği rapor: `period`'u karşılaştırma kolonu olarak
    taşıyan en son rapor; daha sonrası taşımıyorsa None ve kolon kendi
    parasında.

    Ara raporun karşılaştırmalı gelir tablosu geçen yılın aynı dönemi, o
    yüzden Q1-Q3'ü tek bir rapor taşıyor. Karşılaştırmalı bilançosu ise bir
    önceki YIL SONU; bu da Q4 kolonunu ertesi yılın her ara raporunda
    karşılaştırma kolonu yapıyor, kolon da bunların en sonuncusunun parasında
    geliyor.
    """
    year, quarter = _period_key(period)
    # The last report we hold, rather than the presence of one column: a
    # single failed request would otherwise leave a whole year unscaled.
    # Elimizdeki en son rapor; tek bir kolonun varlığı değil: aksi hâlde
    # başarısız tek bir istek bir yılı ölçeksiz bırakır.
    latest = max(periods, key=_period_key)
    if _period_key(latest)[0] <= year:
        return None
    if quarter == 4:
        return latest if _period_key(latest)[0] == year + 1 else f"{year + 1}Q4"
    same = f"{year + 1}Q{quarter}"
    return same if _period_key(same) <= _period_key(latest) else None


def _undo_forward_restatement(values: dict[str, dict[str, float]]) -> list[str]:
    """
    Takes every column back to its own period end, and says which periods
    were moved.

    İş Yatırım serves a period the way the LATEST report carrying it states
    it, not the way its own report did. Once the comparatives are
    inflation-adjusted, that is a column scaled forward by a year of
    inflation — Q1-Q3 to the same quarter of the following year, Q4 to the
    latest interim report of the following year.

    Verified against the published figures for BIMAS, whose 2024 annual
    report states net sales of 328.442mn for 2023 and whose 2025 report
    states 519.567mn for 2024: the raw columns are 474.2mn and 680.1mn, and
    dividing by TÜFE 2023-12 -> 2024-12 and 2024-12 -> 2025-12 returns both
    to four significant figures. The 2024 fourth quarter then comes out at
    129.0mn against the 129.1mn the company reported, which only holds
    because the nine-month column is moved too. Also checked on THYAO
    against Fintables: 2024Q4 scaled by TÜFE 2024-12 -> 2025-12 and 2025Q4
    by 2025-12 -> 2026-06, to four decimals, on income, cash flow and
    balance sheet lines alike, in both the lira and the dollar presentation.

    Left alone it inflates the figures by a year of inflation, makes every
    derived quarter subtract two different currencies from each other, and
    double counts when the real basis scales them again. Undoing the annual
    column alone is worse still: the annual shrinks while the nine months do
    not, and the fourth quarter collapses to nothing.

    Her kolonu kendi dönem sonuna geri getirir, taşınan dönemleri döner.

    İş Yatırım bir dönemi, kendi raporunun değil, onu taşıyan EN SON raporun
    yazdığı gibi veriyor. Karşılaştırma kolonları enflasyon düzeltmeli hâle
    geldikten sonra bu, bir yıllık enflasyon kadar ileri ölçeklenmiş bir
    kolon demek — Q1-Q3 ertesi yılın aynı çeyreğine, Q4 ertesi yılın en son
    ara raporuna.

    BIMAS'ın yayımlanmış rakamlarına karşı doğrulandı: 2024 yıllık raporu
    2023 net satışlarını 328.442mn, 2025 raporu 2024'ü 519.567mn veriyor; ham
    kolonlar 474,2mn ve 680,1mn ve TÜFE'nin 2023-12 -> 2024-12 ile
    2024-12 -> 2025-12 çarpanlarına bölününce ikisi de dört anlamlı basamağa
    kadar yerine oturuyor. 2024'ün dördüncü çeyreği de şirketin açıkladığı
    129,1mn'ye karşı 129,0mn çıkıyor — bu ancak dokuz aylık kolon da
    taşındığı için tutuyor. THYAO'da Fintables'a karşı da kontrol edildi:
    2024Q4 TÜFE ile 2024-12'den 2025-12'ye, 2025Q4 ise 2025-12'den
    2026-06'ya; dört ondalık basamağa kadar, gelir tablosu, nakit akım ve
    bilanço satırlarında aynı şekilde, hem lira hem dolar sunumunda.

    Dokunulmazsa rakamları bir yıllık enflasyon kadar şişiriyor, türetilen
    her çeyreği iki ayrı paranın birbirinden çıkarılması hâline getiriyor ve
    reel tabanda bir kez daha ölçeklenerek çifte sayılıyor. Yalnızca yıllık
    kolonu geri almak daha da kötü: yıllık küçülürken dokuz aylık yerinde
    kalıyor ve dördüncü çeyrek hiçe iniyor.
    """
    periods = sorted({period for series in values.values() for period in series})
    index = inflation.cpi_index()
    if not index:
        return []

    moved = []
    for period in periods:
        source = _restatement_source(periods, period)
        if source is None or _period_key(source) < _period_key(TMS29_FROM):
            continue
        factor = inflation.factor(period, inflation.quarter_end_month(source), index)
        if not factor or factor <= 1:
            continue
        for series in values.values():
            if period in series:
                series[period] /= factor
        moved.append(period)
    return moved


def _rescale_unit_unstable(values: dict[str, dict[str, float]]) -> list[str]:
    """
    Domestic/foreign sales switch unit between reports, so each period is
    rescaled to the power of ten that makes their sum match revenue. A period
    that cannot be reconciled is dropped. Returns the dropped periods.

    Yurtiçi/yurtdışı satış raporlar arasında birim değiştiriyor; her dönem,
    toplamı satış gelirine oturtan on kuvvetiyle ölçekleniyor. Oturtulamayan
    dönem atılıyor. Atılan dönemler döner.
    """
    revenue = values.get(REVENUE) or {}
    present = [code for code in UNIT_UNSTABLE if code in values]
    if not present or not revenue:
        return []

    dropped = []
    periods = set()
    for code in present:
        periods |= set(values[code])

    for period in sorted(periods):
        total = sum(values[code].get(period, 0.0) for code in present)
        reference = revenue.get(period)
        if not reference or not total:
            continue
        best = min(_UNIT_SCALES, key=lambda s: abs(total * s / reference - 1))
        if not (_UNIT_BAND[0] <= total * best / reference <= _UNIT_BAND[1]):
            for code in present:
                values[code].pop(period, None)
            dropped.append(period)
        elif best != 1.0:
            for code in present:
                if period in values[code]:
                    values[code][period] *= best
    return dropped


def rows(
    symbol: str,
    quarters: int = QUARTERS,
    refresh: bool = False,
    currency: str = CURRENCY_TRY,
) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """
    As-reported rows, from disk when they are fresh enough, otherwise fetched
    and written through.

    Raporlandığı gibi satırlar; diskteki yeterince tazeyse oradan, değilse
    çekilip diske yazılarak.
    """
    symbol = symbol.upper()
    if not refresh and store.is_fresh(symbol, quarters, currency):
        values, labels = store.load(symbol, currency)
        if values:
            return values, labels

    values, labels = fetch_quarters(symbol, recent_quarters(quarters), currency=currency)
    if values:
        store.save(symbol, values, labels, quarters, currency)
    return values, labels


def classify(symbol: str) -> str:
    """
    "nonfinancial" when the symbol reports under XI_29, "financial" when it
    only answers under UFRS (banks and insurers, out of scope for now), and
    "unknown" when neither returns anything.

    Only reached when XI_29 came back empty, so the extra request costs
    nothing on the common path.

    Sembol XI_29 altında raporluyorsa "nonfinancial", yalnızca UFRS altında
    cevap veriyorsa "financial" (banka ve sigorta, şimdilik kapsam dışı),
    ikisi de boşsa "unknown".

    Yalnızca XI_29 boş döndüğünde çağrılıyor, yani yaygın yolda ek istek
    maliyeti yok.
    """
    probe = recent_quarters(4)
    values, _ = fetch_quarters(symbol, probe)
    if values:
        return "nonfinancial"
    values, _ = fetch_quarters(symbol, probe, group=GROUP_FINANCIAL)
    return "financial" if values else "unknown"


def quarterly(
    symbol: str,
    quarters: int = QUARTERS,
    real: bool = True,
    refresh: bool = False,
    currency: str = CURRENCY_TRY,
) -> dict:
    """
    {
      "symbol", "target": common month the real figures are stated in,
      "items": {code: {"label", "kind", "periods": {"2025Q4": value | None}}},
      "unitDropped": periods where domestic/foreign sales could not be reconciled,
      "noFactor": periods with no TÜFE multiplier yet (real only),
    }

    In lira, `real=True` restates every figure in the money of the latest
    published TÜFE month and `real=False` leaves them as reported. In dollars
    the figures already share a measuring stick, so TÜFE is not applied — the
    lira index would be the wrong deflator for them.

    Lirada `real=True` her rakamı en son yayınlanan TÜFE ayının parasına
    çevirir, `real=False` raporlandığı gibi bırakır. Dolarda rakamlar zaten
    ortak bir ölçüyü paylaşıyor, o yüzden TÜFE uygulanmıyor — lira endeksi
    onlar için yanlış deflatör olurdu.
    """
    currency = CURRENCY_USD if str(currency).upper() == CURRENCY_USD else CURRENCY_TRY
    real = real and currency == CURRENCY_TRY
    values, labels = rows(symbol, quarters, refresh=refresh, currency=currency)
    # Before anything reads a figure: a column arrives in the money of the
    # latest report carrying it. Done on the whole of what is on disk, so the
    # oldest year in the window still has the following year to look at.
    # Herhangi bir rakam okunmadan önce: kolon, onu taşıyan en son raporun
    # parasında geliyor. Diskteki tüm veri üzerinde yapılıyor ki penceredeki
    # en eski yıl da ertesi yılı görebilsin.
    restated = _undo_forward_restatement(values)
    # Disk may hold more history than asked for; the depth is part of the contract.
    # Diskte istenenden fazla geçmiş olabilir; derinlik sözleşmenin parçası.
    wanted = {f"{year}Q{quarter}" for year, quarter in recent_quarters(quarters)}
    values = {code: {p: v for p, v in series.items() if p in wanted} for code, series in values.items()}
    dropped = _rescale_unit_unstable(values)

    all_periods = sorted({p for series in values.values() for p in series})
    scale: dict[str, float] = {}
    target = None
    no_factor: list[str] = []
    if real:
        scale, target = inflation.factors(all_periods)
        no_factor = [p for p in all_periods if p not in scale]

    # The columns that arrive with no inflation adjustment in them. Before
    # TMS 29 a cumulative flow is a sum of months each in its own money, not
    # a figure in the money of its period end, so scaling it from the period
    # end treats the whole year as if it were earned in December. Those
    # quarters are scaled from the middle month of each quarter instead,
    # which assumes the flow spread evenly through it.
    # _undo_forward_restatement has already moved every column an adjusted
    # report carries, so what it left behind below 2023 is the nominal era.
    # Hiç enflasyon düzeltmesi içermeyen kolonlar. TMS 29 öncesinde birikimli
    # bir akış, her biri kendi parasında olan ayların toplamı; dönem sonunun
    # parasında bir rakam değil. Dönem sonundan ölçeklemek bütün yılı aralıkta
    # kazanılmış saymak olur. Bu çeyrekler onun yerine her çeyreğin orta
    # ayından ölçekleniyor; akışın çeyrek içinde eşit dağıldığı varsayımıyla.
    # _undo_forward_restatement düzeltmeli raporların taşıdığı her kolonu
    # çoktan taşıdı, yani 2023'ün altında geriye kalanlar nominal dönem.
    nominal_era = {
        period
        for period in all_periods
        if _period_key(period)[0] < _period_key(TMS29_FROM)[0] and period not in restated
    }
    index = inflation.cpi_index() if real else {}

    def cumulative(code: str, period: str, kind: str) -> float | None:
        """Year to date in `target` money, or as reported when not real."""
        raw = values[code].get(period)
        if raw is None:
            return None
        if not real:
            return raw
        if kind != FLOW or period not in nominal_era:
            multiplier = scale.get(period)
            return raw * multiplier if multiplier is not None else None

        total = 0.0
        year, quarter = _period_key(period)
        for step in range(1, quarter + 1):
            step_period = f"{year}Q{step}"
            value = values[code].get(step_period)
            if value is None:
                return None
            earlier_period = _previous(step_period)
            if earlier_period is not None:
                earlier = values[code].get(earlier_period)
                if earlier is None:
                    return None
                value -= earlier
            multiplier = inflation.month_factor(_mid_month(step_period), target, index)
            if multiplier is None:
                return None
            total += value * multiplier
        return total

    items: dict[str, dict] = {}
    for code, series in values.items():
        kind = item_kind(code)
        out: dict[str, float | None] = {}
        for period in sorted(series):
            current = cumulative(code, period, kind)
            if kind != FLOW or current is None:
                out[period] = current
                continue
            previous_period = _previous(period)
            if previous_period is None:
                out[period] = current
                continue
            previous = cumulative(code, previous_period, kind)
            out[period] = None if previous is None else current - previous
        items[code] = {"label": labels.get(code, ""), "kind": kind, "periods": out}

    if not values:
        kind = classify(symbol)
        store.remember_sector(symbol, kind)
        return {
            "symbol": symbol.upper(),
            "currency": currency,
            "basis": f"{currency.lower()}-{'real' if real else 'nominal'}",
            "target": None,
            "real": real,
            "items": {},
            "unitDropped": [],
            "noFactor": [],
            "forwardRestated": [],
            "supported": False,
            "sector": kind,
        }

    store.remember_sector(symbol, "nonfinancial")

    return {
        "symbol": symbol.upper(),
        "currency": currency,
        "supported": True,
        "sector": "nonfinancial",
        "basis": f"{currency.lower()}-{'real' if real else 'nominal'}",
        "target": target,
        "real": real,
        "items": items,
        "unitDropped": dropped,
        "noFactor": no_factor,
        "forwardRestated": sorted(p for p in restated if p in wanted),
    }
