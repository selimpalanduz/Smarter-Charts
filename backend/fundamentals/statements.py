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


# The first year whose Q4 column arrives restated. TMS 29 began with the
# annual report for 31.12.2023, so 2024 is the earliest year a later
# inflation-adjusted report restates. Checked against Fintables on THYAO:
# 2021, 2022 and 2023 come through at a ratio of exactly 1.0000, 2024 and
# 2025 scaled. Applying the correction below 2024 drives Q4 revenue negative.
# Q4 kolonu düzeltilmiş gelen ilk yıl. TMS 29, 31.12.2023 yıllık raporuyla
# başladı; dolayısıyla sonraki bir enflasyon düzeltmeli raporun düzelttiği en
# erken yıl 2024. THYAO'da Fintables'a karşı kontrol edildi: 2021, 2022 ve
# 2023 tam 1,0000 oranıyla geliyor, 2024 ve 2025 ölçekli. Düzeltmeyi 2024'ün
# altına uygulamak Q4 satış gelirini negatife düşürüyor.
FORWARD_RESTATED_FROM = 2024


def _restatement_target(periods: list[str], year: int) -> str | None:
    """
    The month a year's Q4 column arrives in: the period end of the latest
    report filed the following year. None when that year has filed nothing
    yet, in which case the column is still in its own money.

    Bir yılın Q4 kolonunun geldiği ay: ertesi yıl açıklanan en son raporun
    dönem sonu. O yıl henüz bir şey açıklamadıysa None; o durumda kolon hâlâ
    kendi parasında.
    """
    later = [p for p in periods if int(p.split("Q")[0]) == year + 1]
    return inflation.quarter_end_month(max(later)) if later else None


def _undo_annual_restatement(values: dict[str, dict[str, float]]) -> list[str]:
    """
    Takes the Q4 column back to its own period end, and says which periods
    were moved.

    İş Yatırım serves Q1-Q3 in the money of their own period end, but from
    FORWARD_RESTATED_FROM onwards it serves Q4 in the money of the NEXT
    report — it is the comparative column as the following year restates it.
    Verified against Fintables on THYAO: 2024Q4 came scaled by TÜFE from
    2024-12 to 2025-12 and 2025Q4 from 2025-12 to 2026-06, to four decimals,
    on income, cash flow and balance sheet lines alike, and in both the lira
    and the dollar presentation. 2021-2023 matched at exactly 1.0000 and are
    left alone.

    Left alone it inflates every annual figure by a year of inflation, makes
    Q4 (annual less nine months) subtract two different currencies from each
    other, and double counts when the real basis scales it again.

    Q4 kolonunu kendi dönem sonuna geri getirir, taşınan dönemleri döner.

    İş Yatırım Q1-Q3'ü kendi dönem sonunun parasında veriyor, ama
    FORWARD_RESTATED_FROM'dan itibaren Q4'ü BİR SONRAKİ raporun parasında —
    ertesi yılın düzelttiği karşılaştırma kolonu bu. THYAO'da Fintables'a
    karşı doğrulandı: 2024Q4 TÜFE ile 2024-12'den 2025-12'ye, 2025Q4 ise
    2025-12'den 2026-06'ya ölçeklenmiş geliyor; dört ondalık basamağa kadar,
    gelir tablosu, nakit akım ve bilanço satırlarında aynı şekilde, hem lira
    hem dolar sunumunda. 2021-2023 tam 1,0000 oranıyla eşleşti, onlara
    dokunulmuyor.

    Dokunulmazsa her yıllık rakamı bir yıllık enflasyon kadar şişiriyor, Q4'ü
    (yıllık eksi dokuz aylık) iki ayrı paranın birbirinden çıkarılması hâline
    getiriyor ve reel tabanda bir kez daha ölçeklenerek çifte sayılıyor.
    """
    periods = sorted({period for series in values.values() for period in series})
    index = inflation.cpi_index()
    if not index:
        return []

    moved = []
    for period in periods:
        year, quarter = period.split("Q")
        if quarter != "4" or int(year) < FORWARD_RESTATED_FROM:
            continue
        target = _restatement_target(periods, int(year))
        if target is None:
            continue
        factor = inflation.factor(period, target, index)
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
    # Before anything reads a figure: the Q4 column arrives in the next
    # report's money. Done on the whole of what is on disk, so the oldest
    # year in the window still has the following year to look at.
    # Herhangi bir rakam okunmadan önce: Q4 kolonu bir sonraki raporun
    # parasında geliyor. Diskteki tüm veri üzerinde yapılıyor ki penceredeki
    # en eski yıl da ertesi yılı görebilsin.
    restated = _undo_annual_restatement(values)
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

    def adjusted(code: str, period: str) -> float | None:
        raw = values[code].get(period)
        if raw is None:
            return None
        if not real:
            return raw
        multiplier = scale.get(period)
        return raw * multiplier if multiplier is not None else None

    items: dict[str, dict] = {}
    for code, series in values.items():
        kind = item_kind(code)
        out: dict[str, float | None] = {}
        for period in sorted(series):
            current = adjusted(code, period)
            if kind != FLOW or current is None:
                out[period] = current
                continue
            previous_period = _previous(period)
            if previous_period is None:
                out[period] = current
                continue
            previous = adjusted(code, previous_period)
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
            "annualRestated": [],
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
        "annualRestated": sorted(p for p in restated if p in wanted),
    }
