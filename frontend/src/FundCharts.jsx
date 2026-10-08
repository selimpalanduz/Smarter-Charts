import { useEffect, useRef, useState } from 'react';
import { SERIES } from './theme.js';
import { barPath, scaleOf, sparkline } from './fundFormat.js';

// Chart pieces the statement layouts share. Each one owns its own hover state,
// since nothing outside the chart reacts to it.
// Tablo yerleşimlerinin paylaştığı grafik parçaları. Hover durumunu her biri
// kendi içinde tutuyor; grafiğin dışında ona tepki veren bir şey yok.

export function Sparkline({ values, width = 84, height = 18, color = SERIES[0], baseline = true }) {
  const line = sparkline(values, width, height);
  if (!line) return null;
  return (
    <svg
      width={width}
      height={height + 2}
      viewBox={`0 0 ${width} ${height + 2}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {baseline && (
        <line x1="0" y1={line.zeroY} x2={width} y2={line.zeroY} stroke="var(--panel-border)" strokeWidth="1" />
      )}
      <polyline
        points={line.points}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tooltip({ label, value, delta, deltaUp }) {
  return (
    <div className="stc-fund-tip">
      <div className="stc-fund-tip-label">{label}</div>
      <div className="stc-fund-tip-value">{value}</div>
      {delta && (
        <div className="stc-fund-tip-delta" style={{ color: deltaUp ? 'var(--up)' : 'var(--down)' }}>
          {delta}
        </div>
      )}
    </div>
  );
}

const PLOT_H = 132;
const PLOT_W = 320;

// The plot is drawn at the width it actually gets: a viewBox scaled to fit a
// fixed height would letterbox the chart inside a wider card.
// Grafik gerçekte aldığı genişlikte çiziliyor: sabit yüksekliğe sığdırılan bir
// viewBox, daha geniş kartın içinde grafiği ortada bırakıyor.
function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function BarChart({ values, columns, format, refValue, height = PLOT_H, width: fallback = PLOT_W, label }) {
  const [hover, setHover] = useState(null);
  const [ref, width] = useWidth(fallback);
  const axis = scaleOf(values, height);
  const slot = width / values.length;
  const barWidth = Math.min(44, slot - 8);
  const ticks = columns.length > 10 ? columns.map((c, i) => (i % 2 ? '' : c)) : columns;

  const at = hover != null ? values[hover] : null;
  const before = hover != null ? values[hover - 1] : null;
  let delta = null;
  let deltaUp = false;
  if (at != null && before != null && before !== 0) {
    const d = ((at - before) / Math.abs(before)) * 100;
    delta = `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
    deltaUp = d >= 0;
  }

  return (
    <div className="stc-fund-plot" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        width={width}
        height={height + 18}
        role="img"
        aria-label={label}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2={width} y2={height * f} stroke="var(--grid-color)" strokeWidth="1" />
        ))}
        <line x1="0" y1={axis.y(0)} x2={width} y2={axis.y(0)} stroke="var(--separator-hover)" strokeWidth="1" />
        {refValue != null && (
          <line
            x1="0"
            y1={axis.y(refValue)}
            x2={width}
            y2={axis.y(refValue)}
            stroke="var(--text-dim)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {values.map((v, i) => {
          if (v == null) return null;
          const x = i * slot + (slot - barWidth) / 2;
          const dim = hover != null && hover !== i;
          const fill = v < 0 ? 'var(--down)' : SERIES[0];
          return (
            <path
              key={columns[i]}
              d={barPath(x, barWidth, axis.y(0), axis.y(v))}
              fill={fill}
              opacity={dim ? 0.4 : 1}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {values.map((v, i) => (
          <text
            key={`t-${columns[i]}`}
            x={i * slot + slot / 2}
            y={height + 14}
            textAnchor="middle"
            fill={hover === i ? 'var(--text-strong)' : 'var(--text-dim)'}
            fontSize="9.5"
            className="stc-mono"
          >
            {ticks[i]}
          </text>
        ))}
      </svg>
      {at != null && <Tooltip label={columns[hover]} value={format(at)} delta={delta} deltaUp={deltaUp} />}
    </div>
  );
}

export function LineChart({ series, columns, format, height = PLOT_H, width: fallback = PLOT_W, label, reference }) {
  const [ref, width] = useWidth(fallback);
  const all = series.flatMap((s) => s.values);
  const axis = scaleOf(all, height);
  const plotWidth = width - 52;
  const x = (i) => (i / Math.max(columns.length - 1, 1)) * plotWidth;
  const ticks = columns.length > 10 ? columns.map((c, i) => (i % 2 ? '' : c)) : columns;

  // Direct labels carry the identity, so they are pushed apart when two series
  // end close together rather than being dropped.
  // Kimliği uç etiketleri taşıyor; iki seri yakın bitiyorsa etiket atılmıyor,
  // birbirinden itiliyor.
  const ends = series
    .map((s) => {
      const at = s.values.reduce((found, v, i) => (v == null ? found : i), -1);
      if (at < 0) return null;
      return { name: s.name, color: s.color, value: s.values[at], x: x(at), y: axis.y(s.values[at]) };
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  ends.forEach((end, i) => {
    const above = i > 0 ? ends[i - 1].labelY : -Infinity;
    end.labelY = Math.max(end.y + 3.5, above + 12);
  });

  return (
    <div className="stc-fund-plot" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        width={width}
        height={height + 18}
        role="img"
        aria-label={label}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2={plotWidth} y2={height * f} stroke="var(--grid-color)" strokeWidth="1" />
        ))}
        <line x1="0" y1={axis.y(0)} x2={plotWidth} y2={axis.y(0)} stroke="var(--separator-hover)" strokeWidth="1" />
        {reference != null && (
          <line
            x1="0"
            y1={axis.y(reference)}
            x2={plotWidth}
            y2={axis.y(reference)}
            stroke="var(--text-dim)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {series.map((s) => (
          <polyline
            key={s.name}
            points={s.values
              .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${axis.y(v).toFixed(1)}`))
              .filter(Boolean)
              .join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {ends.map((end) => (
          <g key={`end-${end.name}`}>
            <circle cx={end.x} cy={end.y} r="4.5" fill={end.color} stroke="var(--panel-bg)" strokeWidth="2" />
            <text x={end.x + 9} y={end.labelY} fill="var(--text)" fontSize="10" className="stc-mono">
              {format(end.value)}
            </text>
          </g>
        ))}
        {columns.map((c, i) => (
          <text
            key={`t-${c}`}
            x={x(i)}
            y={height + 14}
            textAnchor="middle"
            fill="var(--text-dim)"
            fontSize="9.5"
            className="stc-mono"
          >
            {ticks[i]}
          </text>
        ))}
      </svg>
      <div className="stc-fund-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// Today's figure against the line's own history: the lighter block is the
// middle half of the range, the mark is where it stands now.
// Bugünkü rakam satırın kendi geçmişine karşı: açık blok aralığın ortadaki
// yarısı, işaret şu anki yeri.
export function BandBar({ band, low, high, caption }) {
  return (
    <>
      <div className="stc-fund-band">
        <span className="stc-fund-band-mid" style={{ left: band.bandLeft, width: band.bandWidth }} />
        <span className="stc-fund-band-mark" style={{ left: band.markLeft }} />
      </div>
      <div className="stc-fund-band-foot">
        <span>{low}</span>
        <b>{caption}</b>
        <span>{high}</span>
      </div>
    </>
  );
}
