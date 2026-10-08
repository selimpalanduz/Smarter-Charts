import { useMemo, useState } from 'react';
import { useT } from './i18n.js';
import { useSummary } from './fundApi.js';
import FundTableLayout from './FundTableLayout.jsx';
import FundBoardLayout from './FundBoardLayout.jsx';
import FundExplorerLayout from './FundExplorerLayout.jsx';

// Which measuring stick the figures are stated in. "usd-real" is absent on
// purpose: TÜFE is the wrong deflator for a dollar figure.
// Rakamların hangi ölçüyle yazıldığı. "usd-real" bilerek yok: dolar rakamı
// için TÜFE yanlış deflatör.
const BASES = ['try-real', 'try-nominal', 'usd'];
const PERIODS = ['annual', 'quarter'];
const LAYOUTS = ['table', 'board', 'explorer'];

// Columns shown at once; the series goes back 7 years either way.
// Aynı anda gösterilen kolon sayısı; seri iki durumda da 7 yıl geriye gidiyor.
const WINDOW = { annual: 8, quarter: 12 };

function rowsOf(sections) {
  const out = new Map();
  sections.forEach((section) => {
    section.rows.forEach((row) => out.set(row.key, row));
  });
  return out;
}

// A snapshot over a single quarter's flow is not a ratio anyone means: the
// quarterly view divides by the trailing four quarters instead.
// Tek çeyreğin akışına bölünen bir fotoğraf kimsenin kastettiği oran değil;
// çeyreklik görünüm bunun yerine son dört çeyreğe bölüyor.
function trailing(values, window = 4) {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.some((value) => value == null) ? null : slice.reduce((a, b) => a + b, 0);
  });
}

function divide(top, bottom, factor, period) {
  if (!top || !bottom) return null;
  const numerator = top.kind === 'flow' && period === 'quarter' ? trailing(top.values) : top.values;
  const denominator = bottom.kind === 'flow' && period === 'quarter' ? trailing(bottom.values) : bottom.values;
  return numerator.map((value, i) => {
    const base = denominator[i];
    if (value == null || base == null || base === 0) return null;
    return (value / base) * factor;
  });
}

// Two ratios that are pure statement arithmetic but need rows from two
// sections, so the backend leaves them to whoever assembles the view.
// Saf tablo aritmetiği olan ama iki ayrı bölümün satırını gerektiren iki oran;
// backend bu yüzden görünümü kuran tarafa bırakıyor.
function withDerived(sections, str, period) {
  const rows = rowsOf(sections);
  const extra = [];
  const mark = (name) => (period === 'quarter' ? `${name} (${str.fundTtm})` : name);
  const leverage = divide(rows.get('netDebt'), rows.get('ebitda'), 1, period);
  if (leverage && leverage.some((v) => v != null)) {
    const name = mark(str.fundNetDebtEbitda);
    extra.push({
      key: 'netDebtEbitda',
      label: { tr: name, en: name },
      unit: 'ratio',
      kind: 'stock',
      values: leverage,
    });
  }
  const roe = divide(rows.get('3Z'), rows.get('2N'), 100, period);
  if (roe && roe.some((v) => v != null)) {
    const name = mark(str.fundRoe);
    extra.push({
      key: 'roe',
      label: { tr: name, en: name },
      unit: 'pct',
      kind: 'flow',
      values: roe,
    });
  }
  if (!extra.length) return sections;
  return sections.map((section) =>
    section.id === 'balance' ? { ...section, rows: [...section.rows, ...extra] } : section,
  );
}

export default function FundamentalsView({ symbol }) {
  const str = useT();
  const [basis, setBasis] = useState('try-real');
  const [period, setPeriod] = useState('annual');
  const [layout, setLayout] = useState('table');
  const { data, error, loading } = useSummary(symbol, basis, period);

  const model = useMemo(() => {
    if (!data || data.supported === false) return null;
    const all = data.columns ?? [];
    const take = WINDOW[period] ?? 8;
    const from = Math.max(all.length - take, 0);
    const columns = all.slice(from);
    const sections = withDerived(data.sections ?? [], str, period).map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({ ...row, values: row.values.slice(from) })),
    }));
    return {
      columns,
      sections,
      rows: rowsOf(sections),
      partial: new Set(data.partialColumns ?? []),
      target: data.target,
      basis,
      period,
    };
  }, [data, period, basis, str]);

  const unsupported = data && data.supported === false;

  const note = [
    str.fundBasisHint[basis],
    basis === 'try-real' && data?.target ? str.fundRealBase(data.target) : '',
    model && model.partial.size > 0 ? str.fundPartialNote([...model.partial].join(', ')) : '',
    data?.unitDropped?.length ? str.fundUnitDropped(data.unitDropped.join(', ')) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const Layout = { table: FundTableLayout, board: FundBoardLayout, explorer: FundExplorerLayout }[layout];

  return (
    <div className="stc-fund">
      <style>{FUND_CSS}</style>

      <div className="stc-fund-head">
        <span className="stc-fund-title">
          {symbol} · {str.fundTitle}
        </span>
        <div className="stc-seg" role="group" aria-label={str.fundLayout}>
          {LAYOUTS.map((key) => (
            <button
              key={key}
              type="button"
              className={layout === key ? 'is-active' : ''}
              aria-pressed={layout === key}
              onClick={() => setLayout(key)}
              title={str.fundLayoutHint[key]}
            >
              {str.fundLayoutLabel[key]}
            </button>
          ))}
        </div>
        <div className="stc-vrule" />
        <div className="stc-seg" role="group" aria-label={str.fundBasis}>
          {BASES.map((key) => (
            <button
              key={key}
              type="button"
              className={basis === key ? 'is-active' : ''}
              aria-pressed={basis === key}
              onClick={() => setBasis(key)}
              title={str.fundBasisHint[key]}
            >
              {str.fundBasisLabel[key]}
            </button>
          ))}
        </div>
        <div className="stc-seg" role="group" aria-label={str.fundPeriod}>
          {PERIODS.map((key) => (
            <button
              key={key}
              type="button"
              className={period === key ? 'is-active' : ''}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >
              {str.fundPeriodLabel[key]}
            </button>
          ))}
        </div>
      </div>

      <p className="stc-fund-note">{note}</p>

      {loading && <div className="stc-fund-empty">{str.fundLoading}</div>}
      {error && !loading && <div className="stc-fund-empty">{error}</div>}
      {unsupported && !loading && (
        <div className="stc-fund-empty">
          {data.sector === 'financial' ? str.fundFinancialSector : str.fundNoData(symbol)}
        </div>
      )}

      {!loading && !error && model && (
        <Layout model={model} symbol={symbol} summary={data} />
      )}
    </div>
  );
}

const FUND_CSS = `
.stc-fund {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 28px;
}
.stc-fund-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.stc-fund-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: 0.02em;
}
.stc-fund-note {
  font-size: 11.5px;
  color: var(--text-dim);
  margin: 0 0 18px;
  line-height: 1.5;
  max-width: 120ch;
}
.stc-fund-section { margin-bottom: 26px; }
.stc-fund-section h3,
.stc-fund-card h3 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  margin: 0 0 8px;
}
.stc-fund-scroll { overflow-x: auto; }
.stc-fund table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
}
.stc-fund th, .stc-fund td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--panel-border);
  white-space: nowrap;
}
.stc-fund thead th {
  text-align: right;
  font-weight: 500;
  font-size: 11.5px;
  color: var(--text-dim);
  border-bottom-color: var(--separator-hover);
}
.stc-fund thead th:first-child { text-align: left; }
.stc-fund tbody th {
  text-align: left;
  font-weight: 400;
  color: var(--text);
}
.stc-fund tbody td {
  text-align: right;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
.stc-fund tbody tr:hover th,
.stc-fund tbody tr:hover td { background: var(--btn-bg); }
.stc-fund .is-neg { color: var(--down); }
.stc-fund .is-up { color: var(--up); }
.stc-fund .is-unit {
  color: var(--text-dim);
  font-size: 10.5px;
  margin-left: 5px;
}
.stc-fund .is-partial::after {
  content: '*';
  color: var(--accent);
  margin-left: 2px;
}
.stc-fund-spark { padding: 2px 10px !important; }
.stc-fund-empty {
  padding: 40px 0;
  color: var(--text-dim);
  font-size: 13px;
  max-width: 46ch;
  line-height: 1.6;
}
.stc-fund-foot {
  font-size: 11px;
  color: var(--text-dim);
  margin: 0;
  line-height: 1.6;
  max-width: 100ch;
  border-top: 1px solid var(--panel-border);
  padding-top: 12px;
}
.stc-fund-kpis {
  display: grid;
  gap: 10px;
  margin-bottom: 24px;
}
.stc-fund-kpi {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  padding: 11px 13px 9px;
}
.stc-fund-kpi-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 7px;
}
.stc-fund-kpi-value {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 21px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: -0.01em;
}
.stc-fund-kpi-value span {
  font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--text-dim);
}
.stc-fund-kpi-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11.5px;
}
.stc-fund-card {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  padding: 13px 15px 12px;
}
.stc-fund-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.stc-fund-card-head h3 { margin: 0; }
.stc-fund-card-unit {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--text-dim);
}
.stc-fund-card-sub {
  font-size: 10.5px;
  color: var(--text-dim);
  margin: 4px 0 10px;
  line-height: 1.5;
}
.stc-fund-plot { position: relative; }
.stc-fund-tip {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--page-bg);
  border: 1px solid var(--separator-hover);
  border-radius: 3px;
  padding: 6px 9px;
  pointer-events: none;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
.stc-fund-tip-label { font-size: 10px; color: var(--text-dim); }
.stc-fund-tip-value { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.stc-fund-tip-delta { font-size: 10.5px; }
.stc-fund-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.stc-fund-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--text-dim);
}
.stc-fund-legend i {
  width: 10px;
  height: 2px;
  border-radius: 1px;
}
.stc-fund-band {
  position: relative;
  height: 8px;
  margin: 7px 0 4px;
  background: var(--btn-bg);
  border: 1px solid var(--panel-border);
  border-radius: 2px;
}
.stc-fund-band-mid {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--accent-soft);
}
.stc-fund-band-mark {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--accent);
}
.stc-fund-band-foot {
  display: flex;
  justify-content: space-between;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 9.5px;
  color: var(--text-dim);
}
.stc-fund-band-foot b { font-weight: 500; color: var(--text); }
.stc-fund-open {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 10px 4px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--panel-border);
  color: var(--text);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.stc-fund-open:hover { color: var(--text-strong); }
.stc-fund-open b { font-weight: 600; color: var(--text-strong); }
.stc-fund-open span { color: var(--text-dim); font-size: 11px; }
.stc-fund-split {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: flex-start;
}
.stc-fund-main { flex: 999 1 620px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.stc-fund-rail { flex: 1 1 300px; min-width: 272px; display: flex; flex-direction: column; gap: 14px; }
.stc-fund-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 900px) {
  .stc-fund-grid2 { grid-template-columns: minmax(0, 1fr); }
}
.stc-fund-flag {
  display: flex;
  gap: 9px;
  margin-bottom: 11px;
  font-size: 11.5px;
  line-height: 1.5;
}
.stc-fund-flag svg { flex-shrink: 0; margin-top: 2px; }
.stc-fund-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  line-height: 1.7;
}
.stc-fund-meta b {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-weight: 500;
  color: var(--text-strong);
}
.stc-fund-list {
  flex: 1 1 260px;
  min-width: 248px;
  max-width: 320px;
  align-self: stretch;
  border: 1px solid var(--panel-border);
  border-radius: 3px;
  background: var(--panel-bg);
  padding: 12px 0 14px;
  max-height: 70vh;
  overflow-y: auto;
}
.stc-fund-list h3 { padding: 0 13px; }
.stc-fund-pick {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 5px 11px;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.stc-fund-pick:hover { background: var(--btn-bg); }
.stc-fund-pick.is-active {
  background: var(--btn-bg-hover);
  border-left-color: var(--accent);
  color: var(--text-strong);
}
.stc-fund-pick span {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stc-fund-pick-group {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-dim);
  padding: 10px 13px 4px;
}
.stc-fund-detail { flex: 999 1 560px; min-width: 0; }
.stc-fund-detail-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
}
.stc-fund-detail-head h2 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: 0.01em;
}
.stc-fund-detail-kind {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-dim);
}
.stc-fund-stats { display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
.stc-fund-stat-label {
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 3px;
}
.stc-fund-stat-big {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 26px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: -0.01em;
}
.stc-fund-stat-big span {
  font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-dim);
}
.stc-fund-stat {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 17px;
  font-weight: 600;
}
.stc-fund-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0 10px;
}
.stc-fund-controls > p {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
  flex: 1 1 240px;
}
.stc-fund-chips { display: flex; gap: 7px; flex-wrap: wrap; }
.stc-fund-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--btn-border);
  border-radius: 14px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.stc-fund-chip:hover { border-color: var(--separator-hover); color: var(--text); }
`;
