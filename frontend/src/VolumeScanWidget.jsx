import { useEffect, useState } from 'react';

const API_BASE = 'http://127.0.0.1:8000';

function formatRvol(value) {
  return value == null ? '-' : value.toFixed(2);
}

function VolumeScanWidget({ onSelectSymbol }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

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

  useEffect(() => {
    loadScan(false);
  }, []);

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
        width: '220px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '13px' }}>Hacim Taraması</strong>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="stc-btn"
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => loadScan(true)}
            disabled={loading}
          >
            {loading ? '...' : 'Yenile'}
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

      {!collapsed && (
        <div style={{ overflowY: 'auto', maxHeight: '260px' }}>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.6 }}>
                <th>Sembol</th>
                <th>RVOL</th>
                <th>Kapanış</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
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