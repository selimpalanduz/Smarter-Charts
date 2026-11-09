import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from './config.js';

const BASE = `${API_BASE}/api/portfolio`;

async function send(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The detail is the backend's own code object; it is handed on unchanged
    // so the caller can say something specific instead of "failed".
    // detail, backend'in kendi kod nesnesi; olduğu gibi aktarılıyor ki
    // çağıran "olmadı" demek yerine belirli bir şey söyleyebilsin.
    const error = new Error(String(res.status));
    error.detail = body?.detail ?? null;
    error.status = res.status;
    throw error;
  }
  return body;
}

export function fetchTrades(symbol) {
  return send(symbol ? `/trades?symbol=${encodeURIComponent(symbol)}` : '/trades');
}

export function addTrade(trade) {
  return send('/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  });
}

export function deleteTrade(id) {
  return send(`/trades/${id}`, { method: 'DELETE' });
}

export function addAction(action) {
  return send('/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
}

export function deleteAction(id) {
  return send(`/actions/${id}`, { method: 'DELETE' });
}

export function fetchActions(symbol) {
  return send(`/actions/${symbol}`);
}

// One request carries the whole screen: positions, totals, both series and the
// notes. Splitting it would let the table and the chart disagree about what
// "today" is while the price cache refreshes underneath them.
// Tek istek bütün ekranı taşıyor: pozisyonlar, toplamlar, iki seri ve notlar.
// Bölmek, fiyat önbelleği altlarında tazelenirken tablo ile grafiğin "bugün"
// konusunda ayrışmasına izin vermek olurdu.
export function useOverview(benchmark) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    const query = benchmark ? `?benchmark=${encodeURIComponent(benchmark)}` : '';

    send(`/overview${query}`)
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((e) => {
        if (!cancelled) setState({ data: null, error: e, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [benchmark, nonce]);

  return { ...state, reload };
}
