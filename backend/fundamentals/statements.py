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

    return {
        "symbol": symbol.upper(),
        "currency": currency,
        "basis": f"{currency.lower()}-{'real' if real else 'nominal'}",
        "target": target,
        "real": real,
        "items": items,
        "unitDropped": dropped,
        "noFactor": no_factor,
    }
