import { useT } from './i18n.js';
import { CloseIcon } from './icons.jsx';

const HORIZONS = [5, 20, 60];
const FORWARD_BARS = 60;
const UP = 'var(--up)';
const DOWN = 'var(--down)';

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
      <polyline points={points(forward, split)} fill="none" style={{ stroke: forwardColor }} strokeWidth="1.5" />
    </svg>
  );
}

function PatternSearchWidget({ state, onClose }) {
  const t = useT();
  if (!state) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.similarPatterns}</span>
        <p className="stc-muted">{t.patternEmpty}</p>
      </div>
    );
  }
  const { loading, error, data } = state;
  const errorText = error && (t.patternErrors[error.code]?.(error.limit) ?? error.message);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="stc-panel-title">{t.similarPatterns}</span>
        <button className="stc-icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
          <CloseIcon size={15} />
        </button>
      </div>

      {loading && <span style={{ opacity: 0.6 }}>{t.searching}</span>}
      {error && <span style={{ color: DOWN }}>{errorText}</span>}

      {data && (
        <>
          <span style={{ opacity: 0.7 }}>
            {t.selection(formatDate(data.start), formatDate(data.end), data.bars)}
          </span>

          {data.matches.length === 0 && <span style={{ opacity: 0.6 }}>{t.noMatches}</span>}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.matches.map((m) => (
              <div key={m.start} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 0', borderTop: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="stc-mono">
                    {formatDate(m.start)} – {formatDate(m.end)}
                  </span>
                  <span style={{ opacity: 0.7 }} title={t.similarityTitle}>
                    {t.similarity(m.similarity.toFixed(0))}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Sparkline pattern={data.pattern} path={m.path} />
                  <div className="stc-mono" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {HORIZONS.map((h) => (
                      <span key={h}>
                        <span style={{ opacity: 0.6 }}>{t.daysShort(h)} </span>
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
                    <span style={{ opacity: 0.6 }}>{t.daysLater(h)}</span>
                    <span style={{ color: changeColor(s?.avg), fontWeight: 600 }}>{t.average(formatChange(s?.avg))}</span>
                    <span style={{ opacity: 0.7 }}>{s ? t.rose(s.up, s.count) : '-'}</span>
                  </div>
                );
              })}
            </div>
          )}

          <span style={{ opacity: 0.5, fontSize: '11px' }}>
            {t.sparklineLegend(FORWARD_BARS)}
          </span>
        </>
      )}
    </div>
  );
}

export default PatternSearchWidget;
