import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

export function summaryUrl(symbol, basis, period) {
  return `${API_BASE}/api/fundamentals/summary/${symbol}?basis=${basis}&period=${period}`;
}

// No basis in the URL: a ratio is unit-free, so the answer is the same number
// whichever measuring stick the tables are showing.
// URL'de taban yok: oran birimsiz, tablolar hangi ölçüyü gösteriyorsa cevap
// aynı sayı.
export function valuationUrl(symbol) {
  return `${API_BASE}/api/fundamentals/valuation/${symbol}`;
}

// The P/E measured daily against price, reduced to its own history. Shared
// with the chart's P/E pane, which draws the same percentiles as lines.
// Fiyata karşı günlük ölçülmüş F/K'nın kendi geçmişine indirgenmiş hâli.
// Grafikteki F/K paneliyle ortak; o da aynı yüzdelikleri çizgi olarak çiziyor.
export function peBandUrl(symbol) {
  return `${API_BASE}/api/pe-band/${symbol}`;
}

export function usePeBand(symbol) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true });

    fetch(peBandUrl(symbol))
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return state;
}

export function useSummary(symbol, basis, period) {
  const str = useT();
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });

    fetch(summaryUrl(symbol, basis, period))
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, error: str.fundLoadFailed, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, basis, period, str.fundLoadFailed]);

  return state;
}

export function useValuation(symbol) {
  const str = useT();
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });

    fetch(valuationUrl(symbol))
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, error: str.fundValuationFailed, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, str.fundValuationFailed]);

  return state;
}
