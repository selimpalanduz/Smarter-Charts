"""
Where the shares on the market were bought, approximately, and how much of
that is currently above water.

Each bar's volume is spread evenly over its high-low range. That is the
assumption the whole picture rests on and it is a rough one: within a day
price does not linger evenly across its range, and a share changing hands
twice is counted twice. What comes out is not a register of holdings, it is
the shape of where trading happened.

Nothing here claims a heavy shelf will turn price back. The volume is
reported where it traded; whether that matters tomorrow is a separate
question the chart does not answer.

Piyasadaki payların yaklaşık olarak nereden alındığı ve bugün ne kadarının
kârda olduğu.

Her barın hacmi, o barın en yüksek-en düşük aralığına eşit dağıtılıyor.
Bütün resmin dayandığı varsayım bu ve kaba bir varsayım: gün içinde fiyat
aralığın her yerinde eşit süre durmuyor, iki kez el değiştiren pay iki kez
sayılıyor. Çıkan şey bir pay sahipliği kaydı değil, işlemin nerede olduğunun
biçimi.

Burada ağır bir yığının fiyatı geri çevireceğine dair bir iddia yok. Hacim
nerede işlem gördüyse orada bildiriliyor; bunun yarın bir anlamı olup
olmadığı grafiğin cevaplamadığı ayrı bir soru.
"""

from datetime import datetime, timedelta

import numpy as np

import price_cache

LOOKBACK_DAYS = 730
# Enough rows to show structure, few enough to stay a readable histogram.
# Yapıyı gösterecek kadar çok, okunur bir histogram kalacak kadar az satır.
BINS = 80
# A bar this far off the others would stretch every bin flat; the range is
# cut to this span of the traded prices instead.
# Diğerlerinden bu kadar uzaktaki tek bir bar bütün kutuları yassıltır;
# aralık onun yerine işlem gören fiyatların bu dilimine kırpılıyor.
CLIP_LOW, CLIP_HIGH = 0.5, 99.5


def _distribute(low: np.ndarray, high: np.ndarray, volume: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """
    Each bar's volume spread evenly over the bins its range covers, by how
    much of the bar's range falls in each bin. A bar narrower than one bin
    lands entirely in that bin.

    Her barın hacmi, aralığının kapsadığı kutulara, aralığın ne kadarının o
    kutuya düştüğü oranında dağıtılıyor. Bir kutudan dar bir bar tamamen o
    kutuya düşüyor.
    """
    # Overlap of [low, high] with every bin, as a matrix: bars x bins.
    # [low, high] ile her kutunun örtüşmesi, matris olarak: bar x kutu.
    lower = np.maximum(low[:, None], edges[None, :-1])
    upper = np.minimum(high[:, None], edges[None, 1:])
    overlap = np.clip(upper - lower, 0.0, None)

    span = overlap.sum(axis=1)
    # A bar with no range at all (or one entirely outside the clipped range)
    # cannot be spread; it is dropped rather than divided by zero.
    # Hiç aralığı olmayan (ya da kırpılmış aralığın tamamen dışında kalan)
    # bar dağıtılamaz; sıfıra bölmek yerine düşürülüyor.
    usable = span > 0
    weights = np.zeros_like(overlap)
    weights[usable] = overlap[usable] / span[usable, None]
    return (weights * volume[:, None]).sum(axis=0)


def cost_profile(symbol: str) -> dict:
    """
    The traded volume of the last LOOKBACK_DAYS laid out by price, plus where
    the last close sits in it.

    `inProfitPct` is the share of that volume that traded below the last
    close — bought cheaper than today, so in profit on the rough reading
    above. It is a statement about past trading, not about who still holds.

    Son LOOKBACK_DAYS günün işlem hacminin fiyata göre dizilişi ve son
    kapanışın bu dizilişteki yeri.

    `inProfitPct`, bu hacmin son kapanışın altında işlem gören kısmı —
    bugünden ucuza alınmış, yani yukarıdaki kaba okumayla kârda. Geçmiş
    işlem hakkında bir ifade; bugün hâlâ kimin elinde tuttuğu hakkında değil.
    """
    symbol = symbol.upper()
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    df = price_cache.query_range(symbol, start, end)
    if df.empty:
        return {"symbol": symbol, "supported": False, "reason": "noPrices"}

    low = df["Low"].to_numpy(dtype=float)
    high = df["High"].to_numpy(dtype=float)
    volume = df["Volume"].to_numpy(dtype=float)

    valid = np.isfinite(low) & np.isfinite(high) & np.isfinite(volume) & (volume > 0) & (high >= low)
    low, high, volume = low[valid], high[valid], volume[valid]
    if not len(low):
        return {"symbol": symbol, "supported": False, "reason": "noVolume"}

    close = float(df["Close"].to_numpy(dtype=float)[-1])
    floor = float(np.percentile(low, CLIP_LOW))
    ceiling = float(np.percentile(high, CLIP_HIGH))
    # A stock at a new low sits under its own clipped range, which would put
    # the price line off the bottom of the histogram. The range is opened to
    # hold the close whatever it is; the clipped volume folds into the end
    # bins rather than being dropped.
    # Yeni dip yapan hisse kendi kırpılmış aralığının altında kalıyor, bu da
    # fiyat çizgisini histogramın altına düşürürdü. Aralık kapanışı ne olursa
    # olsun içine alacak şekilde açılıyor; kırpılan hacim düşürülmüyor, uç
    # kutulara katlanıyor.
    floor, ceiling = min(floor, close), max(ceiling, close)
    if not ceiling > floor:
        return {"symbol": symbol, "supported": False, "reason": "flat"}

    edges = np.linspace(floor, ceiling, BINS + 1)
    weight = _distribute(np.clip(low, floor, ceiling), np.clip(high, floor, ceiling), volume, edges)
    total = float(weight.sum())
    if total <= 0:
        return {"symbol": symbol, "supported": False, "reason": "noVolume"}

    # The bin holding the close is split at the close itself, so the two
    # shares meet exactly at today's price instead of at a bin edge.
    # Kapanışı içeren kutu kapanışın kendisinden bölünüyor; böylece iki pay
    # kutu kenarında değil tam bugünün fiyatında buluşuyor.
    below = float(weight[edges[1:] <= close].sum())
    straddle = int(np.searchsorted(edges, close, side="right")) - 1
    if 0 <= straddle < BINS:
        width = edges[straddle + 1] - edges[straddle]
        below += float(weight[straddle]) * float((close - edges[straddle]) / width)

    peak = int(np.argmax(weight))
    return {
        "symbol": symbol,
        "supported": True,
        "from": df.index[0].strftime("%Y-%m-%d"),
        "to": df.index[-1].strftime("%Y-%m-%d"),
        "close": close,
        "bins": [
            {"low": round(float(edges[i]), 4), "high": round(float(edges[i + 1]), 4),
             "share": round(float(weight[i] / total), 6)}
            for i in range(BINS)
        ],
        "peakPrice": round(float((edges[peak] + edges[peak + 1]) / 2), 4),
        "inProfitPct": round(below / total * 100, 1),
    }
