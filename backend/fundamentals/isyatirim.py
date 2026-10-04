"""
Raw financial statement rows from İş Yatırım's MaliTablo endpoint.

borsapy's get_income_stmt() guesses which quarter may have been published
from a FIXED month and never checks whether the data exists, so the endpoint
is queried directly, stepping back from the ACTUAL current quarter.

The endpoint requires all four year/period slots on every request — omitting
year2 returns a NumberFormatException for the literal "{year2}" — so a short
final batch is padded with repeats of its first period.

İş Yatırım MaliTablo uç noktasından ham mali tablo satırları.

borsapy'nin get_income_stmt() fonksiyonu hangi çeyreğin yayınlanmış
olabileceğini SABİT bir aya göre tahmin ediyor ve veri var mı diye hiç
sormuyor; bu yüzden uç noktaya ŞU ANKİ gerçek çeyrekten geriye doğru
kendimiz soruyoruz.

Uç nokta her istekte dört yıl/dönem slotunun tamamını zorunlu kılıyor —
year2 verilmezse "{year2}" dizgisi için NumberFormatException dönüyor — o
yüzden eksik kalan son grup, ilk dönemin tekrarıyla dolduruluyor.
"""

from datetime import datetime

import httpx

from .schema import GROUP_NONFINANCIAL

URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)
SLOTS = 4
TIMEOUT = 20


def recent_quarters(count: int) -> list[tuple[int, int]]:
    """(year, quarter) pairs, newest first, from the current calendar quarter back."""
    now = datetime.now()
    year, quarter = now.year, (now.month - 1) // 3 + 1
    out = []
    for _ in range(count):
        out.append((year, quarter))
        quarter -= 1
        if quarter == 0:
            quarter = 4
            year -= 1
    return out


def fetch_quarters(
    symbol: str, quarters: list[tuple[int, int]], group: str = GROUP_NONFINANCIAL
) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """
    ({item_code: {"2025Q4": value}}, {item_code: Turkish description}).

    Values are as reported: year-to-date cumulative for flow items, a snapshot
    for balance sheet items, each in the purchasing power of its own period end.

    Değerler raporlandığı gibi: akış satırları için yıl başından itibaren
    birikimli, bilanço satırları için fotoğraf, her biri kendi dönem sonundaki
    paranın değerinde.
    """
    values: dict[str, dict[str, float]] = {}
    labels: dict[str, str] = {}

    for start in range(0, len(quarters), SLOTS):
        batch = quarters[start : start + SLOTS]
        padded = batch + [batch[0]] * (SLOTS - len(batch))

        params = {"companyCode": symbol.upper(), "exchange": "TRY", "financialGroup": group}
        for i, (year, quarter) in enumerate(padded, 1):
            params[f"year{i}"] = year
            params[f"period{i}"] = quarter * 3

        try:
            response = httpx.get(URL, params=params, timeout=TIMEOUT)
            items = response.json().get("value") or []
        except Exception:
            continue

        for item in items:
            code = str(item.get("itemCode") or "").strip()
            if not code:
                continue
            labels.setdefault(code, (item.get("itemDescTr") or "").strip())
            # Only the real slots; padding repeats batch[0] and would overwrite it.
            # Sadece gerçek slotlar; doldurma batch[0]'ı tekrarlıyor ve üzerine yazardı.
            for i, (year, quarter) in enumerate(batch, 1):
                raw = item.get(f"value{i}")
                if raw is None or raw == "":
                    continue
                try:
                    values.setdefault(code, {})[f"{year}Q{quarter}"] = float(raw)
                except (TypeError, ValueError):
                    continue

    return values, labels
