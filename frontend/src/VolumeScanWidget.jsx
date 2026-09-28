import { useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

function formatRvol(value) {
  return value == null ? '-' : value.toFixed(2);
}

function VolumeScanWidget({ onSelectSymbol }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [onlyBreakouts, setOnlyBreakouts] = useState(false);
  const t = useT();

  async function loadScan(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/scan/volume${refresh ? '?refresh=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
    <div
      className="stc-header"
      style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        zIndex: 20,
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '6px',
        padding: '12px',
        width: '270px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '13px' }}>{t.volumeScan}</strong>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="stc-btn"
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => loadScan(hasScanned)}
            disabled={loading}
          >
            {loading ? '...' : hasScanned ? t.refresh : t.scan}
          </button>
          <button
            className="stc-btn"
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#ef5350', fontSize: '12px', margin: 0 }}>{error}</p>}

      {!hasScanned && !loading && (
        <p style={{ opacity: 0.6, fontSize: '11px', margin: 0 }}>
          {t.scanHint(563)}
        </p>
      )}

      {hasScanned && !collapsed && (
        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={onlyBreakouts}
            onChange={(e) => setOnlyBreakouts(e.target.checked)}
          />
          {t.onlyBreakouts}
        </label>
      )}

      {!collapsed && (
        <div style={{ overflowY: 'auto', maxHeight: '260px' }}>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.6 }}>
                <th>{t.colSymbol}</th>
                <th>RVOL</th>
                <th>{t.colClose}</th>
                <th title={t.breakoutTitle}>{t.colBreakout}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.Symbol}
                  onClick={() => onSelectSymbol(row.Symbol)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--btn-bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td>{row.Symbol}</td>
                  <td>{formatRvol(row.RVOL)}</td>
                  <td>{row.Close}</td>
                  <td style={{ color: row.Breakout != null ? '#26a69a' : undefined }}>
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