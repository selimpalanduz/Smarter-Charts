// Minimal drawing-tool primitives built directly on lightweight-charts v5's
// official Primitives API — no third-party package.
//
// IMPORTANT: each primitive recomputes its pixel position from time/price on
// EVERY draw() call, using the live chart/series references it receives via
// attached(). This is deliberate: a known bug in lightweight-charts + React
// causes primitives to "float" out of sync with the chart if they cache a
// stale chart/series reference instead of reading the live one each time.
// (see https://github.com/tradingview/lightweight-charts/issues/1920)

class BasePaneView {
  constructor(source) {
    this._source = source;
  }
  update() {} // nothing to precompute — draw() reads live coordinates each time
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

export class TrendLinePrimitive {
  constructor(p1, p2, options = {}) {
    this._p1 = p1; // { time, price }
    this._p2 = p2;
    this._options = { color: '#2962ff', lineWidth: 2, preview: false, ...options };
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
  // Used while the user is still placing the second point (live preview) —
  // mutates the existing primitive instead of detach+reattach, which is
  // both cheaper and avoids a known lag issue when primitives are
  // repeatedly detached (github.com/tradingview/lightweight-charts/issues/2000).
  setSecondPoint(p2) {
    this._p2 = p2;
    this._requestUpdate?.();
  }
  _draw(ctx) {
    if (!this._chart || !this._series) return;
    const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    ctx.save();
    ctx.strokeStyle = this._options.color;
    ctx.lineWidth = this._options.lineWidth;
    if (this._options.preview) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.7;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
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
  _draw(ctx) {
    if (!this._chart || !this._series) return;
    const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    ctx.save();
    if (this._options.preview) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.7;
    }
    ctx.fillStyle = this._options.fillColor;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = this._options.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }
}

export class HorizontalLinePrimitive {
  constructor(price, options = {}) {
    this._price = price;
    this._options = { color: '#eda100', lineWidth: 1, ...options };
    this._paneViews = [new BasePaneView(this)];
    this._chart = null;
    this._series = null;
  }
  attached({ chart, series }) {
    this._chart = chart;
    this._series = series;
  }
  detached() {
    this._chart = null;
    this._series = null;
  }
  updateAllViews() {
    this._paneViews.forEach((v) => v.update());
  }
  paneViews() {
    return this._paneViews;
  }
  _draw(ctx, mediaSize) {
    if (!this._chart || !this._series) return;
    const y = this._series.priceToCoordinate(this._price);
    if (y === null) return;

    ctx.save();
    ctx.strokeStyle = this._options.color;
    ctx.lineWidth = this._options.lineWidth;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mediaSize.width, y);
    ctx.stroke();
    ctx.restore();
  }
}