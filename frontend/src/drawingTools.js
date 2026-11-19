import { colors } from './theme.js';

class BasePaneView {
  constructor(source) {
    this._source = source;
  }
  update() {}
  renderer() {
    const source = this._source;
    return {
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          source._draw(context, mediaSize);
        });
      },
    };
  }
}

// Same view, but painted under the series instead of over it — for fills
// solid enough to hide a candle.
// Aynı görünüm, serinin üstüne değil altına boyanıyor — bir mumu örtecek
// kadar koyu dolgular için.
class UnderlayPaneView extends BasePaneView {
  zOrder() {
    return 'bottom';
  }
}

// All three shapes draw their endpoints with this, so the size is set once.
// Üç şekil de uçlarını bununla çiziyor, boyut bir kez ayarlanıyor.
const HANDLE_RADIUS = 6;

// A rectangle's fill is its own colour, thinned. Written out rather than
// relying on an 8-digit hex, which older canvas implementations read as
// opaque.
// Dikdörtgenin dolgusu kendi renginin inceltilmişi. 8 haneli hex'e
// güvenmek yerine açık yazıldı; eski canvas uygulamaları onu opak okuyor.
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function drawHandle(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = colors().chartBg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

// A handle is grabbed from a little further out than the circle it draws, so
// it can be caught without landing exactly on the dot.
// Tutamak, çizdiği çemberden biraz daha geniş bir alandan yakalanıyor; böylece
// tam noktanın üstüne basmadan tutulabiliyor.
const HANDLE_GRAB = HANDLE_RADIUS + 5;

// The three two-point shapes move the same way, so they share one set of
// methods rather than carrying three copies. A shape exposes its endpoints
// only while selected: an unselected line is dragged by its body, and handles
// that cannot be seen should not be grabbable either.
// Üç iki-noktalı şekil aynı şekilde taşınıyor, bu yüzden üç kopya taşımak
// yerine tek bir metot kümesini paylaşıyorlar. Şekil uçlarını yalnız seçiliyken
// açıyor: seçili olmayan çizgi gövdesinden sürükleniyor ve görünmeyen tutamak
// tutulabilir de olmamalı.
const twoPointDrag = {
  hitHandle(x, y) {
    if (!this._selected) return null;
    const c = this._coords();
    if (!c) return null;
    if (Math.hypot(x - c.x1, y - c.y1) <= HANDLE_GRAB) return 'p1';
    if (Math.hypot(x - c.x2, y - c.y2) <= HANDLE_GRAB) return 'p2';
    return null;
  },
  getPoints() {
    return { p1: { ...this._p1 }, p2: { ...this._p2 } };
  },
  setPoints(p1, p2) {
    this._p1 = p1;
    this._p2 = p2;
    this._requestUpdate?.();
  },
  movePoint(which, point) {
    if (which === 'p1') this._p1 = point;
    else this._p2 = point;
    this._requestUpdate?.();
  },
  // One setter for all three, because each shape reads a different key: the
  // line and the ladder draw with `color`, the rectangle with `borderColor`
  // and `fillColor`. Writing all of them keeps the mixin from needing an
  // override, which Object.assign would overwrite anyway. `null` clears them,
  // and the shape falls back to the theme's drawing colour.
  // Üçü için tek setter, çünkü her şekil başka bir anahtarı okuyor: çizgi ve
  // merdiven `color` ile, dikdörtgen `borderColor` ve `fillColor` ile
  // çiziyor. Hepsini yazmak, mixin'in bir override'a ihtiyaç duymasını
  // engelliyor; zaten Object.assign onu ezerdi. `null` hepsini siliyor ve
  // şekil temanın çizim rengine düşüyor.
  setColor(color) {
    this._options.color = color ?? undefined;
    this._options.borderColor = color ?? undefined;
    this._options.fillColor = color ? withAlpha(color, 0.12) : undefined;
    this._requestUpdate?.();
  },
  getColor() {
    return this._options.color ?? null;
  },
  // Where each endpoint sits on screen right now. A body drag works in pixels
  // and converts back once, so the shape keeps its shape instead of being
  // rebuilt from two independently rounded times.
  // Her ucun şu an ekranda nerede olduğu. Gövde sürüklemesi piksel üstünde
  // çalışıp sonunda bir kez geri çeviriyor; böylece şekil, ayrı ayrı
  // yuvarlanmış iki zamandan yeniden kurulmak yerine biçimini koruyor.
  handleCoords() {
    return this._coords();
  },
};

export class TrendLinePrimitive {
  constructor(p1, p2, options = {}) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = { lineWidth: 2, preview: false, ...options };
    this._selected = false;
    this._extendLeft = false;
    this._extendRight = false;
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  setSecondPoint(p2) {
    this._p2 = p2;
    this._requestUpdate?.();
  }
  setSelected(selected) {
    this._selected = selected;
    this._requestUpdate?.();
  }
  setExtendLeft(value) {
    this._extendLeft = value;
    this._requestUpdate?.();
  }
  setExtendRight(value) {
    this._extendRight = value;
    this._requestUpdate?.();
  }
  getExtend() {
    return { left: this._extendLeft, right: this._extendRight };
  }
  _coords() {
    if (!this._chart || !this._series) return null;
    const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { x1, y1, x2, y2 };
  }
  hitTest(x, y) {
    const c = this._coords();
    if (!c) return false;
    return distanceToSegment(x, y, c.x1, c.y1, c.x2, c.y2) <= 6;
  }
  _draw(ctx, mediaSize) {
    const c = this._coords();
    if (!c) return;
    const { x1, y1, x2, y2 } = c;

    let leftX = x1, leftY = y1, rightX = x2, rightY = y2;
    if (x1 > x2) {
      leftX = x2; leftY = y2; rightX = x1; rightY = y1;
    }

    if ((this._extendLeft || this._extendRight) && rightX !== leftX) {
      const slope = (rightY - leftY) / (rightX - leftX);
      if (this._extendLeft) {
        leftY = leftY + slope * (0 - leftX);
        leftX = 0;
      }
      if (this._extendRight) {
        rightY = rightY + slope * (mediaSize.width - rightX);
        rightX = mediaSize.width;
      }
    }

    ctx.save();
    ctx.strokeStyle = this._options.color ?? colors().drawing;
    ctx.lineWidth = this._selected ? this._options.lineWidth + 1.5 : this._options.lineWidth;
    if (this._options.preview) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.7;
    }
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.stroke();
    ctx.restore();

    if (this._selected) {
      drawHandle(ctx, x1, y1, this._options.color ?? colors().drawing);
      drawHandle(ctx, x2, y2, this._options.color ?? colors().drawing);
    }
  }
}

// The retracement levels, as fractions of the move between the two anchors.
// 0 sits on the first point and 1 on the second, so a high-to-low drag reads
// downwards and a low-to-high drag reads upwards without a separate case.
// Düzeltme seviyeleri, iki çıpa arasındaki hareketin kesirleri olarak. 0 ilk
// noktada, 1 ikincisinde; böylece tepeden dibe çekiş aşağı, dipten tepeye
// çekiş yukarı okunuyor, ayrı bir durum yazmaya gerek kalmıyor.
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_LABEL_PAD = 4;

export class FibonacciPrimitive {
  constructor(p1, p2, options = {}) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = { lineWidth: 1, preview: false, ...options };
    this._selected = false;
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  setSecondPoint(p2) {
    this._p2 = p2;
    this._requestUpdate?.();
  }
  setSelected(selected) {
    this._selected = selected;
    this._requestUpdate?.();
  }
  // Attaching alone does not repaint, so an instance that is placed rather
  // than drawn by hand has to ask for it.
  // Eklemek tek başına yeniden boyamıyor, elle çizilmek yerine yerleştirilen
  // bir örneğin bunu istemesi gerekiyor.
  requestRedraw() {
    this._requestUpdate?.();
  }
  _coords() {
    if (!this._chart || !this._series) return null;
    const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { x1, y1, x2, y2 };
  }
  // Anywhere inside the ladder, not just on a line: the lines are a pixel
  // wide and the thing the reader thinks they are clicking is the block.
  // Merdivenin içinde herhangi bir yer, yalnızca çizgi üstü değil: çizgiler
  // bir piksel ve okurun tıkladığını sandığı şey bloğun kendisi.
  hitTest(x, y) {
    const c = this._coords();
    if (!c) return false;
    const left = Math.min(c.x1, c.x2);
    const right = Math.max(c.x1, c.x2);
    const top = Math.min(c.y1, c.y2);
    const bottom = Math.max(c.y1, c.y2);
    return x >= left - 6 && x <= right + 6 && y >= top - 6 && y <= bottom + 6;
  }
  _draw(ctx, mediaSize) {
    const c = this._coords();
    if (!c) return;
    const left = Math.min(c.x1, c.x2);
    const right = Math.max(c.x1, c.x2);

    ctx.save();
    const color = this._options.color ?? colors().drawing;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = this._options.lineWidth;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    if (this._options.preview) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.7;
    }

    // The two anchors keep the full line; the levels between them are drawn
    // lighter, so the move being measured stays the stronger shape.
    // İki çıpa tam çizgiyi koruyor; aralarındaki seviyeler daha soluk
    // çiziliyor ki ölçülen hareket baskın şekil olarak kalsın.
    FIB_LEVELS.forEach((level) => {
      const y = c.y1 + (c.y2 - c.y1) * level;
      const anchor = level === 0 || level === 1;
      ctx.globalAlpha = this._options.preview ? 0.7 : anchor ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      const price = this._p1.price + (this._p2.price - this._p1.price) * level;
      const text = `${level.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}  ${price.toFixed(2)}`;
      ctx.fillText(text, left + FIB_LABEL_PAD, y - 2);
    });
    ctx.restore();

    if (this._selected) {
      drawHandle(ctx, c.x1, c.y1, this._options.color ?? colors().drawing);
      drawHandle(ctx, c.x2, c.y2, this._options.color ?? colors().drawing);
    }
  }
}

export class RectanglePrimitive {
  constructor(p1, p2, options = {}) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = {
      preview: false,
      ...options,
    };
    this._selected = false;
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  setSecondPoint(p2) {
    this._p2 = p2;
    this._requestUpdate?.();
  }
  setSelected(selected) {
    this._selected = selected;
    this._requestUpdate?.();
  }
  _coords() {
    if (!this._chart || !this._series) return null;
    const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return {
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
      top: Math.min(y1, y2),
      bottom: Math.max(y1, y2),
      x1, y1, x2, y2,
    };
  }
  hitTest(x, y) {
    const c = this._coords();
    if (!c) return false;
    return x >= c.left && x <= c.right && y >= c.top && y <= c.bottom;
  }
  _draw(ctx) {
    const c = this._coords();
    if (!c) return;

    ctx.save();
    if (this._options.preview) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.7;
    }
    ctx.fillStyle = this._options.fillColor ?? colors().drawingFill;
    ctx.fillRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    ctx.strokeStyle = this._options.borderColor ?? colors().drawing;
    ctx.lineWidth = this._selected ? 2.5 : 1;
    ctx.strokeRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    ctx.restore();

    if (this._selected) {
      drawHandle(ctx, c.x1, c.y1, this._options.borderColor ?? colors().drawing);
      drawHandle(ctx, c.x2, c.y2, this._options.borderColor ?? colors().drawing);
    }
  }
}

// Auto-detected support/resistance zone — a filled horizontal band spanning
// the full chart width, drawn from data (not user-placed like the tools
// above), so it has no hitTest/selection behavior.
export class SRZonePrimitive {
  constructor(zone, options = {}) {
    this._zone = zone;
    this._options = { fillColor: 'rgba(150,150,150,0.1)', lineColor: '#888888', label: '', ...options };
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  // attachPrimitive/detachPrimitive don't repaint the chart by themselves.
  // Detaching asks for the repaint here; attaching leaves it to the caller,
  // which attaches a whole set at once.
  detached() {
    this._requestUpdate?.();
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  requestRedraw() {
    this._requestUpdate?.();
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  _draw(ctx, mediaSize) {
    if (!this._series) return;
    const yTop = this._series.priceToCoordinate(this._zone.max);
    const yBottom = this._series.priceToCoordinate(this._zone.min);
    if (yTop === null || yBottom === null) return;
    const yMean = this._series.priceToCoordinate(this._zone.mean);

    ctx.save();
    ctx.fillStyle = this._options.fillColor ?? colors().drawingFill;
    ctx.fillRect(0, yTop, mediaSize.width, Math.max(1, yBottom - yTop));

    if (yMean !== null) {
      ctx.strokeStyle = this._options.lineColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yMean);
      ctx.lineTo(mediaSize.width, yMean);
      ctx.stroke();
    }

    if (this._options.label) {
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([]);
      ctx.fillStyle = this._options.lineColor;
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._options.label, 4, yTop - 2);
    }
    ctx.restore();
  }
}

export class HorizontalLinePrimitive {
  constructor(price, options = {}) {
    this._price = price;
    this._options = { lineWidth: 1, ...options };
    this._selected = false;
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  setSelected(selected) {
    this._selected = selected;
    this._requestUpdate?.();
  }
  hitTest(x, y) {
    if (!this._series) return false;
    const lineY = this._series.priceToCoordinate(this._price);
    if (lineY === null) return false;
    return Math.abs(y - lineY) <= 6;
  }
  // It spans the whole width, so there is no end to grab and nothing to drag
  // sideways; the body carries it, in price only.
  // Tüm genişliği kapladığı için tutulacak bir uç ve yana sürüklenecek bir şey
  // yok; gövdesi taşıyor, yalnız fiyatta.
  hitHandle() {
    return null;
  }
  setColor(color) {
    this._options.color = color ?? undefined;
    this._requestUpdate?.();
  }
  getColor() {
    return this._options.color ?? null;
  }
  getPrice() {
    return this._price;
  }
  setPrice(price) {
    this._price = price;
    this._requestUpdate?.();
  }
  handleCoords() {
    if (!this._series) return null;
    const y = this._series.priceToCoordinate(this._price);
    return y === null ? null : { x1: 0, y1: y, x2: 0, y2: y };
  }
  _draw(ctx, mediaSize) {
    if (!this._chart || !this._series) return;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return;

    ctx.save();
    ctx.strokeStyle = this._options.color ?? colors().drawing;
    ctx.lineWidth = this._selected ? this._options.lineWidth + 1.5 : this._options.lineWidth;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mediaSize.width, y);
    ctx.stroke();
    ctx.restore();
  }
}
// Daily % change of the last bar, shown on the price axis below the last price label.
// Son barın günlük % değişimi, fiyat ekseninde son fiyat etiketinin altında.
const DAILY_CHANGE_LABEL_OFFSET = 20;

export class DailyChangePrimitive {
  constructor() {
    this._series = null;
    this._value = null;
    this._axisViews = [new DailyChangeAxisView(this)];
  }
  attached({ series }) {
    this._series = series;
  }
  detached() {
    this._series = null;
  }
  setValue(value) {
    this._value = value;
  }
  updateAllViews() {}
  priceAxisViews() {
    return this._axisViews;
  }
}

class DailyChangeAxisView {
  constructor(source) {
    this._source = source;
  }
  _y() {
    const { _series: series, _value: value } = this._source;
    if (!series || !value) return null;
    return series.priceToCoordinate(value.price);
  }
  coordinate() {
    const y = this._y();
    return y == null ? -1000 : y + DAILY_CHANGE_LABEL_OFFSET;
  }
  text() {
    const pct = this._source._value?.pct;
    if (pct == null) return '';
    return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }
  textColor() {
    return colors().chartBg;
  }
  backColor() {
    const pct = this._source._value?.pct;
    return pct >= 0 ? colors().up : colors().down;
  }
  visible() {
    return this._y() != null;
  }
  tickVisible() {
    return false;
  }
}


// The traded volume of the last two years laid out by price: a horizontal
// histogram pinned to the left edge, bars below the last close in the up
// colour and above it in the down colour.
//
// Drawn, not drawable — no handles, not in drawingsRef, replaced wholesale
// when the symbol changes, the same as the automatic Fibonacci.
//
// It marks nothing as support or resistance and carries no such colouring
// of its own: the two tints say "cheaper than today" and "dearer than
// today", which is what the figures underneath actually mean.
//
// Son iki yılın işlem hacminin fiyata göre dizilişi: sol kenara sabitlenmiş
// yatay histogram; son kapanışın altındaki çubuklar yükseliş renginde,
// üstündekiler düşüş renginde.
//
// Çizilen bir şey, çizilebilir değil — tutamağı yok, drawingsRef'te durmuyor,
// sembol değişince toptan yenileniyor; otomatik Fibonacci gibi.
//
// Hiçbir yeri destek ya da direnç diye işaretlemiyor ve kendinden öyle bir
// renklendirme taşımıyor: iki ton "bugünden ucuz" ve "bugünden pahalı"
// diyor, altındaki rakamların gerçekten anlattığı şey bu.
export class CostProfilePrimitive {
  constructor(profile, options = {}) {
    this._profile = profile;
    this._options = { widthFraction: 0.22, label: '', ...options };
    this._paneViews = [new UnderlayPaneView(this)];
    this._series = null;
    this._requestUpdate = null;
  }
  attached({ series, requestUpdate }) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._requestUpdate?.();
    this._series = null;
    this._requestUpdate = null;
  }
  requestRedraw() {
    this._requestUpdate?.();
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  _draw(ctx, mediaSize) {
    if (!this._series) return;
    const bins = this._profile?.bins ?? [];
    if (!bins.length) return;

    const heaviest = Math.max(...bins.map((b) => b.share));
    if (!(heaviest > 0)) return;
    const maxWidth = mediaSize.width * this._options.widthFraction;
    const close = this._profile.close;

    ctx.save();
    bins.forEach((bin) => {
      const yTop = this._series.priceToCoordinate(bin.high);
      const yBottom = this._series.priceToCoordinate(bin.low);
      if (yTop === null || yBottom === null) return;

      // One pixel of gap keeps the rows legible; below that the bars merge
      // into a block and the shape is lost.
      // Bir piksellik boşluk satırları okunur tutuyor; altında çubuklar tek
      // bir bloğa dönüşüp biçim kayboluyor.
      const height = Math.max(1, yBottom - yTop - 1);
      const width = (bin.share / heaviest) * maxWidth;
      ctx.fillStyle = bin.high <= close ? colors().upSoft : colors().downSoft;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, yTop, width, height);
    });

    if (this._options.label) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors().chartText;
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(this._options.label, 4, 4);
    }
    ctx.restore();
  }
}

Object.assign(TrendLinePrimitive.prototype, twoPointDrag);
Object.assign(FibonacciPrimitive.prototype, twoPointDrag);
Object.assign(RectanglePrimitive.prototype, twoPointDrag);
