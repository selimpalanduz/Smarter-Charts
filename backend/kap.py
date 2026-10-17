"""
KAP disclosures: yearly lists and explanation texts, cached in SQLite.

KAP bildirimleri: yıllık listeler ve açıklama metinleri, SQLite'ta önbelleklenir.
"""

import re
import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from bs4 import BeautifulSoup
from borsapy._providers.kap import get_kap_provider

KAP_QUERY_URL = "https://www.kap.org.tr/tr/api/disclosure/members/byCriteria"
DB_PATH = Path(__file__).parent / "data" / "kap.db"
# Seconds between refreshes of the current year's list.
# Güncel yılın listesinin tazelenme aralığı (saniye).
CURRENT_YEAR_TTL = 600
# A report filed before this hour can be traded on the same day; anything
# later first meets the market at the next session.
# Bu saatten önce verilen rapora aynı gün işlem yapılabilir; daha sonrası
# piyasayla ilk kez ertesi seansta buluşur.
MARKET_OPEN_HOUR = 10
MAX_TEXT_CHARS = 700

# Routine ODA subjects that don't explain price moves.
# Fiyat hareketini açıklamayan rutin ODA konuları.
EXCLUDED_SUBJECTS = {
    "Genel Kurul İşlemlerine İlişkin Bildirim",
    "Bağımsız Denetim Kuruluşunun Belirlenmesi",
    "Yönetim Kurulu Komiteleri",
    "Kurumsal Yönetim İlkelerine Uyum Derecelendirmesi",
    "Bilgilendirme Politikası",
    "Kar Dağıtım Politikası",
    "Hak Kullanım Süreç İptal Bildirimi",
    "İhraç Tavanına İlişkin Bildirim",
    "Kayıtlı Sermaye Tavanı İşlemlerine İlişkin Bildirim",
    "Esas Sözleşme Tadili",
    "Pay Dışında Sermaye Piyasası Aracı İşlemlerine İlişkin Bildirim (Faiz İçeren)",
    "Pay Dışında Sermaye Piyasası Aracı İşlemlerine İlişkin Bildirim (Faiz İçermeyen)",
}

_TEXT_END_MARKERS = (
    "Yukarıdaki açıklamalarımızın",
    "İşbu açıklamamızın İngilizce",
    "İşbu açıklama İngilizce",
)
_ENGLISH_HINTS = (
    " the ", " of ", " and ", " for ", " to ", " with ", " is ", " are ", " in ",
    " has been ", " will be ", " our ", " company", " between ",
)
_TURKISH_CHARS = set("çğıöşüÇĞİÖŞÜ")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS disclosures (
            id INTEGER PRIMARY KEY,
            symbol TEXT NOT NULL,
            published TEXT NOT NULL,
            class TEXT,
            subject TEXT,
            summary TEXT
        );
        CREATE INDEX IF NOT EXISTS disclosures_symbol ON disclosures (symbol, published);
        CREATE TABLE IF NOT EXISTS fetched_years (
            symbol TEXT NOT NULL,
            year INTEGER NOT NULL,
            fetched_at REAL NOT NULL,
            PRIMARY KEY (symbol, year)
        );
        CREATE TABLE IF NOT EXISTS texts (
            id INTEGER PRIMARY KEY,
            text TEXT
        );
        CREATE TABLE IF NOT EXISTS reports (
            symbol TEXT NOT NULL,
            year INTEGER NOT NULL,
            quarter INTEGER NOT NULL,
            published TEXT NOT NULL,
            disclosure_id INTEGER,
            PRIMARY KEY (symbol, year, quarter)
        );
        CREATE TABLE IF NOT EXISTS fetched_report_years (
            symbol TEXT NOT NULL,
            year INTEGER NOT NULL,
            fetched_at REAL NOT NULL,
            PRIMARY KEY (symbol, year)
        );
        """
    )
    return conn


def query_year(client, member_oid: str, year: int, disclosure_class: str = "") -> list[dict] | None:
    """
    One KAP query for a whole year (the API rejects ranges longer than ~1 year). None on failure.

    Bir yıl için tek KAP sorgusu (API ~1 yıldan uzun aralığı kabul etmiyor). Hata olursa None.
    """
    body = {
        "fromDate": f"{year}-01-01",
        "toDate": f"{year}-12-31",
        "memberType": "IGS",
        "mkkMemberOidList": [member_oid],
        "disclosureClass": disclosure_class,
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
        return None
    return items if isinstance(items, list) else None


def tradable_from(published: datetime) -> date:
    """The first session that could act on a disclosure published at this moment."""
    return published.date() if published.hour < MARKET_OPEN_HOUR else published.date() + timedelta(days=1)


def _is_relevant(item: dict) -> bool:
    cls, subject = item.get("disclosureClass"), item.get("subject")
    if cls == "FR":
        return subject == "Finansal Rapor"
    return cls == "ODA" and subject not in EXCLUDED_SUBJECTS


def _year_is_fresh(conn: sqlite3.Connection, symbol: str, year: int, table: str = "fetched_years") -> bool:
    row = conn.execute(
        f"SELECT fetched_at FROM {table} WHERE symbol = ? AND year = ?", (symbol, year)
    ).fetchone()
    if row is None:
        return False
    fetched_at = row[0]
    # A past year is final once it was fetched after the year ended.
    # Geçmiş bir yıl, yıl bittikten sonra çekildiyse kesinleşmiştir.
    if year < datetime.now().year:
        return fetched_at >= datetime(year + 1, 1, 1).timestamp()
    return time.time() - fetched_at < CURRENT_YEAR_TTL


def _refresh_year(conn: sqlite3.Connection, kap, member_oid: str, symbol: str, year: int) -> None:
    items = query_year(kap._client, member_oid, year)
    if items is None:
        return
    rows = []
    for item in items:
        if not _is_relevant(item):
            continue
        try:
            published = datetime.strptime(item["publishDate"], "%d.%m.%Y %H:%M:%S")
            disclosure_id = int(item["disclosureIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        rows.append(
            (
                disclosure_id,
                symbol,
                published.strftime("%Y-%m-%d %H:%M:%S"),
                item.get("disclosureClass"),
                item.get("subject"),
                (item.get("summary") or "").strip(),
            )
        )
    conn.executemany("INSERT OR REPLACE INTO disclosures VALUES (?, ?, ?, ?, ?, ?)", rows)

    # A correction carries the same (year, quarter); the earliest publication is
    # the one the market traded on, so a later row never overwrites it.
    # Düzeltme aynı (yıl, çeyrek) ile gelir; piyasanın işlem yaptığı an ilk
    # yayım anıdır, sonraki satır onu ezmez.
    conn.executemany(
        """
        INSERT INTO reports VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (symbol, year, quarter) DO UPDATE SET
            published = excluded.published,
            disclosure_id = excluded.disclosure_id
        WHERE excluded.published < reports.published
        """,
        _report_rows(items, symbol),
    )
    stamp = time.time()
    conn.execute("INSERT OR REPLACE INTO fetched_years VALUES (?, ?, ?)", (symbol, year, stamp))
    conn.execute("INSERT OR REPLACE INTO fetched_report_years VALUES (?, ?, ?)", (symbol, year, stamp))
    conn.commit()


def _report_rows(items: list[dict], symbol: str) -> list[tuple]:
    """
    A financial report's (period, publication) pairs. A calendar-year query
    returns the reports PUBLISHED that year, so a year's Q4 arrives with the
    next year's query — the caller's year range has to allow for that.

    Bir mali tablonun (dönem, yayım) çiftleri. Takvim yılı sorgusu o yıl
    YAYIMLANAN raporları döndürür, yani bir yılın Q4'ü ertesi yılın
    sorgusuyla gelir — çağıranın yıl aralığı bunu hesaba katmalı.
    """
    rows = []
    for item in items:
        if item.get("disclosureClass") != "FR" or item.get("subject") != "Finansal Rapor":
            continue
        try:
            year, quarter = int(item["year"]), int(item["period"])
            published = datetime.strptime(item["publishDate"], "%d.%m.%Y %H:%M:%S")
            disclosure_id = int(item["disclosureIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= quarter <= 4:
            continue
        rows.append((symbol, year, quarter, published.strftime("%Y-%m-%d %H:%M:%S"), disclosure_id))
    return rows


def financial_reports(symbol: str, from_year: int) -> list[dict]:
    """
    When each financial report first reached KAP, oldest first. This is the
    only honest date to attach a figure to: until it is published, nobody
    trading could know it.

    Her mali tablonun KAP'a ilk düştüğü an, eskiden yeniye. Bir rakamı
    bağlayabileceğimiz tek dürüst tarih bu: yayımlanana kadar işlem yapan
    hiç kimse onu bilemez.
    """
    symbol = symbol.upper()
    conn = _connect()
    try:
        years = range(from_year, datetime.now().year + 1)
        stale = [y for y in years if not _year_is_fresh(conn, symbol, y, "fetched_report_years")]
        if stale:
            kap = get_kap_provider()
            member_oid = kap.get_member_oid(symbol)
            if member_oid:
                for year in stale:
                    _refresh_year(conn, kap, member_oid, symbol, year)

        rows = conn.execute(
            """
            SELECT year, quarter, published, disclosure_id FROM reports
            WHERE symbol = ? AND year >= ? ORDER BY published
            """,
            (symbol, from_year),
        ).fetchall()
    finally:
        conn.close()

    return [
        {
            "year": r[0],
            "quarter": r[1],
            "period": f"{r[0]}Q{r[1]}",
            "published": datetime.strptime(r[2], "%Y-%m-%d %H:%M:%S"),
            "url": disclosure_url(r[3]) if r[3] else None,
        }
        for r in rows
    ]


def get_disclosures(symbol: str, from_year: int) -> list[dict]:
    """
    Relevant disclosures from from_year to today, oldest first.

    from_year'dan bugüne ilgili bildirimler, eskiden yeniye.
    """
    symbol = symbol.upper()
    conn = _connect()
    try:
        stale = [y for y in range(from_year, datetime.now().year + 1) if not _year_is_fresh(conn, symbol, y)]
        if stale:
            kap = get_kap_provider()
            member_oid = kap.get_member_oid(symbol)
            if member_oid:
                for year in stale:
                    _refresh_year(conn, kap, member_oid, symbol, year)

        rows = conn.execute(
            """
            SELECT id, published, class, subject, summary FROM disclosures
            WHERE symbol = ? AND published >= ? ORDER BY published
            """,
            (symbol, f"{from_year}-01-01"),
        ).fetchall()
    finally:
        conn.close()

    return [
        {
            "id": r[0],
            "published": datetime.strptime(r[1], "%Y-%m-%d %H:%M:%S"),
            "class": r[2],
            "subject": r[3],
            "summary": r[4],
        }
        for r in rows
    ]


def _looks_english(sentence: str) -> bool:
    padded = f" {sentence.lower()} "
    hints = sum(h in padded for h in _ENGLISH_HINTS)
    return hints >= 3 or (hints >= 2 and not (_TURKISH_CHARS & set(sentence)))


def _extract_explanation(html: str) -> str:
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True).replace("\xa0", " ")
    start = text.find("oda_ExplanationTextBlock|")
    if start < 0:
        return ""
    text = text[start + len("oda_ExplanationTextBlock|") :]
    for marker in _TEXT_END_MARKERS:
        cut = text.find(marker)
        if cut >= 0:
            text = text[:cut]

    # Keep the Turkish part; stop at the first sentence of the English translation.
    # Türkçe kısmı tut; İngilizce çevirinin ilk cümlesinde dur.
    kept = []
    for sentence in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text).strip()):
        if kept and _looks_english(sentence):
            break
        kept.append(sentence)
    text = " ".join(kept)

    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS].rsplit(" ", 1)[0] + "…"
    return text


def get_text(disclosure_id: int) -> str:
    conn = _connect()
    try:
        row = conn.execute("SELECT text FROM texts WHERE id = ?", (disclosure_id,)).fetchone()
        if row is not None:
            return row[0]
        html = get_kap_provider().get_disclosure_content(disclosure_id)
        if html is None:
            return ""
        text = _extract_explanation(html)
        conn.execute("INSERT OR REPLACE INTO texts VALUES (?, ?)", (disclosure_id, text))
        conn.commit()
        return text
    finally:
        conn.close()


def disclosure_url(disclosure_id: int) -> str:
    return f"https://www.kap.org.tr/tr/Bildirim/{disclosure_id}"
