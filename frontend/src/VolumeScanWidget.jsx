import { useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

function formatRvol(value) {
  return value == null ? '-' : value.toFixed(2);
}

const cell = { padding: '6px 8px', textAlign: 'right' };
const firstCell = { ...cell, textAlign: 'left' };

function VolumeScanWidget({ onSelectSymbol }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [onlyBreakouts, setOnlyBreakouts] = useState(false);
  const t = useT();

  async function loadScan(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/scan/volume${refresh ? '?refresh=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const hasScanned = results.length > 0 || error !== null;
  const visibleRows = onlyBreakouts ? results.filter((r) => r.Breakout != null) : results;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="stc-panel-title">{t.volumeScan}</span>
        <button className="stc-btn" onClick={() => loadScan(hasScanned)} disabled={loading}>
          {loading ? '…' : hasScanned ? t.refresh : t.scan}
        </button>
      </div>

      {error && <p style={{ color: 'var(--down)', fontSize: '12px', margin: 0 }}>{error}</p>}

      {!hasScanned && !loading && <p className="stc-muted">{t.scanHint(563)}</p>}

      {hasScanned && (
        <label className="stc-checkbox-row" style={{ fontSize: '13px', padding: '4px 0' }}>
          <input type="checkbox" checked={onlyBreakouts} onChange={(e) => setOnlyBreakouts(e.target.checked)} />
          {t.onlyBreakouts}
        </label>
      )}

      {hasScanned && (
        <div style={{ overflowY: 'auto', flexGrow: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: '3px' }}>
          <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="stc-mono" style={{ color: 'var(--text-dim)', fontSize: '11px', position: 'sticky', top: 0, background: 'var(--panel-bg)' }}>
                <th style={firstCell}>{t.colSymbol}</th>
                <th style={cell}>RVOL</th>
                <th style={cell}>{t.colClose}</th>
                <th style={cell} title={t.breakoutTitle}>{t.colBreakout}</th>
              </tr>
            </thead>
            <tbody className="stc-mono">
              {visibleRows.map((row) => (
                <tr key={row.Symbol} className="stc-row" onClick={() => onSelectSymbol(row.Symbol)}>
                  <td style={{ ...firstCell, color: 'var(--text-strong)', fontWeight: 600 }}>{row.Symbol}</td>
                  <td style={cell}>{formatRvol(row.RVOL)}</td>
                  <td style={cell}>{row.Close}</td>
                  <td style={{ ...cell, color: row.Breakout != null ? 'var(--up)' : 'var(--text-dim)' }}>
                    {row.Breakout != null ? `↑ ${row.Breakout}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default VolumeScanWidget;
