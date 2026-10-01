import { useEffect, useRef, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

const POLL_MS = 2000;
// Roughly the 2.5% one-sided tail: this many stocks pass by chance alone.
// Kabaca tek taraflı %2.5'lik kuyruk: bu kadar hisse sadece şansla geçer.
const SIGNIFICANT_Z = 2;
const CHANCE_SHARE = 0.025;
const NEAR_HIGH_PCT = 10;
const MIN_HIGH_TESTS = 3;
const VIEWS = ['round', 'high52'];

const cell = { padding: '6px 8px', textAlign: 'right' };
const firstCell = { ...cell, textAlign: 'left' };
const headRow = { color: 'var(--text-dim)', fontSize: '11px', position: 'sticky', top: 0, background: 'var(--panel-bg)' };

async function fetchScan(start) {
  const res = await fetch(`${API_BASE}/api/scan/anchors${start ? '?start=true' : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function signed(value, digits = 1) {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function excess(h) {
  return h.forwardPct != null && h.baselinePct != null ? h.forwardPct - h.baselinePct : null;
}

function ScanTable({ head, children }) {
  return (
    <div style={{ overflowY: 'auto', maxHeight: '420px', border: '1px solid var(--panel-border)', borderRadius: '3px' }}>
      <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="stc-mono" style={headRow}>{head}</tr>
        </thead>
        <tbody className="stc-mono">{children}</tbody>
      </table>
    </div>
  );
}

function RoundView({ results, onSelectSymbol }) {
  const t = useT();
  const rows = results.filter((r) => r.round).sort((a, b) => b.round.z - a.round.z);
  const significant = rows.filter((r) => r.round.z >= SIGNIFICANT_Z).length;
  return (
    <>
      <span style={{ opacity: 0.75, lineHeight: 1.45 }}>{t.anchorScanIntro}</span>
      <ScanTable
        head={
          <>
            <th style={firstCell}>{t.colSymbol}</th>
            <th style={cell} title={t.colRoundTitle}>{t.colRound}</th>
            <th style={cell} title={t.colOtherTitle}>{t.colOther}</th>
            <th style={cell}>{t.colEdge}</th>
            <th style={cell} title={t.colZTitle}>z</th>
          </>
        }
      >
        {rows.map(({ symbol, round: r }) => (
          <tr key={symbol} className="stc-row" onClick={() => onSelectSymbol(symbol)} title={t.anchorScanRowTitle(r.tests)}>
            <td style={{ ...firstCell, color: 'var(--text-strong)', fontWeight: 600 }}>{symbol}</td>
            <td style={cell}>{r.roundRate.toFixed(0)}%</td>
            <td style={{ ...cell, color: 'var(--text-dim)' }}>{r.controlRate.toFixed(0)}%</td>
            <td style={{ ...cell, color: r.edge >= 0 ? 'var(--up)' : 'var(--down)' }}>{signed(r.edge)}</td>
            <td style={{ ...cell, fontWeight: r.z >= SIGNIFICANT_Z ? 700 : 400, opacity: r.z >= SIGNIFICANT_Z ? 1 : 0.6 }}>{r.z.toFixed(1)}</td>
          </tr>
        ))}
      </ScanTable>
      <span style={{ opacity: 0.55, fontSize: '11.5px', lineHeight: 1.45 }}>
        {t.anchorScanChance(significant, Math.round(rows.length * CHANCE_SHARE), rows.length)}
      </span>
    </>
  );
}

function High52View({ results, onSelectSymbol }) {
  const t = useT();
  const all = results.map((r) => r.high52).filter((h) => h?.tests);
  const tests = all.reduce((sum, h) => sum + h.tests, 0);
  const broke = all.reduce((sum, h) => sum + h.broke, 0);
  const excesses = all.map(excess).filter((v) => v != null);
  const avgExcess = excesses.length ? excesses.reduce((a, b) => a + b, 0) / excesses.length : null;

  const rows = results
    .filter((r) => r.high52 && r.high52.distancePct >= -NEAR_HIGH_PCT && r.high52.tests >= MIN_HIGH_TESTS)
    .sort((a, b) => b.high52.broke / b.high52.tests - a.high52.broke / a.high52.tests || b.high52.tests - a.high52.tests);

  return (
    <>
      <span style={{ opacity: 0.75, lineHeight: 1.45 }}>{t.high52ScanIntro(NEAR_HIGH_PCT)}</span>
      {tests > 0 && avgExcess != null && (
        <span className="stc-mono" style={{ fontSize: '12px' }}>
          {t.high52ScanMarket(((broke / tests) * 100).toFixed(0), signed(avgExcess))}
        </span>
      )}
      {rows.length === 0 && <span className="stc-muted">{t.high52ScanEmpty}</span>}
      {rows.length > 0 && (
        <ScanTable
          head={
            <>
              <th style={firstCell}>{t.colSymbol}</th>
              <th style={cell}>{t.anchorDistance}</th>
              <th style={cell} title={t.colBrokeTitle}>{t.colBroke}</th>
              <th style={cell} title={t.colExcessTitle}>{t.colExcess}</th>
            </>
          }
        >
          {rows.map(({ symbol, high52: h }) => {
            const ex = excess(h);
            return (
              <tr key={symbol} className="stc-row" onClick={() => onSelectSymbol(symbol)}>
                <td style={{ ...firstCell, color: 'var(--text-strong)', fontWeight: 600 }}>{symbol}</td>
                <td style={cell}>{signed(h.distancePct)}%</td>
                <td style={cell}>
                  {h.broke}/{h.tests}
                  <span style={{ opacity: 0.6 }}> · {((h.broke / h.tests) * 100).toFixed(0)}%</span>
                </td>
                <td style={{ ...cell, color: ex == null ? 'var(--text-dim)' : ex >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {ex == null ? '-' : signed(ex)}
                </td>
              </tr>
            );
          })}
        </ScanTable>
      )}
      <span style={{ opacity: 0.55, fontSize: '11.5px', lineHeight: 1.45 }}>{t.high52ScanNote}</span>
    </>
  );
}

function AnchorScanWidget({ onSelectSymbol }) {
  const [scan, setScan] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('round');
  const timerRef = useRef(null);
  const t = useT();

  async function load(start = false) {
    clearTimeout(timerRef.current);
    try {
      const data = await fetchScan(start);
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
  // Results saved before the 52-week view existed lack its fields.
  // 52 haftalık görünümden önce kaydedilen sonuçlarda bu alanlar yok.
  const results = (scan?.results ?? []).filter((r) => 'high52' in r && typeof r.high52 === 'object');
  const View = view === 'round' ? RoundView : High52View;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="stc-panel-title">{t.anchorScanTitle}</span>
        <button className="stc-btn" onClick={() => load(true)} disabled={!scan || running}>
          {running ? t.anchorScanProgress(scan.done, scan.total) : results.length ? t.refresh : t.scan}
        </button>
      </div>

      <div className="stc-seg" role="group" style={{ alignSelf: 'flex-start' }}>
        {VIEWS.map((id) => (
          <button key={id} className={view === id ? 'is-active' : ''} aria-pressed={view === id} onClick={() => setView(id)}>
            {t.anchorScanViews[id]}
          </button>
        ))}
      </div>

      {error && <span style={{ color: 'var(--down)', fontSize: '12px' }}>{error}</span>}
      {scan?.updatedAt && <span style={{ opacity: 0.5, fontSize: '11.5px' }}>{t.anchorScanUpdated(scan.updatedAt)}</span>}
      {scan && !results.length && !running && <span className="stc-muted">{t.anchorScanHint}</span>}

      {results.length > 0 && <View results={results} onSelectSymbol={onSelectSymbol} />}
    </div>
  );
}

export default AnchorScanWidget;
