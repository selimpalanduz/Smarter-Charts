import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';

const SYMBOL = 'THYAO';
const CHUNK_MONTHS = 6;
const EDGE_THRESHOLD = 10;
const TOTAL_HEIGHT = 1300;

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

// Single source of truth for every series: which pane it lives in, how it's
// styled, and how to derive its data from the raw rows. init() and
// loadMoreHistory() both read from this list, so there is no duplicated logic.
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

// Groups the individual series into the checkboxes shown in the Indicators
// panel. One checkbox can control several series at once (e.g. all three
// Bollinger Band lines share one toggle).
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

async function fetchRange(symbol, start, end) {
  const toISO = (d) => d.toISOString().slice(0, 10);
  const url = `http://127.0.0.1:8000/api/price/${symbol}?start=${toISO(start)}&end=${toISO(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

function App() {
  const chartContainerRef = useRef(null);
  const seriesMapRef = useRef({});
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [visibility, setVisibility] = useState(
    () => Object.fromEntries(TOGGLE_GROUPS.map((g) => [g.id, true]))
  );

  function handleToggle(groupId) {
    const nextVisible = !visibility[groupId];
    setVisibility((prev) => ({ ...prev, [groupId]: nextVisible }));

    const group = TOGGLE_GROUPS.find((g) => g.id === groupId);
    group.keys.forEach((key) => {
      seriesMapRef.current[key]?.applyOptions({ visible: nextVisible });
    });
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
        const older = await fetchRange(SYMBOL, newStart, newEnd);
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
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - CHUNK_MONTHS);

        const data = await fetchRange(SYMBOL, start, end);
        if (cancelled) return;

        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: TOTAL_HEIGHT,
        });

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
            chart.applyOptions({ width: entries[0].contentRect.width });
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
      seriesMapRef.current = {};
    };
  }, []);

  return (
    <div style={{ padding: '12px', boxSizing: 'border-box', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <h2 style={{ margin: 0 }}>{SYMBOL}</h2>
        <button onClick={() => setPanelOpen((open) => !open)}>Indicators</button>
      </div>

      {panelOpen && (
        <div
          style={{
            position: 'absolute',
            top: '48px',
            left: '12px',
            zIndex: 10,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '6px',
            padding: '10px 14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {TOGGLE_GROUPS.map((group) => (
            <label key={group.id} style={{ display: 'block', fontSize: '14px', padding: '3px 0' }}>
              <input
                type="checkbox"
                checked={visibility[group.id]}
                onChange={() => handleToggle(group.id)}
                style={{ marginRight: '8px' }}
              />
              {group.label}
            </label>
          ))}
        </div>
      )}

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      <div ref={chartContainerRef} style={{ width: '100%', height: `${TOTAL_HEIGHT}px` }} />
    </div>
  );
}

export default App;