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
  FibonacciPrimitive,
  HorizontalLinePrimitive,
  CostProfilePrimitive,
  SRZonePrimitive,
  DailyChangePrimitive,
} from './drawingTools.js';
import SymbolPicker from './SymbolPicker.jsx';
import FundamentalsView from './FundamentalsView.jsx';
import PortfolioView from './PortfolioView.jsx';
import VolumeScanWidget from './VolumeScanWidget.jsx';
import PatternSearchWidget from './PatternSearchWidget.jsx';
import MoveReasonsWidget from './MoveReasonsWidget.jsx';
import ReactionProfileWidget from './ReactionProfileWidget.jsx';
import AnchorsWidget from './AnchorsWidget.jsx';
import AnchorScanWidget from './AnchorScanWidget.jsx';
import SectorHeatWidget from './SectorHeatWidget.jsx';
import NotesPanel from './NotesPanel.jsx';
import { API_BASE } from './config.js';
import { STRINGS, LangContext, useT } from './i18n.js';
import { useSymbolKind, useSymbolName } from './symbolList.js';
import { THEME, setPalette, colors } from './theme.js';
import {
  LogoMark,
  CursorIcon,
  TrendLineIcon,
  HorizontalLineIcon,
  RectangleIcon,
  PatternIcon,
  FibonacciIcon,
  ExtendLeftIcon,
  ExtendRightIcon,
  DeleteIcon,
  ClearAllIcon,
  SunIcon,
  MoonIcon,
  CloseIcon,
  IndicatorIcon,
  ScanIcon,
  ContextIcon,
  NotesIcon,
  PinIcon,
  HelpIcon,
  MoreIcon,
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
  { id: 'autoFib', keys: [] },
  { id: 'costProfile', keys: [] },
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
    // The quartiles of the symbol's own P/E history, so the line can be read
    // against something. Held flat across the pane: they describe the whole
    // history, not the window in view, and they stay put while it is scrolled.
    // Sembolün kendi F/K geçmişinin çeyreklikleri, ki çizgi bir şeye karşı
    // okunabilsin. Panel boyunca düz duruyorlar: pencereyi değil bütün geçmişi
    // anlatıyorlar ve pencere kaydırılırken yerinde kalıyorlar.
    priceLinesFrom: (extras) => {
      const band = extras?.peBand;
      if (!band?.supported) return [];
      return [
        { price: band.p75, color: '#64748b', lineStyle: 1, lineWidth: 1, title: '75%' },
        { price: band.median, color: '#64748b', lineStyle: 2, lineWidth: 1, title: '50%' },
        { price: band.p25, color: '#64748b', lineStyle: 1, lineWidth: 1, title: '25%' },
      ];
    },
    priceLineTargetKey: 'pe',
  },
  {
    id: 'pb', stretch: 1,
    series: [
      { key: 'pb', type: LineSeries, options: { color: '#7c3aed', lineWidth: 1.5, title: 'P/B' }, data: (rows) => lineData(rows, 'PB') },
    ],
    // Book value is a balance, not a flow: it does not pass through zero
    // between quarters, so this corridor stays readable on the companies
    // whose P/E band is too wide to tell anything.
    // Defter değeri bir akış değil bakiye: çeyrekler arasında sıfırın içinden
    // geçmiyor, bu yüzden F/K bandı hiçbir şey söyleyemeyecek kadar geniş olan
    // şirketlerde bu koridor okunur kalıyor.
    priceLinesFrom: (extras) => {
      const band = extras?.pbBand;
      if (!band?.supported) return [];
      return [
        { price: band.p75, color: '#64748b', lineStyle: 1, lineWidth: 1, title: '75%' },
        { price: band.median, color: '#64748b', lineStyle: 2, lineWidth: 1, title: '50%' },
        { price: band.p25, color: '#64748b', lineStyle: 1, lineWidth: 1, title: '25%' },
      ];
    },
    priceLineTargetKey: 'pb',
  },
];

// rsiDiv has no pane of its own; it draws inside the RSI pane.
// rsiDiv'in kendi paneli yok; RSI panelinin içine çizer.
const TOGGLE_GROUPS = [
  ...OVERLAY_GROUPS,
  ...DEDICATED_GROUPS.flatMap((g) => (g.id === 'rsi' ? [{ id: 'rsi' }, { id: 'rsiDiv' }] : [{ id: g.id }])),
];

// Indicators that answer each other, as named sets. A preset is nothing new
// underneath — it flips the same toggles the checkboxes do, so one press turns
// its members on, a second turns those same members off, and whatever else is
// open stays open.
// Birbirini cevaplayan göstergeler, isimli kümeler hâlinde. Hazır düzen altta
// yeni bir şey değil — kutucukların çevirdiği düğmeleri çeviriyor; bir basış
// üyelerini açıyor, ikincisi aynı üyeleri kapatıyor, açık olan başka ne varsa
// yerinde kalıyor.
const PRESETS = [
  { id: 'momentum', groups: ['rsi', 'macd', 'volume'] },
  { id: 'trend', groups: ['ma', 'supertrend', 'adx'] },
  { id: 'volatility', groups: ['bb', 'atr'] },
  { id: 'valuation', groups: ['pe', 'pb', 'earnings'] },
];

// The swatch beside each name in the on-screen list, so a row can be matched
// to the line it drew. Groups that draw no line of their own (markers, zones)
// take a neutral swatch.
// Ekranda listesindeki her adın yanındaki renk, satırın çizdiği çizgiyle
// eşleşebilsin diye. Kendi çizgisi olmayan gruplar (işaretler, bölgeler) nötr
// renk alıyor.
const GROUP_COLORS = {
  ma: '#2a78d6',
  maCross: '#eda100',
  bb: 'rgba(150,150,150,0.7)',
  vwap: '#a259d9',
  supertrend: '#26a69a',
  volume: '#5a6472',
  rsi: '#a67bd6',
  rsiDiv: '#3ddc84',
  macd: '#2a78d6',
  stoch: '#eda100',
  adx: '#52514e',
  atr: '#d9822b',
  obv: '#3d8c5f',
  pe: '#c2410c',
  pb: '#7c3aed',
};
const NEUTRAL_SWATCH = 'var(--text-dim)';

// Groups that need a company behind the symbol: earnings dates and the KAP
// disclosures that explain a move, and the two valuation panes. An index has
// none of them, so on an index they leave the panel rather than sit there as
// switches that draw nothing.
// Sembolün arkasında şirket gerektiren gruplar: bilanço tarihleri, bir
// hareketi açıklayan KAP bildirimleri ve iki değerleme paneli. Endeksin
// hiçbiri yok; bu yüzden endekste hiçbir şey çizmeyen düğmeler olarak
// durmak yerine panelden çıkıyorlar.
const STOCK_ONLY_GROUPS = ['pe', 'pb', 'earnings', 'moves'];

// The visibility map a symbol of this kind can actually honour. The chart is
// built from this rather than from the raw map: an index built from the raw
// one would open a P/E pane that no series ever draws into, and the switch
// that would close it is not in the index's list.
// Bu türden bir sembolün gerçekten yerine getirebileceği görünürlük
// haritası. Grafik ham haritadan değil bundan kuruluyor: ham haritadan kurulan
// bir endeks, hiçbir serinin çizmediği bir F/K paneli açardı ve onu
// kapatacak düğme endeksin listesinde yok.
function visibilityFor(kind, vis) {
  if (kind !== 'index') return vis;
  const next = { ...vis };
  STOCK_ONLY_GROUPS.forEach((id) => {
    next[id] = false;
  });
  return next;
}

const OTHER_TOOL_IDS = ['srZones', 'autoFib', 'costProfile', 'earnings', 'moves', 'anchors'];
const PANEL_SECTIONS = [
  { titleKey: 'sectionIndicators', groups: TOGGLE_GROUPS.filter((g) => !OTHER_TOOL_IDS.includes(g.id)) },
  { titleKey: 'sectionOther', groups: TOGGLE_GROUPS.filter((g) => OTHER_TOOL_IDS.includes(g.id)) },
];

const DRAWING_TOOLS = [
  { id: 'horizontal', clicksNeeded: 1, key: 'H' },
  { id: 'trendline', clicksNeeded: 2, key: 'T' },
  { id: 'rectangle', clicksNeeded: 2, key: 'R' },
  { id: 'fib', clicksNeeded: 2, key: 'F' },
  { id: 'pattern', clicksNeeded: 2, key: 'P' },
];

const TWO_POINT_TOOLS = ['trendline', 'rectangle', 'fib', 'pattern'];
const TOOL_ICONS = {
  horizontal: HorizontalLineIcon,
  trendline: TrendLineIcon,
  rectangle: RectangleIcon,
  fib: FibonacciIcon,
  pattern: PatternIcon,
};
// Pattern search has no primitive of its own; it borrows the rectangle to show
// the span being searched.
// Formasyon aramasının kendi şekli yok; aranan aralığı göstermek için
// dikdörtgeni ödünç alıyor.
const TWO_POINT_PRIMITIVES = {
  trendline: TrendLinePrimitive,
  rectangle: RectanglePrimitive,
  fib: FibonacciPrimitive,
  pattern: RectanglePrimitive,
};

// Four tabs, not six: Scan holds what you use to find a symbol (volume scan,
// pattern search, the anchor widgets), Context holds what explains the one in
// front of you (disclosures, reaction profile, sector heat). The rail's icon
// order, and the 1-4 keys, are this array's order.
// Altı değil dört sekme: Tara sembol bulmak için kullandıklarını (hacim
// taraması, formasyon araması, çıpa widget'ları), Bağlam önündekini açıklayanı
// (bildirimler, tepki profili, sektör ısısı) tutuyor. Şeritteki ikon sırası ve
// 1-4 tuşları bu dizinin sırası.
const SIDEBAR_TABS = [
  { id: 'indicators', labelKey: 'tabIndicators', Icon: IndicatorIcon },
  { id: 'scan', labelKey: 'tabScan', Icon: ScanIcon },
  { id: 'context', labelKey: 'tabContext', Icon: ContextIcon },
  { id: 'notes', labelKey: 'tabNotes', Icon: NotesIcon },
];
const SIDEBAR_STORAGE_KEY = 'stc.sidebar';

// The rail remembers only two things: which tab was last open, and whether the
// panel is pinned. Pinned means the app starts with the panel open; unpinned
// means it starts as the closed rail, which is the point of the whole move.
// Şerit yalnız iki şeyi hatırlıyor: en son hangi sekme açıktı ve panel
// sabitlenmiş mi. Sabitli, uygulamanın panel açık başlaması demek; sabitsiz,
// kapalı şeritle başlaması demek ki bu hamlenin bütün amacı o.
function loadSidebarPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_STORAGE_KEY));
    const tab = SIDEBAR_TABS.some((t) => t.id === saved?.tab) ? saved.tab : 'indicators';
    return { tab, pinned: saved?.pinned === true };
  } catch {
    return { tab: 'indicators', pinned: false };
  }
}

function saveSidebarPrefs(prefs) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable
  }
}
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

async function fetchSwing(symbol) {
  const url = `${API_BASE}/api/swing/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCostProfile(symbol) {
  const url = `${API_BASE}/api/cost-profile/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRelativeStrength(symbol) {
  const url = `${API_BASE}/api/relative-strength/${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBand(symbol, kind) {
  const url = `${API_BASE}/api/${kind}-band/${symbol}`;
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
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
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

// One line in the header: how the symbol did against its sector's peer median
// and against XU100 over a month, with the other three stretches in the tooltip.
// Başlıkta tek satır: hissenin bir ayda sektör emsal medyanına ve XU100'e göre
// durumu; diğer üç dönem ipucunda.
function RelativeStrengthBadge({ data, str }) {
  const periods = data?.periods ?? {};
  const shown = periods['1m'] ?? periods['1w'] ?? periods['3m'] ?? periods.ytd;
  if (!shown) return null;
  const key = periods['1m'] ? '1m' : periods['1w'] ? '1w' : periods['3m'] ? '3m' : 'ytd';

  // A sector too thin to take a median reads as a dash, not as "-%".
  // Medyan alınamayacak kadar ince sektör "-%" değil, tire olarak okunuyor.
  const pct = (value) => (value == null ? '–' : `${signed(value, 1)}%`);

  const tooltip = [
    shown.sector == null
      ? str.rsThinSector
      : str.rsSectorHead(data.sector ?? '-', shown.peers),
    ...Object.entries(periods).map(([k, p]) =>
      str.rsRow(str.rsPeriods[k], pct(p.vsSector), pct(p.vsIndex))
    ),
  ].join('\n');

  const tone = (value) => (value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--up)' : 'var(--down)');

  return (
    <div className="stc-rs" title={tooltip}>
      <span className="stc-rs-period">{str.rsPeriods[key]}</span>
      <span>
        {str.rsPeers} <b style={{ color: tone(shown.vsSector) }}>{pct(shown.vsSector)}</b>
      </span>
      <span>
        {str.rsIndexName} <b style={{ color: tone(shown.vsIndex) }}>{pct(shown.vsIndex)}</b>
      </span>
    </div>
  );
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

function applyCostProfile(series, primitiveRef, profile, visible, str) {
  if (!series) return;
  if (primitiveRef.current) {
    series.detachPrimitive(primitiveRef.current);
    primitiveRef.current = null;
  }
  if (!visible || !profile?.supported) return;

  const primitive = new CostProfilePrimitive(profile, { label: str.costProfileLabel(profile.inProfitPct) });
  series.attachPrimitive(primitive);
  primitiveRef.current = primitive;
  primitive.requestRedraw();
}

// The retracement over the swing the backend found. Drawn, not drawable: it
// has no handles and is not in drawingsRef, so Del and the cursor leave it
// alone and it is replaced wholesale when the symbol changes.
// Backend'in bulduğu salınımın üzerindeki düzeltme. Çizilen bir şey, çizilebilir
// değil: tutamağı yok ve drawingsRef'te durmuyor, yani Del ve imleç ona
// dokunmuyor, sembol değişince toptan yenileniyor.
function applyAutoFib(series, primitiveRef, swing, visible) {
  if (!series) return;
  if (primitiveRef.current) {
    series.detachPrimitive(primitiveRef.current);
    primitiveRef.current = null;
  }
  if (!visible || !swing?.supported) return;

  const primitive = new FibonacciPrimitive(
    { time: swing.to.date, price: swing.to.price },
    { time: swing.from.date, price: swing.from.price },
    { color: colors().accent },
  );
  series.attachPrimitive(primitive);
  primitive.requestRedraw();
  primitiveRef.current = primitive;
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
function rebuildDedicatedPanes(chart, seriesMap, currentVisibility, extras) {
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

    const priceLines = [...(group.priceLines ?? []), ...(group.priceLinesFrom?.(extras) ?? [])];
    const marks = priceLines.map((line) => line.price);

    // The pane has to scale to its reference lines as well as its own line.
    // Without this a symbol sitting near the bottom of its own history
    // pushes the median and the upper quartile off the top — and being far
    // from them is exactly what the reader came for. THYAO's P/B at the 7th
    // percentile showed the 25% line and nothing else. It goes in at series
    // creation: the provider is read when the series is built, so applying
    // it afterwards leaves the old scale in place.
    // Panelin kendi çizgisi kadar referans çizgilerine de ölçeklenmesi
    // gerekiyor. Bu olmadan kendi geçmişinin dibine yakın duran sembol
    // ortancayı ve üst çeyrekliği yukarıdan taşırıyor — oysa onlardan uzak
    // olması okurun görmeye geldiği şeyin kendisi. THYAO'nun %7'lik dilimdeki
    // PD/DD'sinde %25 çizgisinden başkası görünmüyordu. Seri kurulurken
    // veriliyor: sağlayıcı seri inşa edilirken okunuyor, sonradan uygulamak
    // eski ölçeği yerinde bırakıyor.
    const holdMarks = (key) => (marks.length && key === group.priceLineTargetKey
      ? {
          autoscaleInfoProvider: (original) => {
            const base = original();
            const range = base?.priceRange;
            return {
              ...(base ?? {}),
              priceRange: {
                minValue: Math.min(...marks, range?.minValue ?? Infinity),
                maxValue: Math.max(...marks, range?.maxValue ?? -Infinity),
              },
            };
          },
        }
      : {});

    group.series.forEach(({ key, type, options, visibleWhen }) => {
      const visible = visibleWhen ? Boolean(currentVisibility[visibleWhen]) : true;
      seriesMap[key] = chart.addSeries(type, { ...options, visible, ...holdMarks(key) }, nextIndex);
    });
    chart.panes()[nextIndex].setStretchFactor(group.stretch);

    if (priceLines.length) {
      const target = seriesMap[group.priceLineTargetKey];
      priceLines.forEach((line) => target.createPriceLine(line));
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
  const sidebarPrefs = useRef(loadSidebarPrefs());
  const [sidebarOpen, setSidebarOpen] = useState(sidebarPrefs.current.pinned);
  const [sidebarPinned, setSidebarPinned] = useState(sidebarPrefs.current.pinned);
  const [sidebarTab, setSidebarTab] = useState(sidebarPrefs.current.tab);
  const [presetNotesOpen, setPresetNotesOpen] = useState(false);
  // The checkbox wall, folded away by default: the presets and what is on
  // screen are the first layer, the full list is the second.
  // Kutucuk duvarı, varsayılan olarak katlanmış: hazır düzenler ve ekranda
  // olanlar birinci katman, tam liste ikinci.
  const [allToggles, setAllToggles] = useState(false);
  const [quoteDetailOpen, setQuoteDetailOpen] = useState(false);
  const [barMenuOpen, setBarMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const barMenuRef = useRef(null);
  const shortcutsRef = useRef(null);
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

  const peBandRef = useRef(null);
  const pbBandRef = useRef(null);
  // What the dedicated panes read their flat percentile lines from.
  // Panellerin düz yüzdelik çizgilerini okuduğu yer.
  const bandExtras = () => ({ peBand: peBandRef.current, pbBand: pbBandRef.current });
  const swingRef = useRef(null);
  const autoFibRef = useRef(null);
  const costProfileRef = useRef(null);
  const costProfilePrimitiveRef = useRef(null);
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
  const [relStrength, setRelStrength] = useState(null);

  const [symbol, setSymbol] = useState('THYAO');
  const symbolInputRef = useRef(null);
  // What is loaded: a stock or one of the indices. Null until the symbol
  // list arrives, which is why the stock-only parts are keyed off `isIndex`
  // being true rather than off `symbolKind` being "stock".
  // Yüklü olan şey: hisse mi, endekslerden biri mi. Sembol listesi gelene
  // kadar null; yalnız hisseye ait kısımlar bu yüzden `symbolKind`'ın
  // "stock" olmasına değil, `isIndex`'in doğru olmasına bağlı.
  const symbolKind = useSymbolKind(symbol);
  const symbolName = useSymbolName(symbol);
  const isIndex = symbolKind === 'index';

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

  // What this symbol has to show. On an index the stock-only groups are not
  // greyed out but gone, and so is the set built out of them — a switch that
  // can only disappoint is worse than no switch.
  // Bu sembolün gösterecek olduğu şeyler. Endekste yalnız hisseye ait gruplar
  // soluk değil, yok; onlardan kurulu hazır düzen de yok — ancak hayal
  // kırıklığı verebilecek bir düğme, hiç düğme olmamasından kötü.
  const availableGroups = isIndex
    ? TOGGLE_GROUPS.filter((g) => !STOCK_ONLY_GROUPS.includes(g.id))
    : TOGGLE_GROUPS;
  const availablePresets = isIndex
    ? PRESETS.filter((preset) => !preset.groups.some((id) => STOCK_ONLY_GROUPS.includes(id)))
    : PRESETS;
  const panelSections = PANEL_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups.filter((g) => availableGroups.some((a) => a.id === g.id)),
  }));

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  // The keydown listener is installed once, so the 1-4 keys read the panel's
  // state through refs rather than a stale closure.
  // Tuş dinleyicisi bir kez kuruluyor; 1-4 tuşları panelin durumunu eski bir
  // closure'dan değil ref'lerden okuyor.
  const sidebarOpenRef = useRef(sidebarOpen);
  const sidebarTabRef = useRef(sidebarTab);
  const sidebarPinnedRef = useRef(sidebarPinned);
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
    sidebarTabRef.current = sidebarTab;
    sidebarPinnedRef.current = sidebarPinned;
  }, [sidebarOpen, sidebarTab, sidebarPinned]);

  useEffect(() => {
    const id = setInterval(() => setSession(bistSession()), 30000);
    return () => clearInterval(id);
  }, []);

  // A pointer press outside an open popover closes it.
  // Açık bir açılır kutunun dışına basmak onu kapatıyor.
  useEffect(() => {
    if (!barMenuOpen && !shortcutsOpen) return undefined;
    function handlePointerDown(e) {
      if (barMenuOpen && !barMenuRef.current?.contains(e.target)) setBarMenuOpen(false);
      if (shortcutsOpen && !shortcutsRef.current?.contains(e.target)) setShortcutsOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [barMenuOpen, shortcutsOpen]);

  // Clicking something on the chart opens the panel on the tab that explains
  // it, whether the panel was open or not.
  // Grafikte bir şeye tıklamak, paneli onu açıklayan sekmede açıyor; panel
  // açık mıydı kapalı mıydı fark etmiyor.
  function openSidebarTab(tab) {
    setSidebarTab(tab);
    setSidebarOpen(true);
    saveSidebarPrefs({ tab, pinned: sidebarPinnedRef.current });
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

    if (groupId === 'autoFib') {
      applyAutoFib(seriesMapRef.current.candle, autoFibRef, swingRef.current, nextVisible);
      return;
    }

    if (groupId === 'costProfile') {
      applyCostProfile(seriesMapRef.current.candle, costProfilePrimitiveRef, costProfileRef.current, nextVisible, STRINGS[langRef.current]);
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
        rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility, bandExtras());
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
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility, bandExtras());
      applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);
      renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    } else {
      const group = OVERLAY_GROUPS.find((g) => g.id === groupId);
      group.keys.forEach((key) => {
        seriesMapRef.current[key]?.applyOptions({ visible: nextVisible });
      });
    }
  }

  // Moves every group to the state the map asks for, whatever changed. The
  // per-group branches in handleToggle are for a single switch; this is the
  // path for anything that flips several at once.
  // Her grubu haritanın istediği hâle getirir, ne değişmiş olursa olsun.
  // handleToggle'daki grup bazlı dallar tek bir düğme için; aynı anda birkaçını
  // çeviren her şeyin yolu burası.
  function applyVisibility(newVisibility) {
    setVisibility(newVisibility);

    OVERLAY_GROUPS.forEach((group) => {
      group.keys.forEach((key) => {
        seriesMapRef.current[key]?.applyOptions({ visible: newVisibility[group.id] });
      });
    });
    applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, newVisibility.srZones);
    applyAutoFib(seriesMapRef.current.candle, autoFibRef, swingRef.current, newVisibility.autoFib);
    applyCostProfile(seriesMapRef.current.candle, costProfilePrimitiveRef, costProfileRef.current, newVisibility.costProfile, STRINGS[langRef.current]);
    anchorsVisibleRef.current = newVisibility.anchors;
    applyAnchors(seriesMapRef.current.candle, anchorLinesRef, anchorsRef.current, newVisibility.anchors, STRINGS[langRef.current]);
    setMaVisible(newVisibility.ma);
    earningsVisibleRef.current = newVisibility.earnings;
    movesVisibleRef.current = newVisibility.moves;
    crossVisibleRef.current = newVisibility.maCross;
    refreshMarkers();
    if (!newVisibility.earnings) setEarningsTip(null);
    if (!newVisibility.moves) setMoveDetail(null);

    const chart = chartRef.current;
    if (chart) {
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility, bandExtras());
      applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);
      renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    }
  }

  function handleToggleAll() {
    const target = !availableGroups.every((g) => visibility[g.id]);
    const next = { ...visibility };
    availableGroups.forEach((g) => {
      next[g.id] = target;
    });
    applyVisibility(next);
  }

  function handlePreset(preset) {
    const target = !preset.groups.every((id) => visibility[id]);
    const next = { ...visibility };
    preset.groups.forEach((id) => {
      next[id] = target;
    });
    applyVisibility(next);
  }

  // The rail: pressing the tab already open closes the panel, pressing another
  // leaves it open and only swaps the content, so switching tabs is never a
  // close-then-open.
  // Şerit: açık olan sekmeye basmak paneli kapatır, başkasına basmak paneli
  // açık bırakıp yalnız içeriği değiştirir; sekme değiştirmek asla kapat-aç
  // olmuyor.
  function handleRailTab(id) {
    const closing = sidebarOpenRef.current && sidebarTabRef.current === id;
    setSidebarOpen(!closing);
    setSidebarTab(id);
    saveSidebarPrefs({ tab: id, pinned: sidebarPinnedRef.current });
  }

  function handleTogglePin() {
    const pinned = !sidebarPinnedRef.current;
    setSidebarPinned(pinned);
    saveSidebarPrefs({ tab: sidebarTabRef.current, pinned });
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
          openSidebarTab('context');
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

    const primitive = new TWO_POINT_PRIMITIVES[tool](p1, p2);
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
    openSidebarTab('scan');
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
      const PrimitiveClass = TWO_POINT_PRIMITIVES[tool];
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
        } else if (selectedDrawingRef.current) {
          clearSelection();
        } else {
          // Nothing in hand and nothing selected: Esc is the panel's.
          // Elde ve seçili bir şey yokken Esc panelin.
          setSidebarOpen(false);
        }
        return;
      }
      if (isTyping()) return;

      // 1-4 open the rail's tabs, in the rail's own order.
      // 1-4 şeridin sekmelerini, şeridin sırasıyla açıyor.
      const railIndex = Number(e.key) - 1;
      if (Number.isInteger(railIndex) && railIndex >= 0 && railIndex < SIDEBAR_TABS.length) {
        e.preventDefault();
        handleRailTab(SIDEBAR_TABS[railIndex].id);
        return;
      }

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
        const [peData, pbData, profileData, rsData] = await Promise.all([
          fetchBand(symbol, 'pe').catch(() => null),
          fetchBand(symbol, 'pb').catch(() => null),
          fetchCostProfile(symbol).catch(() => null),
          fetchRelativeStrength(symbol).catch(() => null),
        ]);
        setRelStrength(rsData?.supported ? rsData : null);
        costProfileRef.current = profileData;
        if (cancelled) return;
        peBandRef.current = peData;
        pbBandRef.current = pbData;
        const swingData = await fetchSwing(symbol).catch(() => null);
        if (cancelled) return;
        swingRef.current = swingData;

        const themeOptions = chartThemeOptions(colors());
        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          ...themeOptions,
          crosshair: { ...themeOptions.crosshair, mode: CrosshairMode.Normal },
          localization: { locale: STRINGS[langRef.current].locale },
        });
        chartRef.current = chart;

        const shown = visibilityFor(symbolKind, visibility);
        PANE0_SERIES.forEach(({ key, type, options }) => {
          const group = OVERLAY_GROUPS.find((g) => g.keys.includes(key));
          const visible = group ? shown[group.id] : true;
          seriesMapRef.current[key] = chart.addSeries(type, { ...options, visible }, 0);
        });
        syncMaSeries(chart, seriesMapRef.current, maConfigRef.current, shown.ma, []);
        chart.panes()[0].setStretchFactor(MAIN_PANE_STRETCH);
        applyChartTheme(chart, seriesMapRef.current);

        rebuildDedicatedPanes(chart, seriesMapRef.current, shown, bandExtras());
        applySeriesTitles(seriesMapRef.current, STRINGS[langRef.current].seriesTitles);

        loadedData = data;
        loadedDataRef.current = loadedData;
        setQuote(buildQuote(data));
        setUpdatedAt(new Date());
        renderAllSeries(seriesMapRef.current, loadedData);
        applySrZones(seriesMapRef.current.candle, srPrimitivesRef, srZonesRef.current, shown.srZones);
        applyAutoFib(seriesMapRef.current.candle, autoFibRef, swingRef.current, shown.autoFib);
        applyCostProfile(seriesMapRef.current.candle, costProfilePrimitiveRef, costProfileRef.current, shown.costProfile, STRINGS[langRef.current]);
        earningsMarkersRef.current = createSeriesMarkers(seriesMapRef.current.candle, []);
        earningsVisibleRef.current = shown.earnings;
        movesVisibleRef.current = shown.moves;
        anchorsVisibleRef.current = shown.anchors;
        crossVisibleRef.current = shown.maCross;
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
      setRelStrength(null);
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
    // The histogram reads the palette as it paints, so it is rebuilt with
    // the rest rather than left holding the old theme's tints.
    // Histogram paletini boyarken okuyor, bu yüzden eski temanın tonlarıyla
    // bırakılmak yerine diğerleriyle birlikte yeniden kuruluyor.
    applyCostProfile(seriesMapRef.current.candle, costProfilePrimitiveRef, costProfileRef.current, visibility.costProfile, STRINGS[langRef.current]);
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

  // An index loaded with the P/E pane open would leave an empty pane behind a
  // switch that is no longer in the list, so the stock-only layers come off
  // as the symbol changes kind.
  // F/K paneli açıkken endeks yüklenirse, listede artık olmayan bir düğmenin
  // arkasında boş bir panel kalırdı; bu yüzden sembolün türü değişince yalnız
  // hisseye ait katmanlar iniyor.
  useEffect(() => {
    if (!isIndex || !STOCK_ONLY_GROUPS.some((id) => visibility[id])) return;
    applyVisibility(visibilityFor(symbolKind, visibility));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIndex, visibility]);

  // The statements view has nothing to show for an index, so loading one
  // while it is open comes back to the chart.
  // Mali tablolar görünümünün endekste gösterecek bir şeyi yok; o açıkken
  // endeks yüklenirse grafiğe dönülüyor.
  useEffect(() => {
    if (isIndex && view === 'fundamentals') setView('chart');
  }, [isIndex, view]);

  const allVisible = availableGroups.every((g) => visibility[g.id]);
  // Notes for the sets the reader turned on; with everything on, nothing was chosen.
  // Okurun açtığı düzenlerin notları; her şey açıkken bir seçim yapılmamış olur.
  const activePresets = allVisible
    ? []
    : availablePresets.filter((preset) => preset.groups.every((id) => visibility[id]));
  const canExtend = selectedDrawing && typeof selectedDrawing.getExtend === 'function';
  const activeSidebarTab = SIDEBAR_TABS.find((tab) => tab.id === sidebarTab) ?? SIDEBAR_TABS[0];
  const visibleGroups = TOGGLE_GROUPS.filter((g) => visibility[g.id]);
  const visibleCount = visibleGroups.length;

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
          '--text-prose': t.textProse,
          '--text-faint': t.textFaint,
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
            font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif;
            font-variant-numeric: tabular-nums;
            color: var(--text);
          }
          /* Scrollbars: the platform's are a wide light slab that reads as
             part of the operating system, not of the app. These are a thin
             bar in the app's own borders, with no track, no arrows and no
             corner square, so a scrolling panel shows a line rather than a
             second frame.
             Firefox gets the same two colours through its own property; it
             has no track, arrow or corner rule to set. */
          /* Kaydırma çubukları: platformunki geniş ve açık bir levha,
             uygulamanın değil işletim sisteminin parçası gibi duruyor.
             Buradakiler uygulamanın kendi kenarlık renginde ince bir çubuk;
             yolu, okları ve köşe karesi yok, böylece kayan panel ikinci bir
             çerçeve değil bir çizgi gösteriyor.
             Firefox aynı iki rengi kendi özelliğinden alıyor; onda yol, ok ya
             da köşe kuralı yok. */
          /* Only where the pseudo-elements below do not exist, i.e. Firefox.
             Chrome drops every ::-webkit-scrollbar rule the moment one of
             these standard properties is set, arrows included, so the two
             cannot be given to the same browser. */
          /* Yalnız aşağıdaki sözde öğelerin bulunmadığı yerde, yani
             Firefox'ta. Chrome, bu standart özelliklerden biri verilir
             verilmez bütün ::-webkit-scrollbar kurallarını düşürüyor, oklar
             dahil; bu yüzden ikisi aynı tarayıcıya verilemiyor. */
          @supports not selector(::-webkit-scrollbar) {
            .stc-root * {
              scrollbar-width: thin;
              scrollbar-color: var(--separator-hover) transparent;
            }
          }
          .stc-root ::-webkit-scrollbar {
            width: 9px;
            height: 9px;
          }
          .stc-root ::-webkit-scrollbar-track,
          .stc-root ::-webkit-scrollbar-corner {
            background: transparent;
          }
          .stc-root ::-webkit-scrollbar-thumb {
            background: var(--separator-hover);
            border-radius: 3px;
            /* Drawn inside a transparent border so the bar sits off the edge
               and does not touch the content it scrolls. */
            /* Saydam bir kenarlığın içine çiziliyor ki çubuk kenardan ayrı
               dursun ve kaydırdığı içeriğe değmesin. */
            border: 2px solid transparent;
            background-clip: content-box;
          }
          .stc-root ::-webkit-scrollbar-thumb:hover {
            background: var(--text-dim);
            background-clip: content-box;
          }
          .stc-root ::-webkit-scrollbar-button {
            display: none;
          }
          /* Sentence blocks: one weight, one line-height, one colour, so a
             paragraph reads the same wherever it sits. */
          /* Cümle blokları: tek ağırlık, tek satır yüksekliği, tek renk; ki
             paragraf nerede durursa durur aynı okunsun. */
          .stc-prose {
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-prose);
          }
          .stc-prose b, .stc-prose strong {
            font-weight: 600;
            color: var(--text-strong);
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
            font-weight: 600;
            font-size: 15px;
            letter-spacing: 0.02em;
            color: var(--text-strong);
            margin: 0;
            padding: 0 2px;
          }
          .stc-input {
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
          .stc-preset-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
          }
          .stc-preset {
            font-family: inherit;
            font-size: 12.5px;
            border: 1px solid var(--btn-border);
            background: var(--btn-bg);
            color: var(--text);
            border-radius: 3px;
            padding: 7px 8px;
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-preset:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-preset.is-active {
            border-color: var(--accent);
            color: var(--text-strong);
          }
          .stc-section-title {
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
            font-size: 10.5px;
            line-height: 15px;
            color: var(--text-dim);
            border: 1px solid var(--btn-border);
            border-radius: 2px;
            padding: 0 4px;
            pointer-events: none;
          }
          .stc-mono {
            font-family: 'JetBrains Mono', ui-monospace, monospace;
          }
          .stc-kind-tag {
            margin-left: auto;
            flex-shrink: 0;
            font-size: 10px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-dim);
            border: 1px solid var(--btn-border);
            border-radius: 2px;
            padding: 0 4px;
          }
          .stc-index-note {
            margin: 0;
            font-size: 12.5px;
            line-height: 1.6;
            color: var(--text-dim);
          }
          .stc-muted {
            margin: 0;
            font-size: 14px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-prose);
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
          .stc-chart-overlay {
            position: absolute;
            top: 10px;
            left: 14px;
            z-index: 15;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
            /* The wrapper is a hole the pointer falls through, so dragging the
               chart still works beside the block. */
            /* Sarmalayıcı, imlecin içinden düştüğü bir delik; böylece bloğun
               yanından grafiği sürüklemek çalışmayı sürdürüyor. */
            pointer-events: none;
          }
          .stc-chart-overlay > * {
            pointer-events: auto;
          }
          /* No plate under it: the figures themselves are what fades back,
             and come forward on hover or while the detail is open. */
          /* Altında levha yok: geri çekilen şey rakamların kendisi; imleç
             üstüne gelince ya da ayrıntı açıkken öne geliyorlar. */
          .stc-quote {
            display: flex;
            align-items: baseline;
            gap: 10px;
            white-space: nowrap;
            padding: 0;
            font-family: inherit;
            background: none;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.85;
            transition: opacity 120ms ease;
          }
          .stc-quote:hover,
          .stc-quote.is-open {
            opacity: 1;
          }
          .stc-quote:focus-visible {
            opacity: 1;
            outline: 2px solid var(--accent);
            outline-offset: 3px;
          }
          /* Opened on purpose, so it is read at full strength. */
          /* Bilerek açıldı, o yüzden tam güçte okunuyor. */
          .stc-quote-detail {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px 18px;
            max-width: 520px;
            padding: 0;
          }
          @media (prefers-reduced-motion: reduce) {
            .stc-quote { transition: none; }
          }
          .stc-quote-price {
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
          .stc-rs {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
            cursor: help;
          }
          .stc-rs b {
            font-family: 'JetBrains Mono', ui-monospace, monospace;
            font-weight: 500;
          }
          .stc-rs-period {
            font-weight: 600;
            letter-spacing: 0.06em;
            color: var(--text);
          }
          .stc-heat {
            display: flex;
            flex-direction: column;
            gap: 12px;
            font-size: 14px;
          }
          .stc-heat-table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            font-size: 12.5px;
          }
          .stc-heat-table col.stc-heat-period {
            width: 16%;
          }
          .stc-heat-table th {
            padding: 0 0 6px;
            text-align: right;
            font-weight: 500;
            color: var(--text-dim);
          }
          .stc-heat-table th:first-child {
            text-align: left;
            font-size: 11px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          .stc-heat-col {
            padding: 2px 5px;
            border: 1px solid transparent;
            border-radius: 3px;
            background: none;
            font: inherit;
            color: var(--text-dim);
            cursor: pointer;
          }
          .stc-heat-col:hover {
            color: var(--text);
            border-color: var(--btn-border);
          }
          .stc-heat-col.is-active {
            color: var(--text-strong);
            border-color: var(--accent);
          }
          .stc-heat-reference td {
            padding: 3px 6px;
            text-align: right;
            color: var(--text-dim);
            border-bottom: 1px solid var(--panel-border);
          }
          .stc-heat-reference td:first-child {
            text-align: left;
          }
          .stc-heat-row {
            cursor: pointer;
          }
          .stc-heat-row td {
            padding: 3px 6px;
            text-align: right;
            border-bottom: 1px solid var(--page-bg);
          }
          .stc-heat-row td:first-child {
            text-align: left;
            overflow-wrap: anywhere;
          }
          .stc-heat-row:hover .stc-heat-name {
            color: var(--text-strong);
          }
          .stc-heat-row.is-own .stc-heat-name {
            color: var(--accent);
          }
          .stc-heat-row.is-open .stc-heat-name {
            text-decoration: underline;
            text-underline-offset: 3px;
          }
          .stc-heat-cell {
            color: var(--text);
          }
          .stc-heat-members {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px;
            padding: 7px 6px 9px;
          }
          .stc-heat-member {
            display: flex;
            gap: 6px;
            padding: 3px 7px;
            border: 1px solid var(--btn-border);
            border-radius: 3px;
            background: var(--btn-bg);
            font: inherit;
            font-size: 12px;
            color: var(--text);
            cursor: pointer;
          }
          .stc-heat-member:hover {
            background: var(--btn-bg-hover);
          }
          .stc-heat-member.is-current {
            border-color: var(--accent);
          }
          .stc-heat-legend {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
          }
          .stc-heat-ramp {
            display: flex;
            flex-grow: 1;
            height: 10px;
            border: 1px solid var(--panel-border);
            border-radius: 2px;
            overflow: hidden;
          }
          .stc-heat-ramp i {
            flex: 1;
          }
          .stc-heat-foot {
            font-size: 12.5px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-prose);
            border-top: 1px solid var(--panel-border);
            padding-top: 10px;
          }
          .stc-reaction-row {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 8px 10px;
            border: 1px solid var(--panel-border);
            border-radius: 3px;
          }
          .stc-reaction-head {
            font-size: 11px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-dim);
          }
          .stc-preset-notes {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 10px;
            padding: 10px 11px;
            border: 1px solid var(--panel-border);
            border-radius: 3px;
            cursor: pointer;
          }
          .stc-preset-notes:hover {
            border-color: var(--separator-hover, var(--panel-border));
          }
          .stc-preset-notes:focus-visible {
            outline: 1px solid var(--accent);
            outline-offset: 1px;
          }
          /* Closed: each line keeps what fits the box and ends in an ellipsis. */
          /* Kapalı: her satır kutuya sığanı tutar, gerisi üç noktaya iner. */
          .stc-preset-notes.is-collapsed li,
          .stc-preset-notes.is-collapsed .is-disclaimer {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .stc-preset-note {
            margin: 0;
            font-size: 12.5px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-prose);
          }
          .stc-preset-note b {
            display: block;
            margin-bottom: 4px;
            color: var(--text-strong);
            font-weight: 600;
          }
          .stc-preset-note ul {
            margin: 0;
            padding-left: 15px;
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .stc-preset-note li::marker {
            color: var(--text-dim);
          }
          .stc-preset-note.is-disclaimer {
            padding-top: 8px;
            border-top: 1px solid var(--panel-border);
            opacity: 0.8;
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
          .stc-barmenu, .stc-shortcuts {
            position: relative;
            display: flex;
            align-items: center;
          }
          .stc-menu {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            z-index: 40;
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 180px;
            padding: 11px 12px;
            background: var(--panel-bg);
            border: 1px solid var(--btn-border);
            border-radius: 4px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
          }
          .stc-menu-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .stc-menu-label {
            font-size: 12.5px;
            color: var(--text-prose);
          }
          .stc-status-btn {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 3px;
            color: var(--text-dim);
            cursor: pointer;
          }
          .stc-status-btn:hover, .stc-status-btn.is-active {
            color: var(--text-strong);
          }
          .stc-status-btn:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
          }
          .stc-shortcuts-pop {
            position: absolute;
            bottom: calc(100% + 8px);
            right: 0;
            z-index: 40;
            min-width: 240px;
            padding: 11px 12px;
            font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif;
            background: var(--panel-bg);
            border: 1px solid var(--btn-border);
            border-radius: 4px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
            white-space: normal;
          }
          .stc-shortcut-row {
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 3px 0;
            font-size: 12.5px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-prose);
          }
          .stc-shortcut-row kbd {
            flex-shrink: 0;
            min-width: 62px;
            font-family: 'JetBrains Mono', ui-monospace, monospace;
            font-size: 11px;
            color: var(--text-strong);
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
          .stc-panel-head {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 4px;
            height: 38px;
            padding: 0 7px 0 12px;
            border-bottom: 1px solid var(--panel-border);
          }
          .stc-panel-head-title {
            flex-grow: 1;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: var(--text-strong);
          }
          .stc-panel-rule {
            border-top: 1px solid var(--panel-border);
            margin: 16px 0;
          }
          /* The closed panel: a 44px strip the chart does not have to share
             272px with. */
          /* Kapalı panel: grafiğin 272 px'i paylaşmak zorunda olmadığı 44
             px'lik şerit. */
          .stc-panel-rail {
            width: 44px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 8px 0;
            background: var(--panel-bg);
            border-left: 1px solid var(--panel-border);
          }
          .stc-rail-tab {
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 3px;
            background: transparent;
            color: var(--text-dim);
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-rail-tab:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-rail-tab.is-open {
            background: var(--accent-soft);
            border-color: var(--accent);
            color: var(--accent);
          }
          .stc-rail-tab:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: -2px;
          }
          .stc-rail-count {
            font-size: 10px;
            letter-spacing: 0.06em;
            color: var(--text-faint);
            cursor: default;
          }
          .stc-notes {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .stc-notes-symbol {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.06em;
            color: var(--text-strong);
          }
          .stc-notes-box {
            min-height: 180px;
            resize: vertical;
            padding: 10px 11px;
            font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif;
            font-size: 13.5px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-strong);
            background: var(--input-bg);
            border: 1px solid var(--btn-border);
            border-radius: 3px;
            outline: none;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          .stc-notes-box::placeholder {
            color: var(--text-faint);
          }
          .stc-notes-box:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-ring);
          }
          .stc-notes-status {
            min-height: 16px;
            font-size: 12px;
            color: var(--text-faint);
          }
          .stc-notes-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .stc-notes-other {
            display: flex;
            align-items: baseline;
            gap: 8px;
            padding: 7px 9px;
            font-family: inherit;
            text-align: left;
            background: var(--btn-bg);
            border: 1px solid var(--panel-border);
            border-radius: 3px;
            cursor: pointer;
            transition: background-color 120ms ease;
          }
          .stc-notes-other:hover {
            background: var(--btn-bg-hover);
          }
          .stc-notes-other:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
          }
          .stc-notes-other-symbol {
            flex-shrink: 0;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-strong);
          }
          /* One line of the note, cut where the row ends: enough to recognise
             which note it is without turning the list into a wall. */
          /* Notun bir satırı, satırın bittiği yerde kesiliyor: hangi not
             olduğunu tanımaya yeter, listeyi duvara çevirmez. */
          .stc-notes-other-body {
            flex-grow: 1;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            font-size: 12.5px;
            font-weight: 450;
            color: var(--text-prose);
          }
          .stc-notes-other-when {
            flex-shrink: 0;
            font-size: 11px;
            color: var(--text-faint);
          }
          .stc-onscreen {
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          .stc-onscreen-row {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 5px 6px 5px 9px;
            background: var(--btn-bg);
            border: 1px solid var(--panel-border);
            border-radius: 3px;
          }
          .stc-onscreen-swatch {
            width: 9px;
            height: 9px;
            flex-shrink: 0;
            border-radius: 2px;
          }
          .stc-onscreen-name {
            flex-grow: 1;
            font-size: 13.5px;
            color: var(--text-strong);
          }
          /* The second layer's lid. */
          /* İkinci katmanın kapağı. */
          .stc-fold {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            margin-top: 18px;
            padding: 9px 10px;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            text-align: left;
            color: var(--text);
            background: var(--btn-bg);
            border: 1px solid var(--btn-border);
            border-radius: 3px;
            cursor: pointer;
            transition: background-color 120ms ease, color 120ms ease;
          }
          .stc-fold:hover {
            background: var(--btn-bg-hover);
            color: var(--text-strong);
          }
          .stc-fold:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
          }
          .stc-fold-chevron {
            width: 0;
            height: 0;
            flex-shrink: 0;
            border-left: 4.5px solid currentColor;
            border-top: 3.5px solid transparent;
            border-bottom: 3.5px solid transparent;
            transition: transform 120ms ease;
          }
          .stc-fold-chevron.is-open {
            transform: rotate(90deg);
          }
          .stc-fold-body {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-top: 8px;
          }
          @media (prefers-reduced-motion: reduce) {
            .stc-fold-chevron { transition: none; }
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
            font-family: 'JetBrains Mono', ui-monospace, monospace;
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
            font-size: 12.5px;
            font-weight: 450;
            line-height: 1.68;
            color: var(--text-faint);
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
          .stc-rail-btn:focus-visible {
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

          <div
            className="stc-seg"
            role="group"
            aria-label={[str.viewChart, str.viewFundamentals, str.viewPortfolio].join(' / ')}
          >
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
              disabled={isIndex}
              title={isIndex ? str.indexNoStatements : undefined}
              onClick={() => setView('fundamentals')}
            >
              {str.viewFundamentals}
            </button>
            <button
              className={view === 'portfolio' ? 'is-active' : ''}
              aria-pressed={view === 'portfolio'}
              onClick={() => setView('portfolio')}
            >
              {str.viewPortfolio}
            </button>
          </div>
          <div className="stc-vrule" />

          <SymbolPicker symbol={symbol} onSelect={setSymbol} inputRef={symbolInputRef} />

          <div style={{ flexGrow: 1 }} />

          <span className="stc-session">
            <span className="stc-dot" style={{ background: session.open ? 'var(--up)' : 'var(--text-dim)' }} />
            {session.open ? str.sessionOpen(session.time) : str.sessionClosed(session.time)}
          </span>

          {/* Language and theme are set once and then left alone, so they sit
              behind a menu instead of holding a place in the bar. */}
          {/* Dil ve tema bir kez ayarlanıp bırakılıyor; bu yüzden barda yer
              tutmak yerine menünün arkasında duruyorlar. */}
          <div className="stc-barmenu" ref={barMenuRef}>
            <button
              className={`stc-icon-btn stc-bordered ${barMenuOpen ? 'is-active' : ''}`}
              onClick={() => setBarMenuOpen((open) => !open)}
              aria-expanded={barMenuOpen}
              aria-label={str.moreMenu}
              title={str.moreMenu}
            >
              <MoreIcon size={15} />
            </button>
            {barMenuOpen && (
              <div className="stc-menu" role="menu">
                <div className="stc-menu-row">
                  <span className="stc-menu-label">{str.language}</span>
                  <div className="stc-seg" role="group" aria-label={str.language}>
                    <button className={lang === 'en' ? 'is-active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
                      EN
                    </button>
                    <button className={lang === 'tr' ? 'is-active' : ''} aria-pressed={lang === 'tr'} onClick={() => setLang('tr')}>
                      TR
                    </button>
                  </div>
                </div>
                <div className="stc-menu-row">
                  <span className="stc-menu-label">{str.theme}</span>
                  <button
                    className="stc-icon-btn stc-bordered"
                    onClick={() => setDarkMode((d) => !d)}
                    aria-label={darkMode ? str.lightMode : str.darkMode}
                    title={darkMode ? str.lightMode : str.darkMode}
                  >
                    {darkMode ? <SunIcon size={15} /> : <MoonIcon size={15} />}
                  </button>
                </div>
              </div>
            )}
          </div>
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

            {/* The price sits on the chart it is drawn from, and is still the
                handle for the rest: open, high, low, volume, relative
                strength and the next statement date are in what it opens. */}
            {/* Fiyat, çizildiği grafiğin üstünde duruyor ve gerisinin kulbu
                olmayı sürdürüyor: açılış, yüksek, düşük, hacim, göreli güç ve
                sıradaki bilanço tarihi açtığı şeyin içinde. */}
            {quote && (
              <div className="stc-chart-overlay">
                <button
                  className={`stc-quote ${quoteDetailOpen ? 'is-open' : ''}`}
                  onClick={() => setQuoteDetailOpen((open) => !open)}
                  aria-expanded={quoteDetailOpen}
                  title={str.quoteDetailHint}
                >
                  <span className="stc-quote-price">{quote.close.toFixed(2)}</span>
                  <span
                    className="stc-mono"
                    style={{ fontSize: '13px', fontWeight: 500, color: (quote.change ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}
                  >
                    {signed(quote.change)}&nbsp;&nbsp;{signed(quote.changePct)}%
                  </span>
                </button>
                {quoteDetailOpen && (
                  <div className="stc-quote-detail">
                    <div className="stc-ohlc stc-mono">
                      <span>O <b>{quote.open.toFixed(2)}</b></span>
                      <span>H <b>{quote.high.toFixed(2)}</b></span>
                      <span>L <b>{quote.low.toFixed(2)}</b></span>
                      <span>V <b>{formatVolume(quote.volume)}</b></span>
                    </div>
                    {relStrength && <RelativeStrengthBadge data={relStrength} str={str} />}
                    {visibility.earnings && earningsNext && (
                      <span style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {str.nextEarnings(formatDateTR(earningsNext))}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

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
            <div className="stc-panel-head">
              <span className="stc-panel-head-title stc-mono">{str[activeSidebarTab.labelKey]}</span>
              <button
                className={`stc-icon-btn ${sidebarPinned ? 'is-active' : ''}`}
                onClick={handleTogglePin}
                aria-pressed={sidebarPinned}
                aria-label={str.pinPanel}
                title={str.pinPanel}
              >
                <PinIcon size={14} />
              </button>
              <button
                className="stc-icon-btn"
                onClick={() => setSidebarOpen(false)}
                aria-label={str.closePanel}
                title={str.closePanel}
              >
                <CloseIcon size={14} />
              </button>
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'indicators'}>
              {isIndex && <p className="stc-index-note">{str.indexLayersNote}</p>}
              <div className="stc-section-title">{str.sectionPresets}</div>
              <div className="stc-preset-grid">
                {availablePresets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`stc-preset ${preset.groups.every((id) => visibility[id]) ? 'is-active' : ''}`}
                    title={preset.groups.map((id) => str.groups[id]).join(' + ')}
                    onClick={() => handlePreset(preset)}
                  >
                    {str.presets[preset.id]}
                  </button>
                ))}
              </div>
              {activePresets.length > 0 && (
                <div
                  className={`stc-preset-notes ${presetNotesOpen ? 'is-open' : 'is-collapsed'}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={presetNotesOpen}
                  title={presetNotesOpen ? str.presetNotesCollapse : str.presetNotesExpand}
                  onClick={() => setPresetNotesOpen((open) => !open)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPresetNotesOpen((open) => !open);
                    }
                  }}
                >
                  {activePresets.map((preset) => (
                    <div key={preset.id} className="stc-preset-note">
                      <b>{str.presets[preset.id]}</b>
                      <ul>
                        {str.presetNotes[preset.id].map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="stc-preset-note is-disclaimer">{str.presetNotesDisclaimer}</p>
                </div>
              )}

              {/* First layer: the sets, and what they put on the chart. The
                  reader manages the chart from this list and never has to
                  find the matching checkbox below. */}
              {/* Birinci katman: düzenler ve grafiğe koydukları. Okur grafiği
                  bu listeden yönetiyor, aşağıdaki kutucuğu bulmak zorunda
                  kalmıyor. */}
              <div className="stc-section-title">{str.sectionOnScreen(visibleCount)}</div>
              {visibleCount === 0 ? (
                <p className="stc-muted" style={{ fontSize: '12.5px' }}>{str.onScreenEmpty}</p>
              ) : (
                <div className="stc-onscreen">
                  {visibleGroups.map((group) => (
                    <div key={group.id} className="stc-onscreen-row">
                      <span
                        className="stc-onscreen-swatch"
                        style={{ background: GROUP_COLORS[group.id] ?? NEUTRAL_SWATCH }}
                      />
                      <span className="stc-onscreen-name">{str.groups[group.id]}</span>
                      <button
                        className="stc-icon-btn"
                        style={{ width: '22px', height: '22px' }}
                        onClick={() => handleToggle(group.id)}
                        aria-label={str.removeFromChart(str.groups[group.id])}
                        title={str.removeFromChart(str.groups[group.id])}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {visibility.ma && <MaEditor config={maConfig} onChange={handleMaConfigChange} />}

              {/* Second layer: the whole list, folded away. */}
              {/* İkinci katman: tam liste, katlanmış. */}
              <button
                className="stc-fold"
                onClick={() => setAllToggles((open) => !open)}
                aria-expanded={allToggles}
              >
                <span className={`stc-fold-chevron ${allToggles ? 'is-open' : ''}`} aria-hidden="true" />
                {str.allIndicators(availableGroups.length)}
              </button>
              {allToggles && (
                <div className="stc-fold-body">
                  <button className="stc-toggle-all" onClick={handleToggleAll}>
                    {allVisible ? str.hideAll : str.showAll}
                  </button>
                  {panelSections.map((section) => (
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
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'scan'}>
              <VolumeScanWidget onSelectSymbol={handleSelectScanSymbol} />
              <div className="stc-panel-rule" />
              <PatternSearchWidget state={patternSearch} onClose={handleClosePatternSearch} />
              <div className="stc-panel-rule" />
              <AnchorsWidget data={anchorsData} />
              <div className="stc-panel-rule" />
              <AnchorScanWidget onSelectSymbol={handleSelectScanSymbol} />
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'context'}>
              {/* On an index the first two read a company's record, which
                  there is none of; the sector map is the market itself and
                  stays. */}
              {/* Endekste ilk ikisi şirketin siciline bakıyor, o da yok;
                  sektör haritası piyasanın kendisi, yerinde kalıyor. */}
              {isIndex ? (
                <p className="stc-index-note">{str.indexContextEmpty}</p>
              ) : (
                <>
                  <MoveReasonsWidget move={moveDetail} onClose={() => setMoveDetail(null)} />
                  <div className="stc-panel-rule" />
                  <ReactionProfileWidget symbol={symbol} />
                </>
              )}
              <div className="stc-panel-rule" />
              <SectorHeatWidget symbol={symbol} onSelectSymbol={handleSelectScanSymbol} />
            </div>

            <div className="stc-tabpanel" role="tabpanel" hidden={sidebarTab !== 'notes'}>
              <NotesPanel symbol={symbol} onSelectSymbol={handleSelectScanSymbol} />
            </div>
          </aside>

          <nav className="stc-panel-rail" aria-label={str.togglePanel}>
            {SIDEBAR_TABS.map((tab, i) => {
              const open = sidebarOpen && sidebarTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`stc-rail-tab ${open ? 'is-open' : ''}`}
                  onClick={() => handleRailTab(tab.id)}
                  aria-expanded={open}
                  aria-label={`${str[tab.labelKey]} (${i + 1})`}
                  title={`${str[tab.labelKey]} · ${i + 1}`}
                >
                  <tab.Icon size={16} />
                </button>
              );
            })}
            <div className="stc-rail-divider" />
            {/* The count stays readable with the panel shut, which is the
                point: you can see how much is on the chart without opening
                anything. */}
            {/* Sayı panel kapalıyken de okunur kalıyor, mesele bu: hiçbir şey
                açmadan grafikte ne kadar şey olduğunu görüyorsun. */}
            <span
              className="stc-rail-count stc-mono"
              title={str.openIndicators(visibleCount)}
              aria-label={str.openIndicators(visibleCount)}
            >
              {visibleCount}
            </span>
          </nav>
        </div>

        {view === 'fundamentals' && <FundamentalsView symbol={symbol} />}
        {view === 'portfolio' && <PortfolioView />}

        <footer className="stc-statusbar">
          <span>
            {symbol}
            {isIndex && symbolName ? ` · ${symbolName}` : ''} · 1D · BIST
          </span>
          {updatedAt && <span>{str.updated(formatClock(updatedAt))}</span>}
          <div style={{ flexGrow: 1 }} />
          {/* The shortcut line was permanent furniture for something read
              once; it now sits behind the "?". */}
          {/* Kısayol satırı bir kez okunan bir şey için kalıcı mobilyaydı;
              artık "?"nin arkasında duruyor. */}
          <div className="stc-shortcuts" ref={shortcutsRef}>
            <button
              className={`stc-status-btn ${shortcutsOpen ? 'is-active' : ''}`}
              onClick={() => setShortcutsOpen((open) => !open)}
              aria-expanded={shortcutsOpen}
              aria-label={str.shortcutsTitle}
              title={str.shortcutsTitle}
            >
              <HelpIcon size={13} />
            </button>
            {shortcutsOpen && (
              <div className="stc-shortcuts-pop" role="dialog" aria-label={str.shortcutsTitle}>
                <div className="stc-section-title" style={{ margin: '0 0 8px' }}>{str.shortcutsTitle}</div>
                {str.shortcuts.map((row) => (
                  <div key={row.keys} className="stc-shortcut-row">
                    <kbd>{row.keys}</kbd>
                    <span>{row.what}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span>{str.dataSources}</span>
        </footer>
      </div>
    </LangContext.Provider>
  );
}

export default App;