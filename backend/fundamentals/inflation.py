"""
TÜFE index for restating figures in a common purchasing power.

Figures reach this module stated in the money of their own period end:
pre-2024 rows because that is when the money was earned, and
inflation-adjusted rows (TMS 29, mandatory from the annual report for the
period ending 31.12.2023) because each report restates everything to its own
reporting date. One rule therefore covers the whole series — scale by TÜFE
from the period end to a common month.

That holds only because statements._undo_forward_restatement has already
run: İş Yatırım serves each column in the money of the latest report
carrying it, not its own. Scaling it here without that step would count a
year of inflation twice.

The index is chained from monthly rates rather than read as a level: TCMB's
calculator does return a level but answers 500 for some date pairs. Only
ratios between months are used, so the base is arbitrary; chaining reproduces
TCMB's own 2021-12 to 2025-12 ratio to within 0.003%.

Rakamları ortak bir paranın değerine getirmek için TÜFE endeksi.

Bu modüle gelen rakamlar kendi dönem sonundaki paranın değerinde: 2024 öncesi
satırlar para o zaman kazanıldığı için, enflasyon düzeltmeli satırlar (TMS 29,
31.12.2023'te sona eren dönemin yıllık raporundan itibaren zorunlu) ise her
rapor her şeyi kendi raporlama tarihine çevirdiği için. Dolayısıyla tüm seri
için tek kural yeterli — dönem sonundan ortak bir aya TÜFE ile ölçekle.

Bu ancak statements._undo_forward_restatement çalıştıktan sonra geçerli: İş
Yatırım her kolonu kendi parasında değil, onu taşıyan en son raporun
parasında veriyor. O adım olmadan burada ölçeklemek bir yıllık enflasyonu
iki kez saymak olur.

Endeks seviye olarak okunmuyor, aylık oranlardan zincirleniyor: TCMB'nin
hesaplayıcısı seviye veriyor ama bazı tarih çiftlerinde 500 dönüyor. Yalnızca
aylar arası oran kullanıldığı için taban keyfi; zincirleme TCMB'nin kendi
2021-12 / 2025-12 oranını %0.003 sapmayla yeniden üretiyor.
"""

import time

import borsapy as bp

# Seconds; TÜİK publishes TÜFE once a month.
# Saniye; TÜİK TÜFE'yi ayda bir yayınlıyor.
CACHE_TTL = 6 * 3600
BASE = 100.0

_cache: tuple[float, dict[str, float]] | None = None


def cpi_index() -> dict[str, float]:
    """{"2026-08": level} from 2005-01 to the latest published month."""
    global _cache
    now = time.time()
    if _cache and (now - _cache[0]) < CACHE_TTL:
        return _cache[1]

    frame = bp.Inflation().tufe().sort_index()
    level = BASE
    index: dict[str, float] = {}
    for stamp, row in frame.iterrows():
        monthly = row.get("MonthlyInflation")
        if monthly is None:
            continue
        level *= 1 + float(monthly) / 100.0
        index[stamp.strftime("%Y-%m")] = level

    if index:
        _cache = (now, index)
    return index


def latest_month(index: dict[str, float] | None = None) -> str | None:
    index = index if index is not None else cpi_index()
    return max(index) if index else None


def quarter_end_month(period: str) -> str:
    """"2025Q4" -> "2025-12"."""
    year, quarter = period.split("Q")
    return f"{year}-{int(quarter) * 3:02d}"


def factor(period: str, target: str, index: dict[str, float] | None = None) -> float | None:
    """
    Multiplier bringing a figure reported for `period` into `target` month money.

    `period`'da raporlanmış bir rakamı `target` ayının parasına getiren çarpan.
    """
    index = index if index is not None else cpi_index()
    source = index.get(quarter_end_month(period))
    destination = index.get(target)
    if not source or not destination:
        return None
    return destination / source


def factors(periods: list[str], target: str | None = None) -> tuple[dict[str, float], str | None]:
    """
    ({period: multiplier}, target month actually used).

    A period ending after the last published TÜFE month gets no multiplier
    rather than an extrapolated one.

    Henüz TÜFE yayınlanmamış bir ayda sona eren döneme, tahmin edilmiş çarpan
    yerine hiç çarpan verilmiyor.
    """
    index = cpi_index()
    if not index:
        return {}, None
    target = target or latest_month(index)
    out = {}
    for period in periods:
        value = factor(period, target, index)
        if value is not None:
            out[period] = value
    return out, target
