const HORIZONS = [5, 20, 60];
const FORWARD_BARS = 60;
const UP = '#26a69a';
const DOWN = '#ef5350';

function formatChange(pct) {
  if (pct == null) return '-';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function changeColor(pct) {
  if (pct == null) return undefined;
  return pct >= 0 ? UP : DOWN;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function Sparkline({ pattern, path }) {
  const width = 150;
  const height = 38;
  const total = pattern.length + FORWARD_BARS;
  const all = [...pattern, ...path];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const x = (i) => (i / (total - 1)) * width;
  const y = (v) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const points = (values, offset = 0) =>
    values.map((v, i) => `${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const split = pattern.length - 1;
  const forward = path.slice(split);
  const forwardColor = changeColor(forward[forward.length - 1]) ?? 'currentColor';

  return (
    <svg width={width} height={height} style={{ flexShrink: 0 }}>
      <line x1={x(split)} x2={x(split)} y1={0} y2={height} stroke="currentColor" strokeOpacity="0.2" />
      <polyline points={points(pattern)} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeDasharray="3 2" />
      <polyline points={points(path.slice(0, split + 1))} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <polyline points={points(forward, split)} fill="none" stroke={forwardColor} strokeWidth="1.5" />
    </svg>
  );
}

function PatternSearchWidget({ state, onClose }) {
  const { loading, error, data } = state;

  return (
    <div
      className="stc-header"
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        zIndex: 20,
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '8px',
        padding: '12px',
        width: '330px',
        fontSize: '12px',
        color: 'var(--text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '13px' }}>Benzer Formasyonlar</strong>
        <button className="stc-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {loading && <span style={{ opacity: 0.6 }}>Aranıyor...</span>}
      {error && <span style={{ color: DOWN }}>{error}</span>}

      {data && (
        <>
          <span style={{ opacity: 0.7 }}>
            Seçim: {formatDate(data.start)} – {formatDate(data.end)} ({data.bars} bar)
          </span>

          {data.matches.length === 0 && <span style={{ opacity: 0.6 }}>Benzer dönem bulunamadı.</span>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '340px' }}>
            {data.matches.map((m) => (
              <div key={m.start} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {formatDate(m.start)} – {formatDate(m.end)}
                  </span>
                  <span style={{ opacity: 0.7 }} title="Log fiyat korelasyonu">
                    %{m.similarity.toFixed(0)} benzer
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Sparkline pattern={data.pattern} path={m.path} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {HORIZONS.map((h) => (
                      <span key={h}>
                        <span style={{ opacity: 0.6 }}>{h}g </span>
                        <span style={{ color: changeColor(m.returns[h]) }}>{formatChange(m.returns[h])}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.matches.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--panel-border)',
                paddingTop: '6px',
              }}
            >
              {HORIZONS.map((h) => {
                const s = data.summary[h];
                return (
                  <div key={h} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ opacity: 0.6 }}>{h} gün sonra</span>
                    <span style={{ color: changeColor(s?.avg), fontWeight: 600 }}>ort. {formatChange(s?.avg)}</span>
                    <span style={{ opacity: 0.7 }}>{s ? `${s.up}/${s.count} yükseldi` : '-'}</span>
                  </div>
                );
              })}
            </div>
          )}

          <span style={{ opacity: 0.5, fontSize: '11px' }}>
            Gri kesikli: senin seçimin. Renkli: geçmişteki eşleşme ve sonraki {FORWARD_BARS} gün.
          </span>
        </>
      )}
    </div>
  );
}

export default PatternSearchWidget;
