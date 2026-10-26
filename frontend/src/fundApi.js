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

// A multiple measured daily against price, reduced to its own history.
// `kind` is 'pe' or 'pb'; both answer in the same shape. Shared with the
// chart panes, which draw the same percentiles as lines.
// Fiyata karşı günlük ölçülmüş bir çarpanın kendi geçmişine indirgenmiş
// hâli. `kind` 'pe' ya da 'pb'; ikisi de aynı biçimde cevap veriyor.
// Grafik panelleriyle ortak; onlar da aynı yüzdelikleri çizgi olarak çiziyor.
export function bandUrl(symbol, kind) {
  return `${API_BASE}/api/${kind}-band/${symbol}`;
}

export function useBand(symbol, kind) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true });

    fetch(bandUrl(symbol, kind))
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
  }, [symbol, kind]);

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
