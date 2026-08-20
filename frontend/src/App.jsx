import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
} from 'lightweight-charts';
import { TrendLinePrimitive, RectanglePrimitive, HorizontalLinePrimitive } from './drawingTools.js';

const CHUNK_MONTHS = 6;
const EDGE_THRESHOLD = 10;
const MAIN_PANE_STRETCH = 3;

const THEME = {
  light: {
    pageBg: '#f5f6f8',
    panelBg: 'rgba(255, 255, 255, 0.72)',
    panelBorder: 'rgba(15, 23, 42, 0.08)',
    text: '#0f172a',
    textDim: '#1e293b',
    btnBg: 'rgba(15, 23, 42, 0.04)',
    btnBgHover: 'rgba(15, 23, 42, 0.09)',
    btnBorder: 'rgba(15, 23, 42, 0.1)',
    inputBg: 'rgba(255, 255, 255, 0.6)',
    accent: '#3e5c76',
    accentHover: '#33495e',
    accentRing: 'rgba(62, 92, 118, 0.15)',
    chartBg: '#ffffff',
    chartText: '#333333',
    gridColor: '#eeeeee',
    separator: '#787b86',
    separatorHover: 'rgba(120, 123, 134, 0.2)',
  },
  dark: {
    pageBg: '#0d1117',
    panelBg: 'rgba(22, 25, 32, 0.72)',
    panelBorder: 'rgba(255, 255, 255, 0.08)',
    text: '#e8eaed',
    textDim: '#c3c9d1',
    btnBg: 'rgba(255, 255, 255, 0.06)',
    btnBgHover: 'rgba(255, 255, 255, 0.12)',
    btnBorder: 'rgba(255, 255, 255, 0.12)',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    accent: '#5b7ea3',
    accentHover: '#6f93b6',
    accentRing: 'rgba(91, 126, 163, 0.25)',
    chartBg: '#0d1117',
    chartText: '#c3c9d1',
    gridColor: 'rgba(255, 255, 255, 0.06)',
    separator: 'rgba(255, 255, 255, 0.15)',
    separatorHover: 'rgba(255, 255, 255, 0.3)',
  },
};

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

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
    color: row.Close >= row.Open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
  }));
}

function macdHistData(rows) {
  return rows
    .filter((row) => row.MACD_Hist !== null && row.MACD_Hist !== undefined)
    .map((row) => ({
      time: dateOf(row),
      value: row.MACD_Hist,
      color: row.MACD_Hist >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)',
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

// Series that live directly on the main price pane (pane 0) — these never
// disappear, toggling them just flips `visible`, no pane management needed.
const PANE0_SERIES = [
  { key: 'candle', type: CandlestickSeries, options: {}, data: (rows) => rows.map(toCandleFormat) },
  { key: 'sma20', type: LineSeries, options: { color: '#eda100', lineWidth: 2, title: 'SMA20' }, data: (rows) => lineData(rows, 'SMA_20') },
  { key: 'ema12', type: LineSeries, options: { color: '#4a90d9', lineWidth: 1, title: 'EMA12' }, data: (rows) => lineData(rows, 'EMA_12') },
  { key: 'bbUpper', type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Upper' }, data: (rows) => lineData(rows, 'BB_Upper') },
  { key: 'bbMiddle', type: LineSeries, options: { color: 'rgba(150,150,150,0.4)', lineWidth: 1, lineStyle: 2, title: 'BB Middle' }, data: (rows) => lineData(rows, 'BB_Middle') },
  { key: 'bbLower', type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Lower' }, data: (rows) => lineData(rows, 'BB_Lower') },
  { key: 'vwap', type: LineSeries, options: { color: '#a259d9', lineWidth: 1, title: 'VWAP' }, data: (rows) => lineData(rows, 'VWAP') },
  { key: 'supertrendUp', type: LineSeries, options: { color: '#26a69a', lineWidth: 2, title: 'Supertrend' }, data: supertrendUpData },
  { key: 'supertrendDown', type: LineSeries, options: { color: '#ef5350', lineWidth: 2 }, data: supertrendDownData },
];

// Overlay toggle groups (share pane 0 with the candles — simple show/hide).
const OVERLAY_GROUPS = [
  { id: 'sma20', label: 'SMA 20', keys: ['sma20'] },
  { id: 'ema12', label: 'EMA 12', keys: ['ema12'] },
  { id: 'bb', label: 'Bollinger Bands', keys: ['bbUpper', 'bbMiddle', 'bbLower'] },
  { id: 'vwap', label: 'VWAP', keys: ['vwap'] },
  { id: 'supertrend', label: 'Supertrend', keys: ['supertrendUp', 'supertrendDown'] },
];

// Groups that get their OWN dedicated pane. This array's order is the fixed
// visual stacking order. When a group is hidden, its pane is fully removed
// (chart.removePane) rather than just shrunk — no dead space left behind.
// When any of these toggle, ALL currently-visible dedicated panes are torn
// down and rebuilt from scratch in this order, which keeps pane indices
// simple (always contiguous 1..N) instead of tracking shifting indices.
const DEDICATED_GROUPS = [
  {
    id: 'volume', label: 'Volume', stretch: 1,
    series: [{ key: 'volume', type: HistogramSeries, options: { priceFormat: { type: 'volume' } }, data: volumeData }],
  },
  {
    id: 'rsi', label: 'RSI', stretch: 1.2,
    series: [{ key: 'rsi', type: LineSeries, options: { color: '#a67bd6', lineWidth: 1.5, title: 'RSI14' }, data: (rows) => lineData(rows, 'RSI_14') }],
    priceLines: [
      { price: 70, color: '#e5484d', lineStyle: 2, lineWidth: 1, title: '70' },
      { price: 30, color: '#3ddc84', lineStyle: 2, lineWidth: 1, title: '30' },
    ],
    priceLineTargetKey: 'rsi',
  },
  {
    id: 'macd', label: 'MACD', stretch: 1.2,
    series: [
      { key: 'macd', type: LineSeries, options: { color: '#2a78d6', lineWidth: 1.5, title: 'MACD' }, data: (rows) => lineData(rows, 'MACD') },
      { key: 'macdSignal', type: LineSeries, options: { color: '#eda100', lineWidth: 1.5, title: 'Signal' }, data: (rows) => lineData(rows, 'MACD_Signal') },
      { key: 'macdHist', type: HistogramSeries, options: {}, data: macdHistData },
    ],
  },
  {
    id: 'stoch', label: 'Stochastic', stretch: 1.2,
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
    id: 'adx', label: 'ADX', stretch: 1,
    series: [{ key: 'adx', type: LineSeries, options: { color: '#52514e', lineWidth: 1.5, title: 'ADX14' }, data: (rows) => lineData(rows, 'ADX_14') }],
  },
  {
    id: 'atr', label: 'ATR', stretch: 1,
    series: [{ key: 'atr', type: LineSeries, options: { color: '#d9822b', lineWidth: 1.5, title: 'ATR14' }, data: (rows) => lineData(rows, 'ATR_14') }],
  },
  {
    id: 'obv', label: 'OBV', stretch: 1,
    series: [{ key: 'obv', type: LineSeries, options: { color: '#3d8c5f', lineWidth: 1.5, title: 'OBV' }, data: (rows) => lineData(rows, 'OBV') }],
  },
  {
    id: 'pe', label: 'P/E (F/K)', stretch: 1,
    series: [
      { key: 'pe', type: LineSeries, options: { color: '#c2410c', lineWidth: 1.5, title: 'P/E' }, data: (rows) => lineData(rows, 'PE') },
      { key: 'peYoy', type: LineSeries, options: { color: '#64748b', lineWidth: 1, lineStyle: 2, title: 'P/E (1y ago)' }, data: (rows) => lineData(rows, 'PE_PrevYear') },
    ],
  },
];

const TOGGLE_GROUPS = [
  ...OVERLAY_GROUPS,
  ...DEDICATED_GROUPS.map((g) => ({ id: g.id, label: g.label })),
];

const DRAWING_TOOLS = [
  { id: 'horizontal', label: 'Horizontal Line', clicksNeeded: 1 },
  { id: 'trendline', label: 'Trend Line', clicksNeeded: 2 },
  { id: 'rectangle', label: 'Rectangle', clicksNeeded: 2 },
];

async function fetchRange(symbol, start, end) {
  const toISO = (d) => d.toISOString().slice(0, 10);
  const url = `http://127.0.0.1:8000/api/price/${symbol}?start=${toISO(start)}&end=${toISO(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

// Populates every currently-existing series (pane 0 + whichever dedicated
// panes are currently mounted) with fresh data. Safe to call any time —
// series that don't currently exist are simply skipped (`?.`).
function renderAllSeries(seriesMap, loadedData) {
  PANE0_SERIES.forEach(({ key, data }) => {
    seriesMap[key]?.setData(data(loadedData));
  });
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

    group.series.forEach(({ key, type, options }) => {
      seriesMap[key] = chart.addSeries(type, options, nextIndex);
    });
    chart.panes()[nextIndex].setStretchFactor(group.stretch);

    if (group.priceLines) {
      const target = seriesMap[group.priceLineTargetKey];
      group.priceLines.forEach((line) => target.createPriceLine(line));
    }

    nextIndex += 1;
  });
}

function App() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
  const loadedDataRef = useRef([]);
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [visibility, setVisibility] = useState(
    () => Object.fromEntries(TOGGLE_GROUPS.map((g) => [g.id, true]))
  );

  const [symbol, setSymbol] = useState('THYAO');
  const [symbolInput, setSymbolInput] = useState('THYAO');

  const [activeTool, setActiveTool] = useState(null);
  const activeToolRef = useRef(null);
  const pendingPointRef = useRef(null);
  const drawingsRef = useRef([]);
  const previewPrimitiveRef = useRef(null);

  const [selectedDrawing, setSelectedDrawing] = useState(null);
  const selectedDrawingRef = useRef(null);
  const [selectedExtend, setSelectedExtend] = useState({ left: false, right: false });

  const t = darkMode ? THEME.dark : THEME.light;

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  function handleSymbolSubmit(e) {
    e.preventDefault();
    const trimmed = symbolInput.trim().toUpperCase();
    if (trimmed) setSymbol(trimmed);
  }

  function handleToggle(groupId) {
    const nextVisible = !visibility[groupId];
    const newVisibility = { ...visibility, [groupId]: nextVisible };
    setVisibility(newVisibility);

    const chart = chartRef.current;
    if (!chart) return;

    const isDedicated = DEDICATED_GROUPS.some((g) => g.id === groupId);
    if (isDedicated) {
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility);
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

    const chart = chartRef.current;
    if (chart) {
      rebuildDedicatedPanes(chart, seriesMapRef.current, newVisibility);
      renderAllSeries(seriesMapRef.current, loadedDataRef.current);
    }
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

    const primitive =
      tool === 'trendline' ? new TrendLinePrimitive(p1, p2) : new RectanglePrimitive(p1, p2);
    series.attachPrimitive(primitive);
    drawingsRef.current.push(primitive);
    setActiveTool(null);
  }

  function handleCrosshairMove(param) {
    const tool = activeToolRef.current;
    if (!pendingPointRef.current || (tool !== 'trendline' && tool !== 'rectangle')) return;
    if (!param.point || !param.time) return;

    const series = seriesMapRef.current.candle;
    if (!series) return;
    const price = series.coordinateToPrice(param.point.y);
    if (price === null) return;

    const p1 = pendingPointRef.current;
    const p2 = { time: param.time, price };

    if (!previewPrimitiveRef.current) {
      const PrimitiveClass = tool === 'trendline' ? TrendLinePrimitive : RectanglePrimitive;
      const preview = new PrimitiveClass(p1, p2, { preview: true });
      series.attachPrimitive(preview);
      previewPrimitiveRef.current = preview;
    } else {
      previewPrimitiveRef.current.setSecondPoint(p2);
    }
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      if (!selectedDrawingRef.current) return;
      e.preventDefault();
      handleDeleteSelected();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let chart;
    let cancelled = false;

    let loadedData = [];
    let isLoadingMore = false;
    let noMoreData = false;

    async function loadMoreHistory() {
      if (isLoadingMore || noMoreData || loadedData.length === 0) return;
      isLoadingMore = true;

      const earliest = new Date(dateOf(loadedData[0]));
      const newEnd = new Date(earliest);
      newEnd.setDate(newEnd.getDate() - 1);
      const newStart = new Date(newEnd);
      newStart.setMonth(newStart.getMonth() - CHUNK_MONTHS);

      try {
        const older = await fetchRange(symbol, newStart, newEnd);
        if (cancelled) return;

        if (older.length === 0) {
          noMoreData = true;
          return;
        }

        const previousRange = chart.timeScale().getVisibleLogicalRange();

        loadedData = [...older, ...loadedData];
        loadedDataRef.current = loadedData;
        renderAllSeries(seriesMapRef.current, loadedData);

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
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - CHUNK_MONTHS);

        const data = await fetchRange(symbol, start, end);
        if (cancelled) return;

        const currentTheme = darkMode ? THEME.dark : THEME.light;

        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          layout: {
            background: { color: currentTheme.chartBg },
            textColor: currentTheme.chartText,
            panes: {
              separatorColor: currentTheme.separator,
              separatorHoverColor: currentTheme.separatorHover,
              enableResize: true,
            },
          },
          grid: {
            vertLines: { color: currentTheme.gridColor },
            horzLines: { color: currentTheme.gridColor },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
          },
        });
        chartRef.current = chart;

        PANE0_SERIES.forEach(({ key, type, options }) => {
          seriesMapRef.current[key] = chart.addSeries(type, options, 0);
        });
        chart.panes()[0].setStretchFactor(MAIN_PANE_STRETCH);

        rebuildDedicatedPanes(chart, seriesMapRef.current, visibility);

        loadedData = data;
        loadedDataRef.current = loadedData;
        renderAllSeries(seriesMapRef.current, loadedData);
        chart.timeScale().fitContent();

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && range.from < EDGE_THRESHOLD) {
            loadMoreHistory();
          }
        });

        chart.subscribeClick(handleChartClick);
        chart.subscribeCrosshairMove(handleCrosshairMove);

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
      }
    }

    init();

    return () => {
      cancelled = true;
      if (chart) {
        chart._cleanupResizeObserver?.();
        chart.remove();
      }
      chartRef.current = null;
      seriesMapRef.current = {};
      loadedDataRef.current = [];
      drawingsRef.current = [];
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
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { color: t.chartBg },
        textColor: t.chartText,
        panes: {
          separatorColor: t.separator,
          separatorHoverColor: t.separatorHover,
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: t.gridColor },
        horzLines: { color: t.gridColor },
      },
    });
  }, [darkMode]);

  const allVisible = TOGGLE_GROUPS.every((g) => visibility[g.id]);
  const canExtend = selectedDrawing && typeof selectedDrawing.getExtend === 'function';

  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        backgroundColor: t.pageBg,
        '--panel-bg': t.panelBg,
        '--panel-border': t.panelBorder,
        '--text': t.text,
        '--text-dim': t.textDim,
        '--btn-bg': t.btnBg,
        '--btn-bg-hover': t.btnBgHover,
        '--btn-border': t.btnBorder,
        '--input-bg': t.inputBg,
        '--accent': t.accent,
        '--accent-hover': t.accentHover,
        '--accent-ring': t.accentRing,
      }}
    >
      <style>{`
        .stc-header {
          background: var(--panel-bg);
          backdrop-filter: blur(14px) saturate(180%);
          -webkit-backdrop-filter: blur(14px) saturate(180%);
          border: 1px solid var(--panel-border);
          border-radius: 14px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06);
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: background-color 200ms ease, border-color 200ms ease;
        }
        .stc-title {
          font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.02em;
          color: var(--text);
          margin: 0;
          padding: 0 4px;
          transition: color 200ms ease;
        }
        .stc-input {
          font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
          font-size: 13px;
          border: 1px solid var(--btn-border);
          background: var(--input-bg);
          color: var(--text);
          border-radius: 8px;
          padding: 7px 10px;
          width: 100px;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease, background-color 200ms ease, color 200ms ease;
        }
        .stc-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-ring);
        }
        .stc-btn {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          border: 1px solid var(--btn-border);
          background: var(--btn-bg);
          color: var(--text);
          border-radius: 8px;
          padding: 7px 14px;
          cursor: pointer;
          transition: background-color 150ms ease, transform 150ms ease, box-shadow 150ms ease, color 200ms ease;
        }
        .stc-btn:hover {
          background: var(--btn-bg-hover);
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
        }
        .stc-btn:active {
          transform: translateY(0);
        }
        .stc-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        .stc-btn-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }
        .stc-btn-primary:hover {
          background: var(--accent-hover);
          box-shadow: 0 4px 10px var(--accent-ring);
        }
        .stc-btn-active {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }
        .stc-theme-toggle {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 1px solid var(--btn-border);
          background: var(--btn-bg);
          color: var(--text);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          transition: background-color 150ms ease, transform 200ms ease, box-shadow 150ms ease, color 200ms ease;
        }
        .stc-theme-toggle:hover {
          background: var(--btn-bg-hover);
          transform: translateY(-1px) rotate(20deg);
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
        }
        .stc-toggle-all {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 22px;
          font-weight: 600;
          border: 1px solid var(--btn-border);
          background: var(--btn-bg);
          color: var(--text);
          border-radius: 10px;
          padding: 12px 18px;
          cursor: pointer;
          transition: background-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
          margin-bottom: 10px;
          width: 100%;
        }
        .stc-toggle-all:hover {
          background: var(--btn-bg-hover);
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
        }
        .stc-checkbox-row {
          display: flex;
          align-items: center;
          gap: 16px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 27px;
          color: var(--text-dim);
          padding: 10px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 120ms ease, color 200ms ease;
        }
        .stc-checkbox-row:hover {
          background: var(--btn-bg-hover);
        }
        .stc-checkbox-row input[type="checkbox"] {
          width: 22px;
          height: 22px;
          cursor: pointer;
          accent-color: var(--accent);
        }
        @media (prefers-reduced-motion: reduce) {
          .stc-btn, .stc-input, .stc-toggle-all, .stc-theme-toggle { transition: none; }
          .stc-btn:hover, .stc-toggle-all:hover, .stc-theme-toggle:hover { transform: none; }
        }
      `}</style>

      <div className="stc-header" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
          <h2 className="stc-title">{symbol}</h2>
          <button
            className="stc-theme-toggle"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>

        <form onSubmit={handleSymbolSubmit} style={{ display: 'inline-flex', gap: '6px' }}>
          <input
            className="stc-input"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="e.g. GARAN"
          />
          <button type="submit" className="stc-btn stc-btn-primary">Load</button>
        </form>

        <button className="stc-btn" onClick={() => setPanelOpen((open) => !open)}>Indicators</button>
      </div>

      <div className="stc-header" style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 20 }}>
        {DRAWING_TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`stc-btn ${activeTool === tool.id ? 'stc-btn-active' : ''}`}
            onClick={() => handleSelectTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}

        <button
          className={`stc-btn ${selectedExtend.left ? 'stc-btn-active' : ''}`}
          onClick={() => handleToggleExtend('left')}
          disabled={!canExtend}
        >
          Extend Left
        </button>
        <button
          className={`stc-btn ${selectedExtend.right ? 'stc-btn-active' : ''}`}
          onClick={() => handleToggleExtend('right')}
          disabled={!canExtend}
        >
          Extend Right
        </button>

        <button className="stc-btn" onClick={handleDeleteSelected} disabled={!selectedDrawing}>
          Delete selected
        </button>
        <button className="stc-btn" onClick={handleClearDrawings}>Clear</button>
      </div>

      {panelOpen && (
        <div
          className="stc-header"
          style={{
            position: 'absolute',
            top: '68px',
            left: '16px',
            zIndex: 20,
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '2px',
            padding: '14px',
          }}
        >
          <button className="stc-toggle-all" onClick={handleToggleAll}>
            {allVisible ? 'Hide all' : 'Show all'}
          </button>

          {TOGGLE_GROUPS.map((group) => (
            <label key={group.id} className="stc-checkbox-row">
              <input
                type="checkbox"
                checked={visibility[group.id]}
                onChange={() => handleToggle(group.id)}
              />
              {group.label}
            </label>
          ))}
        </div>
      )}

      {error && (
        <p style={{ position: 'absolute', top: '68px', left: '16px', zIndex: 20, color: '#ef5350' }}>
          Error: {error}
        </p>
      )}

      <div
        ref={chartContainerRef}
        style={{ width: '100%', height: '100%', cursor: activeTool ? 'crosshair' : 'default' }}
      />
    </div>
  );
}

export default App;