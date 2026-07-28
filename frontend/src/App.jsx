import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

const SYMBOL = 'THYAO';
const CHUNK_MONTHS = 6; // her istekte kaç aylık dilim çekeceğiz
const EDGE_THRESHOLD = 10; // sola kaç bar kala yeni veri çekmeye başlayacağız

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function toChartFormat(row) {
  return {
    time: row.Date.slice(0, 10),
    open: row.Open,
    high: row.High,
    low: row.Low,
    close: row.Close,
  };
}

async function fetchRange(symbol, start, end) {
  const url = `http://127.0.0.1:8000/api/price/${symbol}?start=${toISODate(start)}&end=${toISODate(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
  return res.json();
}

function App() {
  const chartContainerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let chart;
    let candleSeries;
    let cancelled = false;

    let loadedData = [];       // şu an chart'ta olan tüm veri (tarihe göre artan sırada)
    let isLoadingMore = false; // aynı anda birden fazla istek atılmasını engeller
    let noMoreData = false;    // backend boş dönerse, o yönde tekrar denemeyi keseriz

    async function loadMoreHistory() {
      if (isLoadingMore || noMoreData || loadedData.length === 0) return;
      isLoadingMore = true;

      const earliest = new Date(loadedData[0].Date.slice(0, 10));
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
        candleSeries.setData(loadedData.map(toChartFormat));

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
          height: chartContainerRef.current.clientHeight,
        });

        candleSeries = chart.addSeries(CandlestickSeries);
        loadedData = data;
        candleSeries.setData(loadedData.map(toChartFormat));
        chart.timeScale().fitContent();

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range && range.from < EDGE_THRESHOLD) {
            loadMoreHistory();
          }
        });

        const resizeObserver = new ResizeObserver((entries) => {
          if (chart && entries[0]) {
            const { width, height } = entries[0].contentRect;
            chart.applyOptions({ width, height });
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
    };
  }, []);

  return (
    <div style={{ padding: '12px', height: '100vh', boxSizing: 'border-box' }}>
      <h2 style={{ margin: '0 0 8px' }}>{SYMBOL}</h2>
      {error && <p style={{ color: 'red' }}>Hata: {error}</p>}
      <div ref={chartContainerRef} style={{ width: '100%', height: '90%' }} />
    </div>
  );
}

export default App;