import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  createSeriesMarkers,
} from 'lightweight-charts';
import {
  TrendLinePrimitive,
  RectanglePrimitive,
  HorizontalLinePrimitive,
  SRZonePrimitive,
  DailyChangePrimitive,
} from './drawingTools.js';
import SymbolPicker from './SymbolPicker.jsx';
import FundamentalsView from './FundamentalsView.jsx';
import VolumeScanWidget from './VolumeScanWidget.jsx';
import PatternSearchWidget from './PatternSearchWidget.jsx';
import MoveReasonsWidget from './MoveReasonsWidget.jsx';
import AnchorsWidget from './AnchorsWidget.jsx';
import AnchorScanWidget from './AnchorScanWidget.jsx';
import { API_BASE } from './config.js';
import { STRINGS, LangContext, useT } from './i18n.js';
import { THEME, setPalette, colors } from './theme.js';
import {
  LogoMark,
  CursorIcon,
  TrendLineIcon,
  HorizontalLineIcon,
  RectangleIcon,
  PatternIcon,
  ExtendLeftIcon,
  ExtendRightIcon,
  DeleteIcon,
  ClearAllIcon,
  PanelIcon,
  SunIcon,
  MoonIcon,
} from './icons.jsx';

const CHUNK_MONTHS = 6;
// How long to wait before re-asking for candles the backend is still fetching.
// Backend'in hâlâ çektiği mumları tekrar sormadan önce beklenen süre.
const STALE_RETRY_MS = 4000;
// Older bars may still be downloading on the backend; how long to wait before
// asking again, and how many times, before accepting that history has ended.
// Eski barlar backend'de hâlâ iniyor olabilir; tekrar sormadan önce beklenen
// süre ve geçmişin bittiğini kabul etmeden önceki deneme sayısı.
const HISTORY_RETRY_MS = 3000;
const HISTORY_RETRY_LIMIT = 10;
// Must match MA_PERIODS in backend/data_provider.py.
// backend/data_provider.py içindeki MA_PERIODS ile aynı olmalı.
const MA_PERIODS = [5, 9, 12, 20, 21, 50, 100, 200];
const MA_TYPES = ['SMA', 'EMA'];
const MA_COLORS = ['#eda100', '#4a90d9', '#e5484d', '#3ddc84', '#a259d9'];
const MAX_MAS = MA_COLORS.length;
const DEFAULT_MAS = [
  { type: 'SMA', period: 20 },
  { type: 'SMA', period: 50 },
  { type: 'SMA', period: 200 },
];
const MA_STORAGE_KEY = 'stc.movingAverages';
const CROSS_FAST = 'SMA_50';
const CROSS_SLOW = 'SMA_200';
const PIVOT_LOOKBACK = 5;
const DIVERGENCE_MIN_BARS = 5;
const DIVERGENCE_MAX_BARS = 60;
const EDGE_THRESHOLD = 10;
const MAIN_PANE_STRETCH = 3;

function dateOf(row) {
  return row.Date.slice(0, 10);
}

function toCandleFormat(row) {
  return {
    time: dateOf(row),
    open: row.Open,
    high: row.High,
    low: row.Low,
    close: row.Close,
  };
}

function lineData(rows, field) {
  return rows
    .filter((row) => row[field] !== null && row[field] !== undefined)
    .map((row) => ({ time: dateOf(row), value: row[field] }));
}

function volumeData(rows) {
  return rows.map((row) => ({
    time: dateOf(row),
    value: row.Volume,
    color: row.Close >= row.Open ? colors().upSoft : colors().downSoft,
  }));
}

function macdHistData(rows) {
  return rows
    .filter((row) => row.MACD_Hist !== null && row.MACD_Hist !== undefined)
    .map((row) => ({
      time: dateOf(row),
      value: row.MACD_Hist,
      color: row.MACD_Hist >= 0 ? colors().upSoft : colors().downSoft,
    }));
}

function supertrendUpData(rows) {
  return rows.map((row) =>
    row.Supertrend_Direction === 1 ? { time: dateOf(row), value: row.Supertrend } : { time: dateOf(row) }
  );
}

function supertrendDownData(rows) {
  return rows.map((row) =>
    row.Supertrend_Direction === -1 ? { time: dateOf(row), value: row.Supertrend } : { time: dateOf(row) }
  );
}

const DIVERGENCE_LINE = {
  lineWidth: 2,
  lastValueVisible: false,
  priceLineVisible: false,
  crosshairMarkerVisible: false,
};

function maColumn(ma) {
  return `${ma.type}_${ma.period}`;
}

function maSeriesKey(ma) {
  return `ma:${maColumn(ma)}`;
}

function loadMaConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(MA_STORAGE_KEY));
    const valid = Array.isArray(saved)
      ? saved.filter((ma) => MA_TYPES.includes(ma?.type) && MA_PERIODS.includes(ma?.period)).slice(0, MAX_MAS)
      : [];
    const unique = valid.filter((ma, i) => valid.findIndex((other) => maColumn(other) === maColumn(ma)) === i);
    return unique.length > 0 ? unique : DEFAULT_MAS;
  } catch {
    return DEFAULT_MAS;
  }
}

function saveMaConfig(config) {
  try {
    localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // storage unavailable
  }
}

// Adds, updates and removes the moving average series on pane 0 to match config.
// Pane 0'daki hareketli ortalama serilerini config'e göre ekler, günceller, kaldırır.
function syncMaSeries(chart, seriesMap, config, visible, rows) {
  const wanted = new Set(config.map(maSeriesKey));
  Object.keys(seriesMap)
    .filter((key) => key.startsWith('ma:') && !wanted.has(key))
    .forEach((key) => {
      chart.removeSeries(seriesMap[key]);
      delete seriesMap[key];
    });
  config.forEach((ma, i) => {
    const key = maSeriesKey(ma);
    const options = {
      color: MA_COLORS[i],
      lineWidth: ma.period >= 100 ? 2 : 1.5,
      title: `${ma.type}${ma.period}`,
      priceLineVisible: false,
      visible,
    };
    if (seriesMap[key]) {
      seriesMap[key].applyOptions(options);
    } else {
      seriesMap[key] = chart.addSeries(LineSeries, options, 0);
      seriesMap[key].setData(lineData(rows, maColumn(ma)));
    }
  });
}

// Bars where the fast SMA crosses the slow one: golden cross up, death cross down.
// Hızlı SMA'nın yavaşı kestiği barlar: yukarı altın kesişim, aşağı ölüm kesişimi.
function maCrosses(rows) {
  const crosses = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if ([prev[CROSS_FAST], prev[CROSS_SLOW], cur[CROSS_FAST], cur[CROSS_SLOW]].some((v) => v == null)) continue;
    const before = prev[CROSS_FAST] - prev[CROSS_SLOW];
    const after = cur[CROSS_FAST] - cur[CROSS_SLOW];
    if (before <= 0 && after > 0) crosses.push({ time: dateOf(cur), golden: true });
    else if (before >= 0 && after < 0) crosses.push({ time: dateOf(cur), golden: false });
  }
  return crosses;
}

function isPivot(values, i, low) {
  const v = values[i];
  if (v == null) return false;
  for (let k = i - PIVOT_LOOKBACK; k <= i + PIVOT_LOOKBACK; k++) {
    if (k === i) continue;
    const other = values[k];
    if (other == null) return false;
    // A tie on the left disqualifies, so a flat bottom yields a single pivot.
    // Soldaki eşitlik pivotu geçersiz kılar, böylece düz bir dip tek pivot verir.
    const beaten = low ? (k < i ? other <= v : other < v) : k < i ? other >= v : other > v;
    if (beaten) return false;
  }
  return true;
}

// Each [a, b] pivot pair becomes one segment; a whitespace point separates unconnected pairs.
// Her [a, b] pivot çifti bir çizgi parçası olur; bağlı olmayan çiftleri boş bir nokta ayırır.
function divergenceLine(rows, rsi, pairs) {
  const points = [];
  let last = -1;
  pairs.forEach(([a, b]) => {
    if (a !== last) {
      if (last >= 0 && last + 1 < a) points.push({ time: dateOf(rows[last + 1]) });
      points.push({ time: dateOf(rows[a]), value: rsi[a] });
    }
    points.push({ time: dateOf(rows[b]), value: rsi[b] });
    last = b;
  });
  return points;
}

const divergenceCache = new WeakMap();

// Regular divergences between consecutive RSI pivots: price makes a lower low while RSI makes
// a higher low (bullish), or price makes a higher high while RSI makes a lower high (bearish).
// Ardışık RSI pivotları arasındaki klasik uyumsuzluklar: fiyat daha düşük dip yaparken RSI daha
// yüksek dip yapar (yükseliş), ya da fiyat daha yüksek tepe yaparken RSI daha düşük tepe yapar (düşüş).
function rsiDivergences(rows) {
  const cached = divergenceCache.get(rows);
  if (cached) return cached;

  const rsi = rows.map((row) => row.RSI_14);
  const lows = [];
  const highs = [];
  for (let i = PIVOT_LOOKBACK; i < rows.length - PIVOT_LOOKBACK; i++) {
    if (isPivot(rsi, i, true)) lows.push(i);
    if (isPivot(rsi, i, false)) highs.push(i);
  }

  const pairs = (pivots, diverges) => {
    const result = [];
    for (let j = 1; j < pivots.length; j++) {
      const a = pivots[j - 1];
      const b = pivots[j];
      const gap = b - a;
      if (gap >= DIVERGENCE_MIN_BARS && gap <= DIVERGENCE_MAX_BARS && diverges(a, b)) result.push([a, b]);
    }
    return result;
  };

  const bull = pairs(lows, (a, b) => rsi[b] > rsi[a] && rows[b].Low < rows[a].Low);
  const bear = pairs(highs, (a, b) => rsi[b] < rsi[a] && rows[b].High > rows[a].High);
  const result = { bull: divergenceLine(rows, rsi, bull), bear: divergenceLine(rows, rsi, bear) };
  divergenceCache.set(rows, result);
  return result;
}

// Series that live directly on the main price pane (pane 0) — these never
// disappear, toggling them just flips `visible`, no pane management needed.
const PANE0_SERIES = [
  { key: 'candle', type: CandlestickSeries, options: {}, data: (rows) => rows.map(toCandleFormat) },
  { key: 'bbUpper', type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Upper' }, data: (rows) => lineData(rows, 'BB_Upper') },
  { key: 'bbMiddle', type: LineSeries, options: { color: 'rgba(150,150,150,0.4)', lineWidth: 1, lineStyle: 2, title: 'BB Middle' }, data: (rows) => lineData(rows, 'BB_Middle') },
  { key: 'bbLower', type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Lower' }, data: (rows) => lineData(rows, 'BB_Lower') },
  { key: 'vwap', type: LineSeries, options: { color: '#a259d9', lineWidth: 1, title: 'VWAP' }, data: (rows) => lineData(rows, 'VWAP') },
  { key: 'supertrendUp', type: LineSeries, options: { color: '#26a69a', lineWidth: 2, title: 'Supertrend' }, data: supertrendUpData },
  { key: 'supertrendDown', type: LineSeries, options: { color: '#ef5350', lineWidth: 2 }, data: supertrendDownData },
];

// Overlay toggle groups (share pane 0 with the candles — simple show/hide).
const OVERLAY_GROUPS = [
  { id: 'ma', keys: [] },
  { id: 'maCross', keys: [] },
  { id: 'bb', keys: ['bbUpper', 'bbMiddle', 'bbLower'] },
  { id: 'vwap', keys: ['vwap'] },
  { id: 'supertrend', keys: ['supertrendUp', 'supertrendDown'] },
  { id: 'srZones', keys: [] },
  { id: 'earnings', keys: [] },
  { id: 'moves', keys: [] },
  { id: 'anchors', keys: [] },
];

// Groups that get their OWN dedicated pane. This array's order is the fixed
// visual stacking order. When a group is hidden, its pane is fully removed
// (chart.removePane) rather than just shrunk — no dead space left behind.
// When any of these toggle, ALL currently-visible dedicated panes are torn
// down and rebuilt from scratch in this order, which keeps pane indices
// simple (always contiguous 1..N) instead of tracking shifting indices.
const DEDICATED_GROUPS = [
  {
    id: 'volume', stretch: 1,
    series: [{ key: 'volume', type: HistogramSeries, options: { priceFormat: { type: 'volume' } }, data: volumeData }],
  },
  {
    id: 'rsi', stretch: 1.2,
    series: [
      { key: 'rsi', type: LineSeries, options: { color: '#a67bd6', lineWidth: 1.5, title: 'RSI14' }, data: (rows) => lineData(rows, 'RSI_14') },
      { key: 'rsiDivBull', type: LineSeries, options: { color: '#3ddc84', ...DIVERGENCE_LINE }, data: (rows) => rsiDivergences(rows).bull, visibleWhen: 'rsiDiv' },
      { key: 'rsiDivBear', type: LineSeries, options: { color: '#e5484d', ...DIVERGENCE_LINE }, data: (rows) => rsiDivergences(rows).bear, visibleWhen: 'rsiDiv' },
    ],
    priceLines: [
      { price: 70, color: '#e5484d', lineStyle: 2, lineWidth: 1, title: '70' },
      { price: 30, color: '#3ddc84', lineStyle: 2, lineWidth: 1, title: '30' },
    ],
    priceLineTargetKey: 'rsi',
  },
  {
    id: 'macd', stretch: 1.2,
    series: [
      { key: 'macd', type: LineSeries, options: { color: '#2a78d6', lineWidth: 1.5, title: 'MACD' }, data: (rows) => lineData(rows, 'MACD') },
      { key: 'macdSignal', type: LineSeries, options: { color: '#eda100', lineWidth: 1.5, title: 'Signal' }, data: (rows) => lineData(rows, 'MACD_Signal') },
      { key: 'macdHist', type: HistogramSeries, options: {}, data: macdHistData },
    ],
  },
  {
    id: 'stoch', stretch: 1.2,
    series: [
      { key: 'stochK', type: LineSeries, options: { color: '#2a78d6', lineWidth: 1.5, title: '%K' }, data: (rows) => lineData(rows, 'Stoch_K') },
      { key: 'stochD', type: LineSeries, options: { color: '#eda100', lineWidth: 1.5, title: '%D' }, data: (rows) => lineData(rows, 'Stoch_D') },
    ],
    priceLines: [
      { price: 80, color: '#e5484d', lineStyle: 2, lineWidth: 1, title: '80' },
      { price: 20, color: '#3ddc84', lineStyle: 2, lineWidth: 1, title: '20' },
    ],
    priceLineTargetKey: 'stochK',
  },
  {
    id: 'adx', stretch: 1,
    series: [{ key: 'adx', type: LineSeries, options: { color: '#52514e', lineWidth: 1.5, title: 'ADX14' }, data: (rows) => lineData(rows, 'ADX_14') }],
  },
  {
    id: 'atr', stretch: 1,
    series: [{ key: 'atr', type: LineSeries, options: { color: '#d9822b', lineWidth: 1.5, title: 'ATR14' }, data: (rows) => lineData(rows, 'ATR_14') }],
  },
  {
    id: 'obv', stretch: 1,
    series: [{ key: 'obv', type: LineSeries, options: { color: '#3d8c5f', lineWidth: 1.5, title: 'OBV' }, data: (rows) => lineData(rows, 'OBV') }],
  },
  {
    id: 'pe', stretch: 1,
    series: [
      { key: 'pe', type: LineSeries, options: { color: '#c2410c', lineWidth: 1.5, title: 'P/E' }, data: (rows) => lineData(rows, 'PE') },
      { key: 'peYoy', type: LineSeries, options: { color: '#64748b', lineWidth: 1, lineStyle: 2, title: 'P/E (1y ago)' }, data: (rows) => lineData(rows, 'PE_PrevYear') },
    ],
  },
];

// rsiDiv has no pane of its own; it draws inside the RSI pane.
// rsiDiv'in kendi paneli yok; RSI panelinin içine çizer.
const TOGGLE_GROUPS = [
  ...OVERLAY_GROUPS,
  ...DEDICATED_GROUPS.flatMap((g) => (g.id === 'rsi' ? [{ id: 'rsi' }, { id: 'rsiDiv' }] : [{ id: g.id }])),
];

const OTHER_TOOL_IDS = ['srZones', 'earnings', 'moves', 'anchors'];
const PANEL_SECTIONS = [
  { titleKey: 'sectionIndicators', groups: TOGGLE_GROUPS.filter((g) => !OTHER_TOOL_IDS.includes(g.id)) },
  { titleKey: 'sectionOther', groups: TOGGLE_GROUPS.filter((g) => OTHER_TOOL_IDS.includes(g.id)) },
];

const DRAWING_TOOLS = [
  { id: 'horizontal', clicksNeeded: 1, key: 'H' },
  { id: 'trendline', clicksNeeded: 2, key: 'T' },
  { id: 'rectangle', clicksNeeded: 2, key: 'R' },
  { id: 'pattern', clicksNeeded: 2, key: 'P' },
];

const TWO_POINT_TOOLS = ['trendline', 'rectangle', 'pattern'];
const TOOL_ICONS = {
  horizontal: HorizontalLineIcon,
  trendline: TrendLineIcon,
  rectangle: RectangleIcon,
  pattern: PatternIcon,
};
const SIDEBAR_TABS = [
  { id: 'indicators', labelKey: 'tabIndicators' },
  { id: 'scan', labelKey: 'tabScan' },
  { id: 'patterns', labelKey: 'tabPatterns' },
  { id: 'moves', labelKey: 'tabMoves' },
  { id: 'psych', labelKey: 'tabPsych' },
];
const LOADING_BARS = [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.54, 0.63];

// A cold symbol pulls its whole history upstream, which can run past a minute.
// Cache'te olmayan sembol tüm geçmişini yukarıdan çekiyor, bu bir dakikayı aşabiliyor.
const SLOW_LOAD_MS = 4000;

function patternHighlight() {
  return { fillColor: colors().accentSoft, borderColor: colors().accent };
}

async function fetchRange(symbol, start, end) {
  const toISO = (d) => d.toISOString().slice(0, 10);
  const url = `${API_BASE}/api/price/${symbol}?start=${toISO(start)}&end=${toISO(end)}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      
    }
    throw new Error(detail);
  }
  // X-Price-Stale: the backend served the cache and is refreshing the last
  // candles in the background, so the newest bars may be missing.
  return {
    rows: await res.json(),
    stale: res.headers.get('X-Price-Stale') === '1',
    historyPending: res.headers.get('X-History-Pending') === '1',
  };
}

async function fetchPatterns(symbol, start, end) {
  const url = `${API_BASE}/api/patterns/${symbol}?start=${start}&end=${end}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.detail;
    const err = new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
    err.code = detail?.code;
    err.limit = detail?.limit;
    throw err;
  }
  return body;
}

async function fetchSrZones(symbol) {
  const url = `${API_BASE}/api/sr/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAnchors(symbol) {
  const url = `${API_BASE}/api/anchors/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEarnings(symbol) {
  const url = `${API_BASE}/api/earnings/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function reactionColor(pct) {
  if (pct == null) return colors().textDim;
  return pct >= 0 ? colors().up : colors().down;
}

function chartThemeOptions(p) {
  return {
    layout: {
      background: { color: p.chartBg },
      textColor: p.chartText,
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      fontSize: 11,
      panes: { separatorColor: p.separator, separatorHoverColor: p.separatorHover, enableResize: true },
    },
    grid: { vertLines: { color: p.gridColor }, horzLines: { color: p.gridColor } },
    crosshair: {
      vertLine: { color: p.crosshair, labelBackgroundColor: p.btnBorder },
      horzLine: { color: p.crosshair, labelBackgroundColor: p.btnBorder },
    },
    rightPriceScale: { borderColor: p.separator },
    timeScale: { borderColor: p.separator },
  };
}

function applyChartTheme(chart, seriesMap) {
  const p = colors();
  chart.applyOptions(chartThemeOptions(p));
  seriesMap.candle?.applyOptions({
    upColor: p.up,
    downColor: p.down,
    wickUpColor: p.up,
    wickDownColor: p.down,
    borderVisible: false,
  });
  seriesMap.supertrendUp?.applyOptions({ color: p.up });
  seriesMap.supertrendDown?.applyOptions({ color: p.down });
}

async function fetchMoves(symbol) {
  const url = `${API_BASE}/api/moves/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Earnings and sharp-move markers share one plugin so they stack instead of overlapping.
// Bilanço ve sert hareket işaretleri üst üste binmesin diye tek eklentiyi paylaşır.
function applyMarkers(markersPlugin, { earningsData, earningsVisible, movesData, movesVisible, rows, crossVisible, str }) {
  if (!markersPlugin) return;
  const markers = [];
  if (crossVisible) {
    maCrosses(rows).forEach((cross) => {
      markers.push({
        time: cross.time,
        position: cross.golden ? 'belowBar' : 'aboveBar',
        shape: 'square',
        color: cross.golden ? '#eda100' : colors().down,
        text: cross.golden ? str.goldenCrossMarker : str.deathCrossMarker,
      });
    });
  }
  if (earningsVisible && earningsData) {
    earningsData.events.forEach((ev) => {
      markers.push({
        time: ev.date,
        position: 'belowBar',
        shape: 'circle',
        color: reactionColor(ev.reactionPct),
        text: str.earningsMarker,
      });
    });
  }
  if (movesVisible && movesData) {
    movesData.moves.forEach((move) => {
      const up = move.pct >= 0;
      const count = move.disclosures.filter((d) => !d.routine).length;
      markers.push({
        time: move.date,
        position: up ? 'belowBar' : 'aboveBar',
        shape: up ? 'arrowUp' : 'arrowDown',
        color: up ? colors().up : colors().down,
        text: count > 0 ? String(count) : '',
      });
    });
  }
  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  markersPlugin.setMarkers(markers);
}

// Crosshair `time` may come back as a BusinessDay object even when data uses date strings.
// Crosshair `time` string olarak verilen veride BusinessDay nesnesi olarak dönebiliyor.
function timeToISO(time) {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  if (time && typeof time === 'object') {
    const pad = (n) => String(n).padStart(2, '0');
    return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  }
  return null;
}

function formatTL(value, str) {
  if (value == null) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} ${str.billionTL}`;
  return `${(value / 1e6).toFixed(1)} ${str.millionTL}`;
}

function applySeriesTitles(seriesMap, titles) {
  Object.entries(titles).forEach(([key, title]) => seriesMap[key]?.applyOptions({ title }));
}

function formatPct(value) {
  if (value == null) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

// Percent change of bar rows[i] relative to the previous close.
// rows[i] barının bir önceki kapanışa göre % değişimi.
function dailyChangePct(rows, i) {
  const prev = rows[i - 1]?.Close;
  if (i < 1 || !prev) return null;
  return (rows[i].Close / prev - 1) * 100;
}

function formatChange(pct) {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function buildQuote(rows) {
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!last) return null;
  const change = prev ? last.Close - prev.Close : null;
  return {
    close: last.Close,
    open: last.Open,
    high: last.High,
    low: last.Low,
    volume: last.Volume,
    change,
    changePct: prev && prev.Close ? (change / prev.Close) * 100 : null,
  };
}

function signed(value, digits = 2) {
  if (value == null) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatVolume(value) {
  if (value == null) return '-';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
}

function formatClock(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// BIST continuous session in Istanbul time (public holidays are not handled).
// İstanbul saatine göre BIST sürekli işlem seansı (resmi tatiller hesaba katılmıyor).
function bistSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const weekday = !['Sat', 'Sun'].includes(get('weekday'));
  return { open: weekday && minutes >= 600 && minutes < 1080, time: `${get('hour')}:${get('minute')}` };
}

function RailButton({ label, shortcut, active, disabled, onClick, children }) {
  return (
    <button
      className={`stc-rail-btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {children}
    </button>
  );
}

function formatDateTR(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}${iso.length > 10 ? ' ' + iso.slice(11) : ''}`;
}

// Rebuilds the S/R zone primitives on the candle series from scratch:
// detaches whatever is currently attached (tracked in primitivesRef),
// then — only when visible and data is available — attaches one
// SRZonePrimitive per zone (red for resistance, green for support).
function applySrZones(series, primitivesRef, srData, visible) {
  if (!series) return;
  primitivesRef.current.forEach((p) => series.detachPrimitive(p));
  primitivesRef.current = [];

  if (!visible || !srData) return;

  const build = (zone, color, fillColor) =>
    new SRZonePrimitive(zone, { lineColor: color, fillColor, label: `${zone.touches}x` });

  const primitives = [
    ...(srData.resistance || []).map((z) => build(z, colors().down, colors().downZone)),
    ...(srData.support || []).map((z) => build(z, colors().up, colors().upZone)),
  ];

  primitives.forEach((p) => series.attachPrimitive(p));
  primitivesRef.current = primitives;
  // Nothing repaints the chart on attach, so ask for it once the set is on.
  primitives[0]?.requestRedraw();
}

// Redraws the psychological level lines: dashed for round numbers, dotted for the 52-week high/low.
// Psikolojik seviye çizgilerini yeniden çizer: yuvarlak sayılar kesikli, 52 haftalık zirve/dip noktalı.
function applyAnchors(series, linesRef, data, visible, str) {
  if (!series) return;
  linesRef.current.forEach((line) => series.removePriceLine(line));
  linesRef.current = [];

  if (!visible || !data?.price) return;

  const lines = [
    ...data.round.map((r) => ({ price: r.level, color: colors().accent, lineStyle: 2, title: String(r.level) })),
    { price: data.high52.level, color: colors().down, lineStyle: 1, title: str.high52Short },
    { price: data.low52.level, color: colors().up, lineStyle: 1, title: str.low52Short },
  ];
  linesRef.current = lines.map((line) => series.createPriceLine({ ...line, lineWidth: 1, axisLabelVisible: true }));
}

// Populates every currently-existing series (pane 0 + whichever dedicated
// panes are currently mounted) with fresh data. Safe to call any time —
// series that don't currently exist are simply skipped (`?.`).
function renderAllSeries(seriesMap, loadedData) {
  PANE0_SERIES.forEach(({ key, data }) => {
    seriesMap[key]?.setData(data(loadedData));
  });
  Object.keys(seriesMap)
    .filter((key) => key.startsWith('ma:'))
    .forEach((key) => seriesMap[key].setData(lineData(loadedData, key.slice(3))));
  DEDICATED_GROUPS.forEach((group) => {
    group.series.forEach(({ key, data }) => {
      seriesMap[key]?.setData(data(loadedData));
    });
  });
}

// Tears down ALL dedicated panes (indices 1..N, removed from the end
// backwards so indices never shift mid-loop) and rebuilds only the
// currently-visible ones, in DEDICATED_GROUPS order, as pane 1, 2, 3...
function rebuildDedicatedPanes(chart, seriesMap, currentVisibility) {
  const paneCount = chart.panes().length;
  for (let i = paneCount - 1; i >= 1; i--) {
    chart.removePane(i);
  }
  DEDICATED_GROUPS.forEach((group) => {
    group.series.forEach(({ key }) => {
      delete seriesMap[key];
    });
  });

  let nextIndex = 1;
  DEDICATED_GROUPS.forEach((group) => {
    if (!currentVisibility[group.id]) return;

    group.series.forEach(({ key, type, options, visibleWhen }) => {
      const visible = visibleWhen ? Boolean(currentVisibility[visibleWhen]) : true;
      seriesMap[key] = chart.addSeries(type, { ...options, visible }, nextIndex);
    });
    chart.panes()[nextIndex].setStretchFactor(group.stretch);

    if (group.priceLines) {
      const target = seriesMap[group.priceLineTargetKey];
      group.priceLines.forEach((line) => target.createPriceLine(line));
    }

    nextIndex += 1;
  });
}

function MaEditor({ config, onChange }) {
  const str = useT();
  const taken = (ma, except) => config.some((other, i) => i !== except && maColumn(other) === maColumn(ma));

  function update(index, patch) {
    const next = { ...config[index], ...patch };
    if (taken(next, index)) return;
    onChange(config.map((ma, i) => (i === index ? next : ma)));
  }

  function add() {
    for (const type of MA_TYPES) {
      const period = MA_PERIODS.find((p) => !taken({ type, period: p }, -1));
      if (period) {
        onChange([...config, { type, period }]);
        return;
      }
    }
  }

  return (
    <div className="stc-ma-editor">
      {config.map((ma, i) => (
        <div key={maColumn(ma)} className="stc-ma-row">
          <span className="stc-ma-swatch" style={{ background: MA_COLORS[i] }} />
          <select
            className="stc-select"
            value={ma.type}
            aria-label={str.maType}
            onChange={(e) => update(i, { type: e.target.value })}
          >
            {MA_TYPES.map((type) => (
              <option key={type} value={type} disabled={taken({ type, period: ma.period }, i)}>
                {type}
              </option>
            ))}
          </select>
          <select
            className="stc-select"
            value={ma.period}
            aria-label={str.maPeriod}
            onChange={(e) => update(i, { period: Number(e.target.value) })}
          >
            {MA_PERIODS.map((period) => (
              <option key={period} value={period} disabled={taken({ type: ma.type, period }, i)}>
                {period}
              </option>
            ))}
          </select>
          <button
            className="stc-ma-remove"
            aria-label={str.removeMa}
            title={str.removeMa}
            disabled={config.length <= 1}
            onClick={() => onChange(config.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      {config.length < MAX_MAS && (
        <button className="stc-ma-add" onClick={add}>
          {str.addMa}
        </button>
      )}
    </div>
  );
}

function App() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
  const loadedDataRef = useRef([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('indicators');
  const [view, setView] = useState('chart');
  const [quote, setQuote] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [session, setSession] = useState(() => bistSession());
  const [darkMode, setDarkMode] = useState(true);
  const [lang, setLang] = useState('en');
  const langRef = useRef(lang);
  const str = STRINGS[lang];
  // Everything starts hidden; the user turns on what they need.
  // Her şey kapalı başlar; kullanıcı ihtiyacı olanı açar.
  const [visibility, setVisibility] = useState(() => Object.fromEntries(TOGGLE_GROUPS.map((g) => [g.id, false])));

  const srZonesRef = useRef(null);
  const srPrimitivesRef = useRef([]);
  const anchorsRef = useRef(null);
  const anchorLinesRef = useRef([]);
  const anchorsVisibleRef = useRef(false);
  const [anchorsData, setAnchorsData] = useState(null);

  const earningsRef = useRef(null);
  const earningsMarkersRef = useRef(null);
  const earningsVisibleRef = useRef(true);
  const movesRef = useRef(null);
  const movesVisibleRef = useRef(true);
  const crossVisibleRef = useRef(false);
  const [maConfig, setMaConfig] = useState(loadMaConfig);
  const maConfigRef = useRef(maConfig);
  const [moveDetail, setMoveDetail] = useState(null);
  const [earningsTip, setEarningsTip] = useState(null);
  const [barChangeTip, setBarChangeTip] = useState(null);
  const [earningsNext, setEarningsNext] = useState(null);

  const [symbol, setSymbol] = useState('THYAO');
  const symbolInputRef = useRef(null);

  const [activeTool, setActiveTool] = useState(null);
  const activeToolRef = useRef(null);
  const pendingPointRef = useRef(null);
  const drawingsRef = useRef([]);
  const previewPrimitiveRef = useRef(null);

  const patternHighlightRef = useRef(null);
  const [patternSearch, setPatternSearch] = useState(null);
  const patternRequestRef = useRef(0);

  const [selectedDrawing, setSelectedDrawing] = useState(null);
  const selectedDrawingRef = useRef(null);
  const [selectedExtend, setSelectedExtend] = useState({ left: false, right: false });

  const t = darkMode ? THEME.dark : THEME.light;

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    const id = setInterval(() => setSession(bistSession()), 30000);
    return () => clearInterval(id);
  }, []);

  function openSidebarTab(tab) {
    setSidebarTab(tab);
    setSidebarOpen(true);
  }

  function handleSelectScanSymbol(sym) {
    setSymbol(sym);
  }

  function handleToggle(groupId) {
    const nextVisible = !visibility[groupId];
    const newVisibility = { ...visibility, [groupId]: nextVisible };
    setVisibility(newVisibility);

    const chart = chartRef.current;
    if (!chart) return;

    if (groupId === 'srZones') {
      applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, nextVisible);
      return;
    }

    if (groupId === 'anchors') {
      anchorsVisibleRef.current = nextVisible;
      applyAnchors(seriesMapRef.current.candle, anchorLinesRef, anchorsRef.current, nextVisible, STRINGS[langRef.current]);
      return;
    }

    if (groupId === 'ma') {
      setMaVisible(nextVisible);
      return;
    }

    if (groupId === 'maCross') {
      crossVisibleRef.current = nextVisible;
      refreshMarkers();
      return;
    }

    if (groupId === 'rsiDiv') {
      // Divergence lines live in the RSI pane, so turning them on also opens RSI.
      // Uyumsuzluk çizgileri RSI panelinde, bu yüzden açılınca RSI da açılır.
      if (nextVisible && !visibility.rsi) {
        newVisibility.rsi = true;
        setVisibility(newVisibility);
        rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility);
        applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);
        renderAllSeries(seriesMapRef.current, loadedDataRef.current);
      } else {
        seriesMapRef.current.rsiDivBull?.applyOptions({ visible: nextVisible });
        seriesMapRef.current.rsiDivBear?.applyOptions({ visible: nextVisible });
      }
      return;
    }

    if (groupId === 'earnings' || groupId === 'moves') {
      if (groupId === 'earnings') {
        earningsVisibleRef.current = nextVisible;
        if (!nextVisible) setEarningsTip(null);
      } else {
        movesVisibleRef.current = nextVisible;
        if (!nextVisible) setMoveDetail(null);
      }
      refreshMarkers();
      return;
    }

    const isDedicated = DEDICATED_GROUPS.some((g) => g.id === groupId);
    if (isDedicated) {
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility);
      applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);
      renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    } else {
      const group = OVERLAY_GROUPS.find((g) => g.id === groupId);
      group.keys.forEach((key) => {
        seriesMapRef.current[key]?.applyOptions({ visible: nextVisible });
      });
    }
  }

  function handleToggleAll() {
    const allVisible = TOGGLE_GROUPS.every((g) => visibility[g.id]);
    const target = !allVisible;
    const newVisibility = Object.fromEntries(TOGGLE_GROUPS.map((g) => [g.id, target]));
    setVisibility(newVisibility);

    OVERLAY_GROUPS.forEach((group) => {
      group.keys.forEach((key) => {
        seriesMapRef.current[key]?.applyOptions({ visible: target });
      });
    });
    applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, target);
    anchorsVisibleRef.current = target;
    applyAnchors(seriesMapRef.current.candle, anchorLinesRef, anchorsRef.current, target, STRINGS[langRef.current]);
    setMaVisible(target);
    earningsVisibleRef.current = target;
    movesVisibleRef.current = target;
    crossVisibleRef.current = target;
    refreshMarkers();
    if (!target) {
      setEarningsTip(null);
      setMoveDetail(null);
    }

    const chart = chartRef.current;
    if (chart) {
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility);
      applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);
      renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    }
  }

  function refreshMarkers() {
    applyMarkers(earningsMarkersRef.current, {
      earningsData: earningsRef.current,
      earningsVisible: earningsVisibleRef.current,
      movesData: movesRef.current,
      movesVisible: movesVisibleRef.current,
      rows: loadedDataRef.current,
      crossVisible: crossVisibleRef.current,
      str: STRINGS[langRef.current],
    });
  }

  function setMaVisible(visible) {
    Object.keys(seriesMapRef.current)
      .filter((key) => key.startsWith('ma:'))
      .forEach((key) => seriesMapRef.current[key].applyOptions({ visible }));
  }

  function handleMaConfigChange(config) {
    setMaConfig(config);
    maConfigRef.current = config;
    saveMaConfig(config);
    const chart = chartRef.current;
    if (chart) syncMaSeries(chart, seriesMapRef.current, config, visibility.ma, loadedDataRef.current);
  }

  function clearSelection() {
    if (selectedDrawingRef.current) {
      selectedDrawingRef.current.setSelected(false);
    }
    selectedDrawingRef.current = null;
    setSelectedDrawing(null);
    setSelectedExtend({ left: false, right: false });
  }

  function handleSelectTool(toolId) {
    pendingPointRef.current = null;
    const series = seriesMapRef.current.candle;
    if (previewPrimitiveRef.current && series) {
      series.detachPrimitive(previewPrimitiveRef.current);
      previewPrimitiveRef.current = null;
    }
    clearSelection();
    setActiveTool((current) => (current === toolId ? null : toolId));
  }

  function handleClearDrawings() {
    const series = seriesMapRef.current.candle;
    if (series) {
      drawingsRef.current.forEach((primitive) => series.detachPrimitive(primitive));
    }
    drawingsRef.current = [];
    clearSelection();
  }

  function handleSelectDrawing(x, y) {
    const hit = [...drawingsRef.current].reverse().find((d) => d.hitTest(x, y));

    if (selectedDrawingRef.current && selectedDrawingRef.current !== hit) {
      selectedDrawingRef.current.setSelected(false);
    }
    if (hit) hit.setSelected(true);

    selectedDrawingRef.current = hit || null;
    setSelectedDrawing(hit || null);
    setSelectedExtend(hit && typeof hit.getExtend === 'function' ? hit.getExtend() : { left: false, right: false });
  }

  function handleDeleteSelected() {
    const series = seriesMapRef.current.candle;
    const selected = selectedDrawingRef.current;
    if (!selected || !series) return;

    series.detachPrimitive(selected);
    drawingsRef.current = drawingsRef.current.filter((d) => d !== selected);
    selectedDrawingRef.current = null;
    setSelectedDrawing(null);
    setSelectedExtend({ left: false, right: false });
  }

  function handleToggleExtend(side) {
    const selected = selectedDrawingRef.current;
    if (!selected || typeof selected.getExtend !== 'function') return;

    const current = selected.getExtend();
    if (side === 'left') {
      selected.setExtendLeft(!current.left);
    } else {
      selected.setExtendRight(!current.right);
    }
    setSelectedExtend(selected.getExtend());
  }

  function handleChartClick(param) {
    const tool = activeToolRef.current;
    const series = seriesMapRef.current.candle;
    const chart = chartRef.current;
    if (!series || !chart || !param.point) return;

    if (!tool) {
      handleSelectDrawing(param.point.x, param.point.y);
      if (!selectedDrawingRef.current && movesVisibleRef.current && param.time) {
        const date = timeToISO(param.time);
        const move = movesRef.current?.moves.find((m) => m.date === date);
        if (move) {
          setMoveDetail(move);
          openSidebarTab('moves');
        }
      }
      return;
    }

    if (!param.time) return;
    const price = series.coordinateToPrice(param.point.y);
    if (price === null) return;

    if (tool === 'horizontal') {
      const primitive = new HorizontalLinePrimitive(price);
      series.attachPrimitive(primitive);
      drawingsRef.current.push(primitive);
      setActiveTool(null);
      return;
    }

    if (!pendingPointRef.current) {
      pendingPointRef.current = { time: param.time, price };
      return;
    }

    const p1 = pendingPointRef.current;
    const p2 = { time: param.time, price };
    pendingPointRef.current = null;

    if (previewPrimitiveRef.current) {
      series.detachPrimitive(previewPrimitiveRef.current);
      previewPrimitiveRef.current = null;
    }

    if (tool === 'pattern') {
      runPatternSearch(p1.time, p2.time);
      setActiveTool(null);
      return;
    }

    const primitive =
      tool === 'trendline' ? new TrendLinePrimitive(p1, p2) : new RectanglePrimitive(p1, p2);
    series.attachPrimitive(primitive);
    drawingsRef.current.push(primitive);
    setActiveTool(null);
  }

  function clearPatternHighlight() {
    if (patternHighlightRef.current) {
      seriesMapRef.current.candle?.detachPrimitive(patternHighlightRef.current);
      patternHighlightRef.current = null;
    }
  }

  async function runPatternSearch(timeA, timeB) {
    const [start, end] = [timeToISO(timeA), timeToISO(timeB)].sort();
    const rows = loadedDataRef.current.filter((row) => dateOf(row) >= start && dateOf(row) <= end);
    const series = seriesMapRef.current.candle;

    clearPatternHighlight();
    if (series && rows.length > 0) {
      const high = Math.max(...rows.map((row) => row.High));
      const low = Math.min(...rows.map((row) => row.Low));
      const highlight = new RectanglePrimitive({ time: start, price: high }, { time: end, price: low }, patternHighlight());
      series.attachPrimitive(highlight);
      patternHighlightRef.current = highlight;
    }

    const requestId = ++patternRequestRef.current;
    setPatternSearch({ loading: true, error: null, data: null });
    openSidebarTab('patterns');
    try {
      const data = await fetchPatterns(symbol, start, end);
      if (requestId === patternRequestRef.current) setPatternSearch({ loading: false, error: null, data });
    } catch (err) {
      if (requestId === patternRequestRef.current) {
        setPatternSearch({ loading: false, error: { code: err.code, limit: err.limit, message: err.message }, data: null });
      }
    }
  }

  function handleClosePatternSearch() {
    patternRequestRef.current += 1;
    clearPatternHighlight();
    setPatternSearch(null);
  }

  function handleCrosshairMove(param) {
    const tool = activeToolRef.current;
    if (!pendingPointRef.current || !TWO_POINT_TOOLS.includes(tool)) return;
    if (!param.point || !param.time) return;

    const series = seriesMapRef.current.candle;
    if (!series) return;
    const price = series.coordinateToPrice(param.point.y);
    if (price === null) return;

    const p1 = pendingPointRef.current;
    const p2 = { time: param.time, price };

    if (!previewPrimitiveRef.current) {
      const PrimitiveClass = tool === 'trendline' ? TrendLinePrimitive : RectanglePrimitive;
      const extra = tool === 'pattern' ? patternHighlight() : {};
      const preview = new PrimitiveClass(p1, p2, { preview: true, ...extra });
      series.attachPrimitive(preview);
      previewPrimitiveRef.current = preview;
    } else {
      previewPrimitiveRef.current.setSecondPoint(p2);
    }
  }

  useEffect(() => {
    const toolByKey = Object.fromEntries(DRAWING_TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));

    function isTyping() {
      const el = document.activeElement;
      if (!el) return false;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
    }

    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (isTyping()) {
          document.activeElement.blur();
        } else if (activeToolRef.current) {
          handleSelectTool(null);
        } else {
          clearSelection();
        }
        return;
      }
      if (isTyping()) return;

      if (e.key === '/') {
        e.preventDefault();
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingRef.current) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }
      const tool = toolByKey[e.key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        handleSelectTool(tool);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingSlow(false);
      return undefined;
    }
    const id = setTimeout(() => setLoadingSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(id);
  }, [loading]);

  useEffect(() => {
    let chart;
    let cancelled = false;
    let staleRetryId = null;

    let loadedData = [];
    let isLoadingMore = false;
    let noMoreData = false;
    let historyRetries = 0;
    let historyRetryId = null;

    async function loadMoreHistory() {
      if (isLoadingMore || noMoreData || loadedData.length === 0) return;
      isLoadingMore = true;

      const earliest = new Date(dateOf(loadedData[0]));
      const newEnd = new Date(earliest);
      newEnd.setDate(newEnd.getDate() - 1);
      const newStart = new Date(newEnd);
      newStart.setMonth(newStart.getMonth() - CHUNK_MONTHS);

      try {
        const { rows: older, historyPending } = await fetchRange(symbol, newStart, newEnd);
        if (cancelled) return;

        if (older.length === 0) {
          // An empty answer while the backend is still walking the history
          // means "not yet", not "no more" - so ask again instead of latching.
          // Backend geçmişi hâlâ yürürken gelen boş yanıt "daha yok" değil
          // "henüz yok" demek - kilitlemek yerine tekrar soruyoruz.
          if (historyPending && historyRetries < HISTORY_RETRY_LIMIT) {
            historyRetries += 1;
            historyRetryId = setTimeout(() => {
              historyRetryId = null;
              loadMoreHistory();
            }, HISTORY_RETRY_MS);
          } else {
            noMoreData = true;
          }
          return;
        }

        historyRetries = 0;

        const previousRange = chart.timeScale().getVisibleLogicalRange();

        loadedData = [...older, ...loadedData];
        loadedDataRef.current = loadedData;
        renderAllSeries(seriesMapRef.current, loadedData);
        refreshMarkers();

        if (previousRange) {
          chart.timeScale().setVisibleLogicalRange({
            from: previousRange.from + older.length,
            to: previousRange.to + older.length,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        isLoadingMore = false;
      }
    }

    async function init() {
      try {
        setError(null);
        setLoading(true);
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - CHUNK_MONTHS);

        // S/R zones are fetched AFTER price data, sequentially - fetching both at
        // once made each try to refresh the price cache simultaneously and
        // triggered 429 (rate limit) responses from TradingView.
        // SR zonelarını fiyat verisinden SONRA, sırayla çekiyoruz - aynı anda
        // çekmek ikisinin de fiyat cache'ini aynı anda tazelemeye çalışmasına
        // ve TradingView'den 429 (rate limit) almasına yol açıyordu.
        const { rows: data, stale } = await fetchRange(symbol, start, end);
        if (cancelled) return;
        const srData = await fetchSrZones(symbol).catch(() => null);
        if (cancelled) return;
        srZonesRef.current = srData;
        const earningsData = await fetchEarnings(symbol).catch(() => null);
        if (cancelled) return;
        earningsRef.current = earningsData;
        setEarningsNext(earningsData?.next ?? null);

        const themeOptions = chartThemeOptions(colors());
        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          ...themeOptions,
          crosshair: { ...themeOptions.crosshair, mode: CrosshairMode.Normal },
          localization: { locale: STRINGS[langRef.current].locale },
        });
        chartRef.current = chart;

        PANE0_SERIES.forEach(({ key, type, options }) => {
          const group = OVERLAY_GROUPS.find((g) => g.keys.includes(key));
          const visible = group ? visibility[group.id] : true;
          seriesMapRef.current[key] = chart.addSeries(type, { ...options, visible }, 0);
        });
        syncMaSeries(chart, seriesMapRef.current, maConfigRef.current, visibility.ma, []);
        chart.panes()[0].setStretchFactor(MAIN_PANE_STRETCH);
        applyChartTheme(chart, seriesMapRef.current);

        rebuildDedicatedPanes(chart, seriesMapRef.current, visibility);
        applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);

        loadedData = data;
        loadedDataRef.current = loadedData;
        setQuote(buildQuote(data));
        setUpdatedAt(new Date());
        renderAllSeries(seriesMapRef.current, loadedData);
        applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, visibility.srZones);
        earningsMarkersRef.current = createSeriesMarkers(seriesMapRef.current.candle, []);
        earningsVisibleRef.current = visibility.earnings;
        movesVisibleRef.current = visibility.moves;
        anchorsVisibleRef.current = visibility.anchors;
        crossVisibleRef.current = visibility.maCross;
        refreshMarkers();
        const lastIdx = loadedData.length - 1;
        const dailyChange = new DailyChangePrimitive();
        dailyChange.setValue(
          lastIdx >= 1 ? { price: loadedData[lastIdx].Close, pct: dailyChangePct(loadedData, lastIdx) } : null
        );
        seriesMapRef.current.candle.attachPrimitive(dailyChange);
        chart.timeScale().fitContent();

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && range.from < EDGE_THRESHOLD) {
            loadMoreHistory();
          }
        });

        chart.subscribeClick(handleChartClick);

        // The chart is already up from the cache; the backend is fetching the
        // newest candles in the background, so ask once more for them.
        // Grafik önbellekten çizildi; backend en yeni mumları arka planda
        // çekiyor, bir kez daha sorup onları da alıyoruz.
        if (stale) {
          staleRetryId = setTimeout(async () => {
            staleRetryId = null;
            try {
              const { rows } = await fetchRange(symbol, start, end);
              if (cancelled || rows.length === 0) return;
              const firstNew = dateOf(rows[0]);
              loadedData = [...loadedData.filter((row) => dateOf(row) < firstNew), ...rows];
              loadedDataRef.current = loadedData;
              setQuote(buildQuote(loadedData));
              setUpdatedAt(new Date());
              renderAllSeries(seriesMapRef.current, loadedData);
              refreshMarkers();
            } catch {
              // Nothing to do - the chart already shows the cached data.
              // Yapacak bir şey yok - grafik zaten önbellekteki veriyi gösteriyor.
            }
          }, STALE_RETRY_MS);
        }

        // Loaded in the background: the first call may download XU100 history and take a while.
        // Arka planda yüklenir: ilk çağrı XU100 geçmişini indirebildiği için uzun sürebilir.
        fetchMoves(symbol)
          .then((movesData) => {
            if (cancelled) return;
            movesRef.current = movesData;
            refreshMarkers();
          })
          .catch(() => {});
        fetchAnchors(symbol)
          .then((data) => {
            if (cancelled) return;
            anchorsRef.current = data;
            setAnchorsData(data);
            applyAnchors(seriesMapRef.current.candle, anchorLinesRef, data, anchorsVisibleRef.current, STRINGS[langRef.current]);
          })
          .catch(() => {});
        chart.subscribeCrosshairMove(handleCrosshairMove);

        const eventsByDate = new Map((earningsData?.events || []).map((ev) => [ev.date, ev]));
        chart.subscribeCrosshairMove((param) => {
          const date = param.time ? timeToISO(param.time) : null;
          const ev = earningsVisibleRef.current && date ? eventsByDate.get(date) : null;
          if (!ev || !param.point) {
            setEarningsTip((prev) => (prev ? null : prev));
            return;
          }
          setEarningsTip({ x: param.point.x, y: param.point.y, event: ev });
        });

        // Daily % change of the hovered bar, excluding the last bar.
        // Son bar hariç, imlecin üzerinde olduğu barın günlük % değişimi.
        chart.subscribeCrosshairMove((param) => {
          const rows = loadedDataRef.current;
          const date = param.time && param.point ? timeToISO(param.time) : null;
          const i = date ? rows.findIndex((row) => dateOf(row) === date) : -1;
          const pct = i >= 1 && i < rows.length - 1 ? dailyChangePct(rows, i) : null;
          const candle = seriesMapRef.current.candle;
          const x = pct != null ? chart.timeScale().timeToCoordinate(param.time) : null;
          const y = pct != null ? candle?.priceToCoordinate(rows[i].High) : null;
          if (x == null || y == null) {
            setBarChangeTip((prev) => (prev ? null : prev));
            return;
          }
          setBarChangeTip({ x, y, pct });
        });

        const resizeObserver = new ResizeObserver((entries) => {
          if (chart && entries[0]) {
            chart.applyOptions({
              width: entries[0].contentRect.width,
              height: entries[0].contentRect.height,
            });
          }
        });
        resizeObserver.observe(chartContainerRef.current);
        chart._cleanupResizeObserver = () => resizeObserver.disconnect();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (staleRetryId) clearTimeout(staleRetryId);
      if (historyRetryId) clearTimeout(historyRetryId);
      if (chart) {
        chart._cleanupResizeObserver?.();
        chart.remove();
      }
      chartRef.current = null;
      seriesMapRef.current = {};
      loadedDataRef.current = [];
      drawingsRef.current = [];
      srPrimitivesRef.current = [];
      anchorsRef.current = null;
      anchorLinesRef.current = [];
      setAnchorsData(null);
      earningsRef.current = null;
      earningsMarkersRef.current = null;
      setEarningsTip(null);
      setBarChangeTip(null);
      setEarningsNext(null);
      setQuote(null);
      movesRef.current = null;
      setMoveDetail(null);
      patternHighlightRef.current = null;
      patternRequestRef.current += 1;
      setPatternSearch(null);
      pendingPointRef.current = null;
      previewPrimitiveRef.current = null;
      selectedDrawingRef.current = null;
      setSelectedDrawing(null);
      setSelectedExtend({ left: false, right: false });
      setActiveTool(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    setPalette(t);
    const chart = chartRef.current;
    if (!chart) return;
    applyChartTheme(chart, seriesMapRef.current);
    renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    refreshMarkers();
    applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, visibility.srZones);
    applyAnchors(seriesMapRef.current.candle, anchorLinesRef, anchorsRef.current, visibility.anchors, STRINGS[langRef.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkMode]);

  useEffect(() => {
    langRef.current = lang;
    document.documentElement.lang = lang;
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ localization: { locale: STRINGS[lang].locale } });
    applySeriesTitles(seriesMapRef.current, STRINGS[lang].seriesTitles);
    refreshMarkers();
    applyAnchors(seriesMapRef.current.candle, anchorLinesRef, anchorsRef.current, visibility.anchors, STRINGS[lang]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const allVisible = TOGGLE_GROUPS.every((g) => visibility[g.id]);
  const canExtend = selectedDrawing && typeof selectedDrawing.getExtend === 'function';

  return (
    <LangContext.Provider value={str}>
      <div
        className="stc-root"
        style={{
          position: 'relative',
          height: '100vh',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: t.pageBg,
          '--page-bg': t.pageBg,
          '--panel-bg': t.panelBg,
          '--panel-border': t.panelBorder,
          '--text': t.text,
          '--text-strong': t.textStrong,
          '--text-dim': t.textDim,
          '--up': t.up,
          '--down': t.down,
          '--accent-text': t.accentText,
          '--btn-bg': t.btnBg,
          '--btn-bg-hover': t.btnBgHover,
          '--btn-border': t.btnBorder,
          '--input-bg': t.inputBg,
          '--accent': t.accent,
          '--accent-hover': t.accentHover,
          '--accent-ring': t.accentRing,
          '--accent-soft': t.accentSoft,
          '--grid-color': t.gridColor,
          '--separator-hover': t.separatorHover,
          '--crosshair': t.crosshair,
        }}
      >
        <style>{`
          .stc-root {
            font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
            font-variant-numeric: tabular-nums;
            color: var(--text);
          }
          .stc-header {
            background: var(--panel-bg);
            border: 1px solid var(--panel-border);
            border-radius: 4px;
            padding: 8px 10px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .stc-title {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-weight: 600;
            font-size: 15px;
            letter-spacing: 0.02em;
            color: var(--text-strong);
            margin: 0;
            padding: 0 2px;
          }
          .stc-input {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 13px;
            font-weight: 500;
            text-transform: uppercase;
            border: 1px solid var(--btn-border);
            background: var(--input-bg);
            color: var(--text-strong);
            border-radius: 3px;
            padding: 6px 9px;
            width: 100px;
            outline: none;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          .stc-input::placeholder {
            color: var(--text-dim);
            text-transform: none;
          }
          .stc-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-ring);
          }
          .stc-btn {
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            border: 1px solid var(--btn-border);
            background: var(--btn-bg);
            color: var(--text);
            border-radius: 3px;
            padding: 6px 11px;
            cursor: pointer;
            transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
          }
          .stc-btn:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .stc-btn:disabled:hover {
            background: var(--btn-bg);
            color: var(--text);
          }
          .stc-btn-primary,
          .stc-btn-active {
            background: var(--accent);
            border-color: var(--accent);
            color: var(--accent-text);
          }
          .stc-btn-primary:hover,
          .stc-btn-active:hover {
            background: var(--accent-hover);
            border-color: var(--accent-hover);
            color: var(--accent-text);
          }
          .stc-btn:focus-visible,
          .stc-theme-toggle:focus-visible,
          .stc-toggle-all:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
          }
          .stc-theme-toggle {
            width: 28px;
            height: 28px;
            border-radius: 3px;
            border: 1px solid var(--btn-border);
            background: var(--btn-bg);
            color: var(--text-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-theme-toggle:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-toggle-all {
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            border: 1px solid var(--btn-border);
            background: var(--btn-bg);
            color: var(--text);
            border-radius: 3px;
            padding: 7px 12px;
            cursor: pointer;
            width: 100%;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-toggle-all:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-section-title {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-dim);
            margin: 14px 2px 6px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--panel-border);
          }
          .stc-checkbox-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 6px;
          }
          .stc-checkbox-row {
            display: flex;
            align-items: center;
            gap: 9px;
            font-size: 14px;
            color: var(--text);
            white-space: nowrap;
            padding: 6px 8px;
            border-radius: 3px;
            cursor: pointer;
            transition: background-color 120ms ease;
          }
          .stc-checkbox-row:hover {
            background: var(--btn-bg-hover);
          }
          .stc-checkbox-row input[type="checkbox"] {
            width: 14px;
            height: 14px;
            margin: 0;
            flex-shrink: 0;
            cursor: pointer;
            accent-color: var(--accent);
          }
          .stc-ma-editor {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 6px 2px 0;
            padding: 8px;
            border: 1px solid var(--panel-border);
            border-radius: 3px;
          }
          .stc-ma-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .stc-ma-swatch {
            width: 10px;
            height: 10px;
            border-radius: 2px;
            flex-shrink: 0;
          }
          .stc-select {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 12.5px;
            border: 1px solid var(--btn-border);
            background: var(--input-bg);
            color: var(--text-strong);
            border-radius: 3px;
            padding: 4px 6px;
            flex: 1;
            min-width: 0;
          }
          .stc-ma-remove, .stc-ma-add {
            font-family: inherit;
            border: 1px solid var(--btn-border);
            background: var(--btn-bg);
            color: var(--text);
            border-radius: 3px;
            cursor: pointer;
          }
          .stc-ma-remove {
            width: 26px;
            height: 26px;
            font-size: 15px;
            line-height: 1;
            flex-shrink: 0;
          }
          .stc-ma-remove:disabled {
            opacity: 0.4;
            cursor: default;
          }
          .stc-ma-add {
            font-size: 12.5px;
            padding: 5px 8px;
            margin-top: 2px;
          }
          .stc-ma-remove:not(:disabled):hover, .stc-ma-add:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-kbd {
            position: absolute;
            right: 7px;
            top: 50%;
            transform: translateY(-50%);
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 10.5px;
            line-height: 15px;
            color: var(--text-dim);
            border: 1px solid var(--btn-border);
            border-radius: 2px;
            padding: 0 4px;
            pointer-events: none;
          }
          .stc-mono {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
          }
          .stc-muted {
            margin: 0;
            font-size: 13px;
            line-height: 1.55;
            color: var(--text-dim);
          }
          .stc-panel-title {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-strong);
          }
          .stc-topbar {
            height: 48px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 18px;
            padding: 0 12px 0 16px;
            background: var(--panel-bg);
            border-bottom: 1px solid var(--panel-border);
          }
          .stc-brand {
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.14em;
            color: var(--text-dim);
            white-space: nowrap;
          }
          .stc-vrule {
            width: 1px;
            height: 24px;
            background: var(--panel-border);
          }
          .stc-quote {
            display: flex;
            align-items: baseline;
            gap: 10px;
            white-space: nowrap;
          }
          .stc-quote-price {
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 20px;
            font-weight: 600;
            color: var(--text-strong);
          }
          .stc-ohlc {
            display: flex;
            gap: 14px;
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
          }
          .stc-ohlc b {
            font-weight: 500;
            color: var(--text);
          }
          .stc-session {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--text-dim);
            white-space: nowrap;
          }
          .stc-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
          }
          .stc-seg {
            display: flex;
            border: 1px solid var(--btn-border);
            border-radius: 3px;
            overflow: hidden;
          }
          .stc-seg button {
            height: 28px;
            padding: 0 10px;
            border: none;
            background: transparent;
            color: var(--text-dim);
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
          }
          .stc-seg button.is-active {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-icon-btn {
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 3px;
            background: transparent;
            color: var(--text-dim);
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-icon-btn.stc-bordered {
            border-color: var(--btn-border);
          }
          .stc-icon-btn:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-icon-btn.is-active {
            color: var(--accent);
          }
          .stc-rail {
            width: 48px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 10px 0;
            background: var(--panel-bg);
            border-right: 1px solid var(--panel-border);
          }
          .stc-rail-btn {
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: none;
            border-radius: 3px;
            background: transparent;
            color: var(--text-dim);
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-rail-btn:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-rail-btn.is-active {
            background: var(--btn-bg-hover);
            color: var(--accent);
          }
          .stc-rail-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            background: transparent;
            color: var(--text-dim);
          }
          .stc-rail-divider {
            width: 20px;
            height: 1px;
            margin: 6px 0;
            background: var(--panel-border);
          }
          .stc-sidebar {
            width: 360px;
            flex-shrink: 0;
            flex-direction: column;
            min-height: 0;
            background: var(--panel-bg);
            border-left: 1px solid var(--panel-border);
          }
          .stc-tabs {
            display: flex;
            height: 40px;
            flex-shrink: 0;
            border-bottom: 1px solid var(--panel-border);
          }
          .stc-tab {
            flex: 1;
            border: none;
            background: transparent;
            color: var(--text-dim);
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            cursor: pointer;
            transition: color 120ms ease;
          }
          .stc-tab:hover {
            color: var(--text-strong);
          }
          .stc-tab.is-active {
            color: var(--text-strong);
            font-weight: 600;
            box-shadow: inset 0 -2px 0 var(--accent);
          }
          .stc-tabpanel {
            flex-grow: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            padding: 14px 16px;
            overflow-y: auto;
          }
          .stc-tabpanel[hidden] {
            display: none;
          }
          .stc-statusbar {
            height: 26px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 0 16px;
            background: var(--panel-bg);
            border-top: 1px solid var(--panel-border);
            font-family: 'IBM Plex Mono', ui-monospace, monospace;
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
          }
          .stc-row {
            cursor: pointer;
          }
          .stc-row:hover {
            background: var(--btn-bg-hover);
          }
          .stc-loading {
            position: absolute;
            inset: 0;
            z-index: 18;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 14px;
            background: var(--page-bg);
            pointer-events: none;
          }
          .stc-loading-bars {
            display: flex;
            align-items: flex-end;
            gap: 5px;
            height: 48px;
          }
          .stc-loading-bars i {
            display: block;
            width: 5px;
            border-radius: 1px;
            background: var(--text-dim);
            animation: stc-bar 1.1s ease-in-out infinite;
          }
          @keyframes stc-bar {
            0%, 100% { height: 12px; opacity: 0.25; }
            50% { height: 46px; opacity: 0.7; }
          }
          .stc-loading-hint {
            margin: 0;
            max-width: 320px;
            text-align: center;
            font-size: 12px;
            color: var(--text-dim);
            animation: stc-fade 0.4s ease-out;
          }
          @keyframes stc-fade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .stc-loading-bars i {
              animation: none;
              height: 28px;
              opacity: 0.4;
            }
            .stc-loading-hint {
              animation: none;
            }
          }
          .stc-error {
            position: absolute;
            top: 12px;
            left: 12px;
            z-index: 20;
            margin: 0;
            padding: 8px 12px;
            font-size: 12.5px;
            color: var(--down);
            background: var(--panel-bg);
            border: 1px solid var(--panel-border);
            border-radius: 3px;
          }
          .stc-seg button:focus-visible,
          .stc-icon-btn:focus-visible,
          .stc-rail-btn:focus-visible,
          .stc-tab:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: -2px;
          }
          @media (prefers-reduced-motion: reduce) {
            .stc-btn, .stc-input, .stc-toggle-all, .stc-theme-toggle, .stc-checkbox-row { transition: none; }
          }
        `}</style>

        <header className="stc-topbar">
          <div className="stc-brand">
            <LogoMark />
            SMARTER CHARTS
          </div>
          <div className="stc-vrule" />

          <div className="stc-seg" role="group" aria-label={str.viewChart + ' / ' + str.viewFundamentals}>
            <button
              className={view === 'chart' ? 'is-active' : ''}
              aria-pressed={view === 'chart'}
              onClick={() => setView('chart')}
            >
              {str.viewChart}
            </button>
            <button
              className={view === 'fundamentals' ? 'is-active' : ''}
              aria-pressed={view === 'fundamentals'}
              onClick={() => setView('fundamentals')}
            >
              {str.viewFundamentals}
            </button>
          </div>
          <div className="stc-vrule" />

          <SymbolPicker symbol={symbol} onSelect={setSymbol} inputRef={symbolInputRef} />

          {quote && (
            <div className="stc-quote">
              <span className="stc-quote-price">{quote.close.toFixed(2)}</span>
              <span
                className="stc-mono"
                style={{ fontSize: '13px', fontWeight: 500, color: (quote.change ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}
              >
                {signed(quote.change)}&nbsp;&nbsp;{signed(quote.changePct)}%
              </span>
            </div>
          )}
          {quote && (
            <div className="stc-ohlc stc-mono">
              <span>O <b>{quote.open.toFixed(2)}</b></span>
              <span>H <b>{quote.high.toFixed(2)}</b></span>
              <span>L <b>{quote.low.toFixed(2)}</b></span>
              <span>V <b>{formatVolume(quote.volume)}</b></span>
            </div>
          )}

          <div style={{ flexGrow: 1 }} />

          {visibility.earnings && earningsNext && (
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {str.nextEarnings(formatDateTR(earningsNext))}
            </span>
          )}
          <span className="stc-session">
            <span className="stc-dot" style={{ background: session.open ? 'var(--up)' : 'var(--text-dim)' }} />
            {session.open ? str.sessionOpen(session.time) : str.sessionClosed(session.time)}
          </span>
          <div className="stc-seg" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'is-active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={lang === 'tr' ? 'is-active' : ''} aria-pressed={lang === 'tr'} onClick={() => setLang('tr')}>
              TR
            </button>
          </div>
          <button
            className="stc-icon-btn stc-bordered"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? str.lightMode : str.darkMode}
            title={darkMode ? str.lightMode : str.darkMode}
          >
            {darkMode ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
          <button
            className={`stc-icon-btn stc-bordered ${sidebarOpen ? 'is-active' : ''}`}
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={str.togglePanel}
            aria-pressed={sidebarOpen}
            title={str.togglePanel}
          >
            <PanelIcon size={15} />
          </button>
        </header>

        <div style={{ flexGrow: 1, display: view === 'chart' ? 'flex' : 'none', minHeight: 0 }}>
          <nav className="stc-rail" aria-label={str.toolsTitle}>
            <RailButton label={str.cursor} shortcut="Esc" active={!activeTool} onClick={() => handleSelectTool(null)}>
              <CursorIcon />
            </RailButton>
            {DRAWING_TOOLS.map((tool) => {
              const ToolIcon = TOOL_ICONS[tool.id];
              return (
                <RailButton
                  key={tool.id}
                  label={str.drawingTools[tool.id]}
                  shortcut={tool.key}
                  active={activeTool === tool.id}
                  onClick={() => handleSelectTool(tool.id)}
                >
                  <ToolIcon />
                </RailButton>
              );
            })}
            <div className="stc-rail-divider" />
            <RailButton
              label={str.extendLeft}
              active={selectedExtend.left}
              disabled={!canExtend}
              onClick={() => handleToggleExtend('left')}
            >
              <ExtendLeftIcon />
            </RailButton>
            <RailButton
              label={str.extendRight}
              active={selectedExtend.right}
              disabled={!canExtend}
              onClick={() => handleToggleExtend('right')}
            >
              <ExtendRightIcon />
            </RailButton>
            <RailButton label={str.deleteSelected} shortcut="Del" disabled={!selectedDrawing} onClick={handleDeleteSelected}>
              <DeleteIcon />
            </RailButton>
            <RailButton label={str.clear} onClick={handleClearDrawings}>
              <ClearAllIcon />
            </RailButton>
          </nav>

          <main style={{ flexGrow: 1, position: 'relative', minWidth: 0 }}>
            <div
              ref={chartContainerRef}
              style={{ position: 'absolute', inset: 0, cursor: activeTool ? 'crosshair' : 'default' }}
            />

            {loading && !error && (
              <div className="stc-loading" role="status" aria-live="polite">
                <div className="stc-loading-bars" aria-hidden="true">
                  {LOADING_BARS.map((delay) => (
                    <i key={delay} style={{ animationDelay: `${delay}s` }} />
                  ))}
                </div>
                <p className="stc-mono" style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-dim)' }}>
                  {str.loadingSymbol(symbol)}
                </p>
                {loadingSlow && <p className="stc-loading-hint">{str.loadingSlowHint}</p>}
              </div>
            )}

            {error && (
              <p className="stc-error">
                {str.loadFailed}: {error}
              </p>
            )}

            {barChangeTip && (
              <div
                className="stc-mono"
                style={{
                  position: 'absolute',
                  left: barChangeTip.x,
                  top: barChangeTip.y - 8,
                  transform: 'translate(-50%, -100%)',
                  zIndex: 25,
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--page-bg)',
                  background: reactionColor(barChangeTip.pct),
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatChange(barChangeTip.pct)}
              </div>
            )}

            {earningsTip && (
              <div
                className="stc-header"
                style={{
                  position: 'absolute',
                  left: Math.max(8, Math.min(earningsTip.x + 14, (chartContainerRef.current?.clientWidth ?? 0) - 250)),
                  top: Math.max(8, earningsTip.y - 130),
                  zIndex: 30,
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '3px',
                  padding: '10px 12px',
                  width: '230px',
                  fontSize: '12px',
                  color: 'var(--text)',
                  pointerEvents: 'none',
                }}
              >
                <strong style={{ fontSize: '13px', color: 'var(--text-strong)' }}>
                  {str.earningsTitle(earningsTip.event.period)}
                </strong>
                <span style={{ color: 'var(--text-dim)' }}>{str.announced(formatDateTR(earningsTip.event.publishedAt))}</span>
                <span>{str.netIncome(formatTL(earningsTip.event.netIncome, str))}</span>
                <span>{str.yoyChange(formatPct(earningsTip.event.netIncomeYoY))}</span>
                <span style={{ color: reactionColor(earningsTip.event.reactionPct) }}>
                  {str.priceReaction(earningsTip.event.reactionDays, formatPct(earningsTip.event.reactionPct))}
                </span>
              </div>
            )}
          </main>

          <aside className="stc-sidebar" style={{ display: sidebarOpen ? 'flex' : 'none' }}>
            <div className="stc-tabs" role="tablist">
              {SIDEBAR_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={sidebarTab === tab.id}
                  className={`stc-tab ${sidebarTab === tab.id ? 'is-active' : ''}`}
                  onClick={() => setSidebarTab(tab.id)}
                >
                  {str[tab.labelKey]}
                </button>
              ))}
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'indicators'}>
              <button className="stc-toggle-all" onClick={handleToggleAll}>
                {allVisible ? str.hideAll : str.showAll}
              </button>
              {PANEL_SECTIONS.map((section) => (
                <div key={section.titleKey}>
                  <div className="stc-section-title">{str[section.titleKey]}</div>
                  <div className="stc-checkbox-grid">
                    {section.groups.map((group) => (
                      <label key={group.id} className="stc-checkbox-row" title={str.groupHints[group.id]}>
                        <input
                          type="checkbox"
                          checked={visibility[group.id]}
                          onChange={() => handleToggle(group.id)}
                        />
                        {str.groups[group.id]}
                      </label>
                    ))}
                  </div>
                  {section.titleKey === 'sectionIndicators' && visibility.ma && (
                    <MaEditor config={maConfig} onChange={handleMaConfigChange} />
                  )}
                </div>
              ))}
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'scan'}>
              <VolumeScanWidget onSelectSymbol={handleSelectScanSymbol} />
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'patterns'}>
              <PatternSearchWidget state={patternSearch} onClose={handleClosePatternSearch} />
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'moves'}>
              <MoveReasonsWidget move={moveDetail} onClose={() => setMoveDetail(null)} />
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'psych'}>
              <AnchorsWidget data={anchorsData} />
              <div style={{ borderTop: '1px solid var(--panel-border)', margin: '16px 0' }} />
              <AnchorScanWidget onSelectSymbol={handleSelectScanSymbol} />
            </div>
          </aside>
        </div>

        {view === 'fundamentals' && <FundamentalsView symbol={symbol} />}

        <footer className="stc-statusbar">
          <span>{symbol} · 1D · BIST</span>
          {updatedAt && <span>{str.updated(formatClock(updatedAt))}</span>}
          <div style={{ flexGrow: 1 }} />
          <span>{str.shortcutsHint}</span>
          <span>{str.dataSources}</span>
        </footer>
      </div>
    </LangContext.Provider>
  );
}

export default App;