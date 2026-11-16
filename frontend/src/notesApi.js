import { API_BASE } from './config.js';

const BASE = `${API_BASE}/api/notes`;

async function send(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(String(res.status));
    error.detail = body?.detail ?? null;
    error.status = res.status;
    throw error;
  }
  return body;
}

export function fetchNote(symbol) {
  return send(`/${encodeURIComponent(symbol)}`);
}

export function fetchNotes() {
  return send('');
}

export function saveNote(symbol, body) {
  return send(`/${encodeURIComponent(symbol)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}
