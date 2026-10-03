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

function drawHandle(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
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
