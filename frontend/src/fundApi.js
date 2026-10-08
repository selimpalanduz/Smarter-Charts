import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

export function summaryUrl(symbol, basis, period) {
  return `${API_BASE}/api/fundamentals/summary/${symbol}?basis=${basis}&period=${period}`;
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
