import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';

const CHUNK_MONTHS = 6;
const EDGE_THRESHOLD = 10;
const COLLAPSED_STRETCH = 0.0001;

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
  const [visibility, setVisibility] = useState(
    () => Object.fromEntries(TOGGLE_GROUPS.map((g) => [g.id, true]))
  );

  const [symbol, setSymbol] = useState('THYAO');
  const [symbolInput, setSymbolInput] = useState('THYAO');

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

        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          layout: {
            panes: {
              separatorColor: '#787b86',
              separatorHoverColor: 'rgba(120, 123, 134, 0.2)',
              enableResize: true,
            },
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
    };
  }, [symbol]);

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100%', overflow: 'hidden' }}>
      <style>{`
        .stc-header {
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(14px) saturate(180%);
          -webkit-backdrop-filter: blur(14px) saturate(180%);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 14px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stc-title {
          font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.02em;
          color: #0f172a;
          margin: 0;
          padding: 0 4px;
        }
        .stc-input {
          font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
          font-size: 13px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.6);
          border-radius: 8px;
          padding: 7px 10px;
          width: 100px;
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .stc-input:focus {
          border-color: #3e5c76;
          box-shadow: 0 0 0 3px rgba(62, 92, 118, 0.15);
        }
        .stc-btn {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          border: 1px solid rgba(15, 23, 42, 0.1);
          background: rgba(15, 23, 42, 0.04);
          color: #0f172a;
          border-radius: 8px;
          padding: 7px 14px;
          cursor: pointer;
          transition: background-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
        }
        .stc-btn:hover {
          background: rgba(15, 23, 42, 0.09);
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(15, 23, 42, 0.1);
        }
        .stc-btn:active {
          transform: translateY(0);
        }
        .stc-btn-primary {
          background: #3e5c76;
          border-color: #3e5c76;
          color: white;
        }
        .stc-btn-primary:hover {
          background: #33495e;
          box-shadow: 0 4px 10px rgba(62, 92, 118, 0.3);
        }
        .stc-checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 13.5px;
          color: #1e293b;
          padding: 5px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 120ms ease;
        }
        .stc-checkbox-row:hover {
          background: rgba(15, 23, 42, 0.05);
        }
        @media (prefers-reduced-motion: reduce) {
          .stc-btn, .stc-input { transition: none; }
          .stc-btn:hover { transform: none; }
        }
      `}</style>

      <div className="stc-header" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 20 }}>
        <h2 className="stc-title">{symbol}</h2>

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
            padding: '8px',
          }}
        >
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

      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default App;