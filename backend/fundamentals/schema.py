"""
İş Yatırım MaliTablo line items: which group a symbol reports under, and
whether a line accumulates through the year or is a point-in-time snapshot.

The distinction cannot be inferred from the numbers: a balance sheet total
grows every quarter under high inflation and looks cumulative, while
cumulative free cash flow falls in a heavy-capex quarter and looks like a
snapshot. So it is tabulated by item code instead.

İş Yatırım MaliTablo satırları: sembol hangi grupta raporluyor ve satır yıl
içinde birikiyor mu yoksa o ana ait fotoğraf mı.

Ayrım rakamlardan çıkarılamıyor: yüksek enflasyonda bilanço toplamı her
çeyrek büyüdüğü için birikimli görünüyor, birikimli serbest nakit akım ise
yatırımın ağır olduğu çeyrekte düştüğü için fotoğraf görünüyor. Bu yüzden
satır koduna göre tablolanıyor.
"""

# Non-financial companies, including holdings and REITs. Banks report under
# UFRS with a different, wider schema; out of scope for now.
# Banka ve sigorta dışı şirketler (holding ve GYO dahil). Bankalar UFRS
# altında farklı ve daha geniş bir şemayla raporluyor; şimdilik kapsam dışı.
GROUP_NONFINANCIAL = "XI_29"
GROUP_FINANCIAL = "UFRS"

# İş Yatırım converts flow items at the period's average rate and balance sheet
# items at the period-end rate, which is the correct treatment for each and
# matches the FLOW/STOCK split below. Only "USD" is honoured; anything else
# (including "EUR") silently returns lira.
# İş Yatırım akış kalemlerini dönem ortalama kuruyla, bilanço kalemlerini dönem
# sonu kuruyla çeviriyor; ikisi için de doğru yöntem bu ve aşağıdaki
# FLOW/STOCK ayrımıyla örtüşüyor. Yalnızca "USD" tanınıyor; başka her şey
# ("EUR" dahil) sessizce lira dönüyor.
CURRENCY_TRY = "TRY"
CURRENCY_USD = "USD"
CURRENCIES = (CURRENCY_TRY, CURRENCY_USD)

STOCK = "stock"
FLOW = "flow"

# Snapshots that live under a prefix whose other members are flows.
# Akış satırlarının arasında duran fotoğraf satırları.
_STOCK_EXCEPTIONS = {
    "4BE",   # Net Yabancı Para Pozisyonu
    "4BEA",  # Parasal net YP varlık/(yükümlülük) pozisyonu
    "4BEB",  # Net YPP (Hedge Dahil)
    "4CBK",  # Dönem Başı Nakit Değerler
    "4CBL",  # Dönem Sonu Nakit
}

# Reported per share, so the issuer's own share count is baked in; we compute
# per-share figures ourselves instead of differencing these.
# Hisse başına raporlanıyor, yani şirketin kendi hisse sayısı gömülü; hisse
# başına rakamları bunların farkını alarak değil kendimiz hesaplıyoruz.
UNTRUSTED = {"3ZD", "3ZE", "3ZF", "3ZG"}

# Domestic/foreign sales switch unit between reports (THYAO 2025: billions in
# Q1-Q3, thousands in the annual). Validated against total revenue before use.
# Yurtiçi/yurtdışı satış raporlar arasında birim değiştiriyor (THYAO 2025:
# Q1-Q3 milyar, yıllıkta binlik). Kullanmadan önce satış gelirine karşı
# doğrulanıyor.
UNIT_UNSTABLE = {"4BC", "4BD"}

REVENUE = "3C"
NET_INCOME = "3Z"


def item_kind(code: str) -> str:
    """Whether a line accumulates through the year (FLOW) or is a snapshot (STOCK)."""
    code = code.upper()
    if code in _STOCK_EXCEPTIONS:
        return STOCK
    # Balance sheet.
    # Bilanço.
    if code.startswith(("1", "2")):
        return STOCK
    return FLOW
