import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';

// The list from /api/symbols, fetched once per page load and shared: the
// picker needs it to search, and the chart needs it to know whether what is
// loaded is a stock or an index. Backend indices.py is the single source of
// that answer, so it is read rather than restated here — a second copy of
// the index list would be the thing that drifts.
//
// /api/symbols listesi, sayfa başına bir kez çekilip paylaşılıyor: seçim
// listesi aramak için, grafik de yüklü olanın hisse mi endeks mi olduğunu
// bilmek için kullanıyor. Bu cevabın tek kaynağı backend/indices.py, bu
// yüzden burada yeniden yazılmıyor, okunuyor — endeks listesinin ikinci bir
// kopyası, zamanla sapacak şey olurdu.

let cached = null;
let inflight = null;
const waiting = new Set();

export function loadSymbols() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/symbols`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows) => {
        cached = Array.isArray(rows) ? rows : [];
        waiting.forEach((fn) => fn(cached));
        return cached;
      })
      .catch(() => {
        // Nothing is retried on a schedule; the next mount tries again.
        // Zamanlı bir yeniden deneme yok; sonraki mount tekrar deniyor.
        inflight = null;
        return [];
      });
  }
  return inflight;
}

export function useSymbols() {
  const [rows, setRows] = useState(cached ?? []);

  useEffect(() => {
    if (cached) {
      setRows(cached);
      return undefined;
    }
    let live = true;
    const onLoad = (list) => {
      if (live) setRows(list);
    };
    waiting.add(onLoad);
    loadSymbols();
    return () => {
      live = false;
      waiting.delete(onLoad);
    };
  }, []);

  return rows;
}

// "index", "stock", or null while the list has not arrived. Null is not
// "stock": a caller that hides the stock-only parts should wait for the
// answer rather than draw a P/E pane and take it away again.
// "index", "stock" ya da liste gelmediyse null. Null "stock" demek değil:
// yalnız hisseye ait kısımları gizleyen çağıran, F/K panelini çizip geri
// almak yerine cevabı beklesin.
export function useSymbolKind(symbol) {
  const rows = useSymbols();
  if (!rows.length) return null;
  const upper = (symbol ?? '').toUpperCase();
  return rows.find((row) => row.symbol === upper)?.kind ?? 'stock';
}

export function useSymbolName(symbol) {
  const rows = useSymbols();
  const upper = (symbol ?? '').toUpperCase();
  const row = rows.find((r) => r.symbol === upper);
  return row && row.name !== row.symbol ? row.name : null;
}
