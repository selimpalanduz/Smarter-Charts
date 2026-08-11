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
  ctx.fillStyle = '#ffffff';
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
    this._options = { color: '#2962ff', lineWidth: 2, preview: false, ...options };
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
    ctx.strokeStyle = this._options.color;
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
      drawHandle(ctx, x1, y1, this._options.color);
      drawHandle(ctx, x2, y2, this._options.color);
    }
  }
}

export class RectanglePrimitive {
  constructor(p1, p2, options = {}) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = {
      fillColor: 'rgba(41, 98, 255, 0.15)',
      borderColor: '#2962ff',
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
    ctx.fillStyle = this._options.fillColor;
    ctx.fillRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    ctx.strokeStyle = this._options.borderColor;
    ctx.lineWidth = this._selected ? 2.5 : 1;
    ctx.strokeRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    ctx.restore();

    if (this._selected) {
      drawHandle(ctx, c.x1, c.y1, this._options.borderColor);
      drawHandle(ctx, c.x2, c.y2, this._options.borderColor);
    }
  }
}

export class HorizontalLinePrimitive {
  constructor(price, options = {}) {
    this._price = price;
    this._options = { color: '#eda100', lineWidth: 1, ...options };
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
    ctx.strokeStyle = this._options.color;
    ctx.lineWidth = this._selected ? this._options.lineWidth + 1.5 : this._options.lineWidth;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mediaSize.width, y);
    ctx.stroke();
    ctx.restore();
  }
}