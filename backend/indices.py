"""BIST index symbols.

The picker offered only the tradable tickers, so the market's own lines —
BIST 100, BIST 30, the sector indices — could not be charted at all. They
need no new plumbing: TradingView serves an index's candles through the same
request a stock's go through, so `bp.Ticker("XU100")` and the price cache
work unchanged (moves.py has been reading XU100 that way all along).

What they do not have is a company behind them: no statements, no KAP
disclosure, no earnings date, hence no P/E, no P/B and no sector to be
measured against. Everything stock-only asks `is_index()` first and answers
"not applicable" instead of looking for filings that do not exist.

The list is written out here rather than read from borsapy so the order is
ours — the ones worth a chart first — and so it holds without a network
call. frontend/src/symbolList.js reads it over /api/symbols; it is not a
second copy.

BIST endeks sembolleri.

Seçim listesi yalnız işlem gören sembolleri sunuyordu, yani piyasanın kendi
çizgileri — BIST 100, BIST 30, sektör endeksleri — hiç çizilemiyordu. Yeni
bir altyapı gerekmiyor: TradingView bir endeksin mumlarını hissenin
mumlarıyla aynı istekten veriyor, bu yüzden `bp.Ticker("XU100")` ve fiyat
önbelleği olduğu gibi çalışıyor (moves.py XU100'ü başından beri böyle
okuyor).

Olmayan şey arkalarındaki şirket: mali tablo yok, KAP bildirimi yok, bilanço
tarihi yok; dolayısıyla F/K yok, PD/DD yok, karşısında ölçülecek sektör yok.
Yalnız hisseye ait olan her şey önce `is_index()` soruyor ve var olmayan
tabloyu aramak yerine "bu endekste yok" diyor.

Liste borsapy'den okunmak yerine buraya yazıldı; böylece sıra bizim —
grafiği en çok bakılanlar başta — ve ağ olmadan da duruyor.
frontend/src/symbolList.js bunu /api/symbols üzerinden okuyor, ikinci bir
kopya değil.
"""

# Symbol to name, in the order the picker shows them.
# Sembol ve adı, seçim listesinin gösterdiği sırayla.
INDICES: dict[str, str] = {
    "XU100": "BIST 100",
    "XU030": "BIST 30",
    "XU050": "BIST 50",
    "XUTUM": "BIST Tüm",
    "XYLDZ": "BIST Yıldız",
    "XUMAL": "BIST Mali",
    "XUSIN": "BIST Sınai",
    "XBANK": "BIST Banka",
    "XHOLD": "BIST Holding ve Yatırım",
    "XUTEK": "BIST Teknoloji",
    "XILTM": "BIST İletişim",
    "XGIDA": "BIST Gıda İçecek",
    "XKMYA": "BIST Kimya Petrol Plastik",
    "XMANA": "BIST Metal Ana",
    "XMESY": "BIST Metal Eşya Makina",
    "XMADN": "BIST Madencilik",
    "XELKT": "BIST Elektrik",
    "XTEKS": "BIST Tekstil Deri",
    "XTRZM": "BIST Turizm",
    "XULAS": "BIST Ulaştırma",
    "XTCRT": "BIST Ticaret",
    "XINSA": "BIST İnşaat",
    "XSGRT": "BIST Sigorta",
    "XGMYO": "BIST Gayrimenkul Yatırım Ortaklıkları",
    "XYORT": "BIST Yatırım Ortaklıkları",
    "XKTUM": "BIST Katılım Tüm",
    "XK100": "BIST Katılım 100",
    "XK050": "BIST Katılım 50",
    "XK030": "BIST Katılım 30",
    "XKURY": "BIST Kurumsal Yönetim",
    "XSRDK": "BIST Sürdürülebilirlik",
    "XTMTU": "BIST Temettü",
}


def is_index(symbol: str) -> bool:
    return symbol.upper() in INDICES


def index_name(symbol: str) -> str | None:
    return INDICES.get(symbol.upper())


def entries() -> list[dict]:
    """The index rows for /api/symbols."""
    return [{"symbol": s, "name": n, "kind": "index"} for s, n in INDICES.items()]
