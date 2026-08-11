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
const COLLAPSED_STRETCH = 0.0001;

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

const SERIES_CONFIG = [
  { key: 'candle', pane: 0, type: CandlestickSeries, options: {}, data: (rows) => rows.map(toCandleFormat) },
  { key: 'sma20', pane: 0, type: LineSeries, options: { color: '#eda100', lineWidth: 2, title: 'SMA20' }, data: (rows) => lineData(rows, 'SMA_20') },
  { key: 'ema12', pane: 0, type: LineSeries, options: { color: '#4a90d9', lineWidth: 1, title: 'EMA12' }, data: (rows) => lineData(rows, 'EMA_12') },
  { key: 'bbUpper', pane: 0, type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Upper' }, data: (rows) => lineData(rows, 'BB_Upper') },
  { key: 'bbMiddle', pane: 0, type: LineSeries, options: { color: 'rgba(150,150,150,0.4)', lineWidth: 1, lineStyle: 2, title: 'BB Middle' }, data: (rows) => lineData(rows, 'BB_Middle') },
  { key: 'bbLower', pane: 0, type: LineSeries, options: { color: 'rgba(150,150,150,0.7)', lineWidth: 1, title: 'BB Lower' }, data: (rows) => lineData(rows, 'BB_Lower') },
  { key: 'vwap', pane: 0, type: LineSeries, options: { color: '#a259d9', lineWidth: 1, title: 'VWAP' }, data: (rows) => lineData(rows, 'VWAP') },
  { key: 'supertrendUp', pane: 0, type: LineSeries, options: { color: '#26a69a', lineWidth: 2, title: 'Supertrend' }, data: supertrendUpData },
  { key: 'supertrendDown', pane: 0, type: LineSeries, options: { color: '#ef5350', lineWidth: 2 }, data: supertrendDownData },

  { key: 'volume', pane: 1, type: HistogramSeries, options: { priceFormat: { type: 'volume' } }, data: volumeData },

  { key: 'rsi', pane: 2, type: LineSeries, options: { color: '#a67bd6', lineWidth: 1.5, title: 'RSI14' }, data: (rows) => lineData(rows, 'RSI_14') },

  { key: 'macd', pane: 3, type: LineSeries, options: { color: '#2a78d6', lineWidth: 1.5, title: 'MACD' }, data: (rows) => lineData(rows, 'MACD') },
  { key: 'macdSignal', pane: 3, type: LineSeries, options: { color: '#eda100', lineWidth: 1.5, title: 'Signal' }, data: (rows) => lineData(rows, 'MACD_Signal') },
  { key: 'macdHist', pane: 3, type: HistogramSeries, options: {}, data: macdHistData },

  { key: 'stochK', pane: 4, type: LineSeries, options: { color: '#2a78d6', lineWidth: 1.5, title: '%K' }, data: (rows) => lineData(rows, 'Stoch_K') },
  { key: 'stochD', pane: 4, type: LineSeries, options: { color: '#eda100', lineWidth: 1.5, title: '%D' }, data: (rows) => lineData(rows, 'Stoch_D') },

  { key: 'adx', pane: 5, type: LineSeries, options: { color: '#52514e', lineWidth: 1.5, title: 'ADX14' }, data: (rows) => lineData(rows, 'ADX_14') },

  { key: 'atr', pane: 6, type: LineSeries, options: { color: '#d9822b', lineWidth: 1.5, title: 'ATR14' }, data: (rows) => lineData(rows, 'ATR_14') },

  { key: 'obv', pane: 7, type: LineSeries, options: { color: '#3d8c5f', lineWidth: 1.5, title: 'OBV' }, data: (rows) => lineData(rows, 'OBV') },
];

const PANE_STRETCH = { 0: 3, 1: 1, 2: 1.2, 3: 1.2, 4: 1.2, 5: 1, 6: 1, 7: 1 };

const TOGGLE_GROUPS = [
  { id: 'sma20', label: 'SMA 20', keys: ['sma20'] },
  { id: 'ema12', label: 'EMA 12', keys: ['ema12'] },
  { id: 'bb', label: 'Bollinger Bands', keys: ['bbUpper', 'bbMiddle', 'bbLower'] },
  { id: 'vwap', label: 'VWAP', keys: ['vwap'] },
  { id: 'supertrend', label: 'Supertrend', keys: ['supertrendUp', 'supertrendDown'] },
  { id: 'volume', label: 'Volume', keys: ['volume'] },
  { id: 'rsi', label: 'RSI', keys: ['rsi'] },
  { id: 'macd', label: 'MACD', keys: ['macd', 'macdSignal', 'macdHist'] },
  { id: 'stoch', label: 'Stochastic', keys: ['stochK', 'stochD'] },
  { id: 'adx', label: 'ADX', keys: ['adx'] },
  { id: 'atr', label: 'ATR', keys: ['atr'] },
  { id: 'obv', label: 'OBV', keys: ['obv'] },
];

const GROUP_PANE = { volume: 1, rsi: 2, macd: 3, stoch: 4, adx: 5, atr: 6, obv: 7 };

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

function App() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
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
    setVisibility((prev) => ({ ...prev, [groupId]: nextVisible }));

    const group = TOGGLE_GROUPS.find((g) => g.id === groupId);
    group.keys.forEach((key) => {
      seriesMapRef.current[key]?.applyOptions({ visible: nextVisible });
    });

    const paneIndex = GROUP_PANE[groupId];
    const chart = chartRef.current;
    if (paneIndex === undefined || !chart) return;

    const panes = chart.panes();
    const targetPane = panes[paneIndex];
    const mainPane = panes[0];
    if (!targetPane || !mainPane) return;

    if (nextVisible) {
      targetPane.setStretchFactor(PANE_STRETCH[paneIndex]);
      mainPane.setStretchFactor(mainPane.getStretchFactor() - PANE_STRETCH[paneIndex]);
    } else {
      targetPane.setStretchFactor(COLLAPSED_STRETCH);
      mainPane.setStretchFactor(mainPane.getStretchFactor() + PANE_STRETCH[paneIndex]);
    }
  }

  function handleToggleAll() {
    const allVisible = TOGGLE_GROUPS.every((g) => visibility[g.id]);
    const target = !allVisible;
    TOGGLE_GROUPS.forEach((group) => {
      if (visibility[group.id] !== target) {
        handleToggle(group.id);
      }
    });
  }

  function handleSelectTool(toolId) {
    pendingPointRef.current = null;
    const series = seriesMapRef.current.candle;
    if (previewPrimitiveRef.current && series) {
      series.detachPrimitive(previewPrimitiveRef.current);
      previewPrimitiveRef.current = null;
    }
    setActiveTool((current) => (current === toolId ? null : toolId));
  }

  function handleClearDrawings() {
    const series = seriesMapRef.current.candle;
    if (series) {
      drawingsRef.current.forEach((primitive) => series.detachPrimitive(primitive));
    }
    drawingsRef.current = [];
  }

  function handleChartClick(param) {
    const tool = activeToolRef.current;
    if (!tool || !param.point || !param.time) return;

    const series = seriesMapRef.current.candle;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const price = series.coordinateToPrice(param.point.y);
    if (price === null) return; // click landed outside the main price pane

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

  // Chart creation / data loading — only reruns when the symbol changes.
  useEffect(() => {
    let chart;
    let cancelled = false;

    let loadedData = [];
    let isLoadingMore = false;
    let noMoreData = false;

    function renderSeries() {
      SERIES_CONFIG.forEach(({ key, data }) => {
        seriesMapRef.current[key].setData(data(loadedData));
      });
    }

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
        renderSeries();

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

        SERIES_CONFIG.forEach(({ key, pane, type, options }) => {
          seriesMapRef.current[key] = chart.addSeries(type, options, pane);
        });

        chart.panes().forEach((pane, i) => {
          pane.setStretchFactor(PANE_STRETCH[i] ?? 1);
        });

        const rsi = seriesMapRef.current.rsi;
        rsi.createPriceLine({ price: 70, color: '#e5484d', lineStyle: 2, lineWidth: 1, title: '70' });
        rsi.createPriceLine({ price: 30, color: '#3ddc84', lineStyle: 2, lineWidth: 1, title: '30' });

        const stochK = seriesMapRef.current.stochK;
        stochK.createPriceLine({ price: 80, color: '#e5484d', lineStyle: 2, lineWidth: 1, title: '80' });
        stochK.createPriceLine({ price: 20, color: '#3ddc84', lineStyle: 2, lineWidth: 1, title: '20' });

        loadedData = data;
        renderSeries();
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
      drawingsRef.current = [];
      pendingPointRef.current = null;
      previewPrimitiveRef.current = null;
      setActiveTool(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Theme switch — repaints the existing chart in place, no refetch, no lost scroll history.
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