"""
Valuation ratios: the statements measured against the price.

A ratio is unit-free, so the basis toggle does not belong here — P/E in lira
and P/E in dollars are the same number.

The headline figure follows the market's convention rather than this
project's, because a multiple is only useful next to the one everyone else
quotes. That means two deliberate choices:

- The statements are taken AS REPORTED, with no TÜFE restatement. Restating
  the trailing four quarters is the more defensible arithmetic under this
  inflation, and it moves P/E by roughly a fifth, but it produces a number
  that matches nothing else on the market. It is kept beside the headline as
  `restated`, not instead of it.
- Net debt keeps lease liabilities in, because EBITDA does too. Under IFRS 16
  a leased aircraft lands on both sides: a liability in the numerator, and
  depreciation in the denominator that we add back. Either both or neither —
  taking the lease out of net debt while leaving its depreciation inside
  EBITDA counts the benefit without the cost and makes the multiple look
  cheaper than either consistent answer. İş Yatırım's published EV/EBITDA
  does exactly that, so ours does not match it; theirs is under `provider`
  and their narrower net debt under `inputs.netDebtNarrow`.

Taking the lease out of both would be equally sound, and is what Fintables
reports, but 4B does not break out the right-of-use share of depreciation,
so it cannot be done from this source.

Değerleme rasyoları: tabloların fiyata vurulmuş hâli.

Oran birimsizdir, dolayısıyla taban düğmesi buraya ait değil — liradaki F/K
ile dolardaki F/K aynı sayıdır.

Öne çıkan rakam bu projenin değil piyasanın konvansiyonunu izliyor, çünkü bir
çarpan ancak herkesin kullandığının yanında anlamlı. Bu iki bilinçli tercih
demek:

- Tablolar RAPORLANDIĞI GİBİ alınıyor, TÜFE düzeltmesi yok. Son dört çeyreği
  düzeltmek bu enflasyonda aritmetik olarak daha savunulabilir ve F/K'yı
  yaklaşık beşte bir oynatıyor, ama piyasada hiçbir şeyle tutmayan bir sayı
  üretiyor. Yerine değil, yanında `restated` olarak duruyor.
- Net borç kiralama yükümlülüklerini içeride tutuyor, çünkü FAVÖK de tutuyor.
  IFRS 16'dan sonra kiralanan uçak iki tarafa birden düşüyor: payda bir
  yükümlülük, paydada geri eklediğimiz bir amortisman. Ya ikisi ya hiçbiri —
  kirayı net borçtan çıkarıp amortismanını FAVÖK'te bırakmak faydayı sayıp
  maliyeti saymamak olur ve çarpanı tutarlı iki cevabın da altına indirir.
  İş Yatırım'ın yayınladığı FD/FAVÖK tam bunu yapıyor, o yüzden bizimki
  onunla tutmuyor; onlarınki `provider`, dar net borçları
  `inputs.netDebtNarrow` altında.

Kirayı iki taraftan birden çıkarmak da aynı ölçüde doğru olurdu, Fintables
öyle yapıyor; ama 4B amortismanın kullanım hakkı payını ayrı vermiyor, bu
kaynaktan hesaplanamıyor.
"""

import threading
import time

import borsapy as bp

from .schema import CURRENCY_TRY, NET_INCOME
from .statements import QUARTERS, quarterly
from .summary import DEBT_CODES

CASH = "1AA"
EQUITY_PARENT = "2O"
EQUITY_TOTAL = "2N"
OPERATING_PROFIT = "3DF"
DEPRECIATION = "4B"

TTM = 4
# Seconds. The price moves all day; the statements behind it do not.
# Saniye. Fiyat gün boyu hareket ediyor, arkasındaki tablolar etmiyor.
QUOTE_TTL = 60

_quote_cache: dict[str, tuple[float, dict | None]] = {}
_quote_guard = threading.Lock()

RATIOS = [
    {
        "key": "pe",
        "label": {"tr": "F/K", "en": "P/E"},
        "note": {
            "tr": "Piyasa değeri / son 4 çeyreğin ana ortaklık net kârı.",
            "en": "Market cap over the last four quarters of parent net profit.",
        },
    },
    {
        "key": "pb",
        "label": {"tr": "PD/DD", "en": "P/B"},
        "note": {
            "tr": "Piyasa değeri / ana ortaklığa ait özkaynak.",
            "en": "Market cap over equity attributable to the parent.",
        },
    },
    {
        "key": "evEbitda",
        "label": {"tr": "FD/FAVÖK", "en": "EV/EBITDA"},
        "note": {
            "tr": "(Piyasa değeri + net borç) / son 4 çeyreğin FAVÖK'ü.",
            "en": "Market cap plus net debt, over the last four quarters of EBITDA.",
        },
    },
]


def quote(symbol: str) -> dict | None:
    """
    {"price", "shares", "marketCap", "provider"}, or None when either the
    market cap or the last price is missing — the share count is their
    quotient, so one without the other is no use.

    Piyasa değeri ya da son fiyat eksikse None; hisse sayısı ikisinin bölümü
    olduğu için biri olmadan diğeri işe yaramıyor.
    """
    symbol = symbol.upper()
    now = time.time()
    with _quote_guard:
        cached = _quote_cache.get(symbol)
        if cached and (now - cached[0]) < QUOTE_TTL:
            return cached[1]

    ticker = bp.Ticker(symbol)
    metrics = ticker._get_isyatirim().get_company_metrics(symbol)
    price = ticker.info.get("last")
    market_cap = metrics.get("market_cap")

    result = None
    if market_cap and price:
        result = {
            "price": float(price),
            "shares": float(market_cap) / float(price),
            "marketCap": float(market_cap),
            "provider": {
                "pe": metrics.get("pe_ratio"),
                "pb": metrics.get("pb_ratio"),
                "evEbitda": metrics.get("ev_ebitda"),
                "netDebt": metrics.get("net_debt"),
            },
        }

    with _quote_guard:
        _quote_cache[symbol] = (now, result)
    return result


def _periods(items: dict, code: str) -> dict[str, float | None]:
    return (items.get(code) or {}).get("periods") or {}


def _latest(items: dict, code: str) -> tuple[str, float] | None:
    """The newest period of a snapshot line that actually has a value."""
    series = _periods(items, code)
    for period in sorted(series, reverse=True):
        if series[period] is not None:
            return period, series[period]
    return None


def _span(first: str, last: str) -> int:
    """Quarters between two period labels."""
    first_year, first_quarter = (int(part) for part in first.split("Q"))
    last_year, last_quarter = (int(part) for part in last.split("Q"))
    return (last_year - first_year) * 4 + (last_quarter - first_quarter)


def _ttm(series: dict[str, float | None], through: str) -> tuple[list[str], float] | None:
    """
    The four quarters ending at `through`, summed. Nothing unless all four are
    there and consecutive: a three-quarter sum is not a year.

    `through` ile biten dört çeyreğin toplamı. Dördü de varsa ve ardışıksa;
    değilse None — üç çeyreğin toplamı bir yıl değildir.
    """
    periods = sorted(series)
    if through not in periods:
        return None
    end = periods.index(through)
    if end < TTM - 1:
        return None
    window = periods[end - TTM + 1 : end + 1]
    values = [series[period] for period in window]
    if any(value is None for value in values):
        return None
    # A gap in the store would let four stored quarters span more than a year.
    # Depodaki bir boşluk, dört kayıtlı çeyreğin bir yıldan uzun sürmesine yol açar.
    if _span(window[0], window[-1]) != TTM - 1:
        return None
    return window, sum(values)


def _ebitda(items: dict) -> dict[str, float | None]:
    """Operating profit with depreciation added back, as the statements do it."""
    operating = _periods(items, OPERATING_PROFIT)
    depreciation = _periods(items, DEPRECIATION)
    out: dict[str, float | None] = {}
    for period in set(operating) | set(depreciation):
        base, added = operating.get(period), depreciation.get(period)
        out[period] = None if base is None or added is None else base + added
    return out


def _net_debt(items: dict, period: str) -> float | None:
    gross = [_periods(items, code).get(period) for code in DEBT_CODES]
    present = [value for value in gross if value is not None]
    if not present:
        return None
    cash = _periods(items, CASH).get(period) or 0.0
    return sum(present) - cash


def _divide(top: float | None, bottom: float | None) -> tuple[float | None, str | None]:
    """(value, why it is missing). A ratio over a negative base says nothing."""
    if top is None or bottom is None:
        return None, "missing"
    if bottom <= 0:
        return None, "negative"
    return top / bottom, None


def _figures(items: dict, period: str) -> dict:
    """The four inputs the ratios are built from, for one basis."""
    profit = _ttm(_periods(items, NET_INCOME), period)
    ebitda = _ttm(_ebitda(items), period)
    return {
        "ttmPeriods": profit[0] if profit else (ebitda[0] if ebitda else []),
        "ttmNetProfit": profit[1] if profit else None,
        "ttmEbitda": ebitda[1] if ebitda else None,
        "equity": (_periods(items, EQUITY_PARENT).get(period)
                   or _periods(items, EQUITY_TOTAL).get(period)),
        "netDebt": _net_debt(items, period),
    }


def _three(market_cap: float, net_debt: float | None, figures: dict) -> dict:
    enterprise = None if net_debt is None else market_cap + net_debt
    return {
        "pe": _divide(market_cap, figures["ttmNetProfit"]),
        "pb": _divide(market_cap, figures["equity"]),
        "evEbitda": _divide(enterprise, figures["ttmEbitda"]),
    }


def ratios(symbol: str, refresh: bool = False) -> dict:
    """
    The three valuation ratios for one symbol, with the figures behind them.

    Bir sembol için üç değerleme rasyosu ve arkasındaki rakamlar.
    """
    symbol = symbol.upper()
    statements = quarterly(
        symbol, quarters=QUARTERS, real=False, currency=CURRENCY_TRY, refresh=refresh
    )
    if not statements.get("supported"):
        return {
            "symbol": symbol,
            "supported": False,
            "priced": False,
            "sector": statements.get("sector"),
            "ratios": [],
        }

    items = statements["items"]
    market = quote(symbol)
    if market is None:
        return {
            "symbol": symbol,
            "supported": True,
            "priced": False,
            "sector": statements.get("sector"),
            "ratios": [],
        }

    # The balance sheet dates the whole calculation: the income statement is
    # trailed back from the same quarter so both sides describe one moment.
    # Hesabın tarihini bilanço veriyor: gelir tablosu da aynı çeyrekten geriye
    # alınıyor ki iki taraf aynı anı anlatsın.
    anchor = _latest(items, EQUITY_PARENT) or _latest(items, EQUITY_TOTAL)
    if anchor is None:
        return {
            "symbol": symbol,
            "supported": True,
            "priced": False,
            "sector": statements.get("sector"),
            "ratios": [],
        }
    period = anchor[0]

    reported = _figures(items, period)
    market_cap = market["marketCap"]
    net_debt = reported["netDebt"]
    headline = _three(market_cap, net_debt, reported)

    # The same three on the restated basis, kept beside the headline rather
    # than in place of it; see the module docstring.
    # Aynı üçü düzeltilmiş tabanda; öne çıkanın yerine değil yanında duruyor,
    # bkz. modül açıklaması.
    adjusted = quarterly(symbol, quarters=QUARTERS, real=True, currency=CURRENCY_TRY)
    restated_figures = _figures(adjusted["items"], period)
    restated = _three(market_cap, restated_figures["netDebt"], restated_figures)

    return {
        "symbol": symbol,
        "supported": True,
        "priced": True,
        "sector": statements.get("sector"),
        "target": adjusted.get("target"),
        "period": period,
        "ttmPeriods": reported["ttmPeriods"],
        "price": market["price"],
        "shares": market["shares"],
        "marketCap": market_cap,
        "enterpriseValue": None if net_debt is None else market_cap + net_debt,
        "inputs": {
            **{key: reported[key] for key in ("ttmNetProfit", "ttmEbitda", "equity")},
            "netDebt": net_debt,
            "netDebtNarrow": market["provider"].get("netDebt"),
        },
        "provider": market["provider"],
        "ratios": [
            {
                "key": spec["key"],
                "label": spec["label"],
                "note": spec["note"],
                "value": headline[spec["key"]][0],
                "missing": headline[spec["key"]][1],
                "restated": restated[spec["key"]][0],
            }
            for spec in RATIOS
        ],
    }
