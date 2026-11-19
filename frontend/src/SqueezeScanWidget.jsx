import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

const POLL_MS = 2000;
const MODES = ['percentile', 'classic'];

// Below this the range has compressed enough to be worth marking.
// Bunun altında aralık, işaretlemeye değecek kadar daralmış.
const TIGHT_MARK = 25;

const cell = { padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' };
const firstCell = { ...cell, textAlign: 'left' };
const headRow = {
  color: 'var(--text-dim)',
  fontSize: '11px',
  position: 'sticky',
  top: 0,
  background: 'var(--panel-bg)',
};

async function fetchScan(mode, start) {
  const params = new URLSearchParams({ mode });
  if (start) params.set('start', 'true');
  const res = await fetch(`${API_BASE}/api/scan/squeeze?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Folded shut by default, like the two widgets above it in the Scan tab.
// Tara sekmesinde üstündeki iki widget gibi varsayılan kapalı.
function SqueezeScanWidget({ onSelectSymbol }) {
  const [scan, setScan] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('percentile');
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const modeRef = useRef(mode);
  const t = useT();

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  async function load(start = false) {
    clearTimeout(timerRef.current);
    try {
      const data = await fetchScan(modeRef.current, start);
      setScan(data);
      setError(data.error);
      if (data.running) timerRef.current = setTimeout(() => load(), POLL_MS);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    return () => clearTimeout(timerRef.current);
  }, []);

  const running = scan?.running;
  const results = scan?.results ?? [];
  const nowCount = results.filter((r) => r.squeezeNow).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="stc-panel-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`stc-fold-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
          <span className="stc-panel-title">{t.squeezeScanTitle}</span>
        </button>
        <button
          className="stc-btn"
          onClick={() => {
            setOpen(true);
            load(true);
          }}
          disabled={!scan || running}
        >
          {running ? t.squeezeScanProgress(scan.done, scan.total) : results.length ? t.refresh : t.scan}
        </button>
      </div>

      {open && (
        <>
          <span className="stc-prose">{t.squeezeScanIntro}</span>

          {/* The saved scan was run in one mode, so switching modes needs a new
              scan rather than a re-read of the same rows. */}
          {/* Kayıtlı tarama tek modda çalıştı; mod değiştirmek aynı satırları
              yeniden okumayı değil yeni bir tarama gerektiriyor. */}
          <div className="stc-seg" role="group" style={{ alignSelf: 'flex-start' }}>
            {MODES.map((id) => (
              <button
                key={id}
                className={mode === id ? 'is-active' : ''}
                aria-pressed={mode === id}
                title={t.squeezeModeHint[id]}
                onClick={() => setMode(id)}
              >
                {t.squeezeModes[id]}
              </button>
            ))}
          </div>

          {error && <span style={{ color: 'var(--down)', fontSize: '12px' }}>{error}</span>}
          {scan?.updatedAt && (
            <span style={{ fontSize: '12.5px', color: 'var(--text-faint)' }}>
              {t.squeezeScanUpdated(scan.updatedAt)}
              {scan.mode !== mode && ` · ${t.squeezeModes[scan.mode]}`}
            </span>
          )}
          {scan && !results.length && !running && <span className="stc-muted">{t.squeezeScanHint}</span>}

          {results.length > 0 && (
            <>
              <span className="stc-mono" style={{ fontSize: '12px' }}>
                {t.squeezeScanCount(nowCount, results.length)}
              </span>
              <div
                style={{
                  overflowY: 'auto',
                  maxHeight: '420px',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '3px',
                }}
              >
                <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="stc-mono" style={headRow}>
                      <th style={firstCell}>{t.colSymbol}</th>
                      <th style={cell} title={t.colTightTitle}>{t.colTight}</th>
                      <th style={cell} title={t.colSqueezeDaysTitle}>{t.colSqueezeDays}</th>
                      <th style={cell} title={t.colAdxTitle}>ADX</th>
                      <th style={cell} title={t.colRsiTitle}>RSI</th>
                    </tr>
                  </thead>
                  <tbody className="stc-mono">
                    {results.map((r) => (
                      <tr key={r.symbol} className="stc-row" onClick={() => onSelectSymbol(r.symbol)}>
                        <td style={{ ...firstCell, color: 'var(--text-strong)', fontWeight: 600 }}>
                          {r.symbol}
                          {r.squeezeNow && (
                            <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 400, color: 'var(--accent)' }}>
                              {t.squeezeNowTag}
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            ...cell,
                            color: r.tightness != null && r.tightness <= TIGHT_MARK ? 'var(--text-strong)' : 'var(--text-dim)',
                            fontWeight: r.tightness != null && r.tightness <= TIGHT_MARK ? 600 : 400,
                          }}
                        >
                          {r.tightness == null ? '-' : r.tightness.toFixed(0)}
                        </td>
                        <td style={cell}>{r.squeezeDays}</td>
                        <td style={{ ...cell, color: 'var(--text-dim)' }}>{r.adx.toFixed(1)}</td>
                        <td style={{ ...cell, color: 'var(--text-dim)' }}>{r.rsi.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <span className="stc-prose" style={{ fontSize: '12.5px', color: 'var(--text-faint)' }}>
            {t.squeezeScanNote}
          </span>
        </>
      )}
    </div>
  );
}

export default SqueezeScanWidget;
