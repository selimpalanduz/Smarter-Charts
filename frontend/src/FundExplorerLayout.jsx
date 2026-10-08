import { useEffect, useState } from 'react';
import { SERIES } from './theme.js';
import { useT } from './i18n.js';
import { summaryUrl } from './fundApi.js';
import { BarChart, LineChart, Sparkline } from './FundCharts.jsx';
import { KIND_NOTES, RELATED, ROW_NOTES } from './fundNotes.js';
import { change, FLAT_SCALE, formatCell, indexed, num, overWindow, rowScale } from './fundFormat.js';

const BASES = [
  { key: 'try-real', color: SERIES[0] },
  { key: 'try-nominal', color: SERIES[1] },
  { key: 'usd', color: SERIES[2] },
];

function labelOf(row, str) {
  return row.label[str.langKey] ?? row.label.tr;
}

function scaleFor(row, str) {
  return row.unit === 'currency' ? rowScale(row.values, str.fundScale) : FLAT_SCALE;
}

function last(values) {
  return values.filter((v) => v != null).slice(-1)[0] ?? null;
}

// The same row out of another basis's payload, lined up with the columns the
// view is already showing.
// Aynı satırın başka bir tabanın yanıtındaki hali, görünümün hâlihazırda
// gösterdiği kolonlarla hizalanmış.
function seriesFrom(payload, key, columns) {
  if (!payload) return null;
  const all = payload.columns ?? [];
  for (const section of payload.sections ?? []) {
    for (const row of section.rows) {
      if (row.key !== key) continue;
      return columns.map((column) => {
        const at = all.indexOf(column);
        return at < 0 ? null : row.values[at];
      });
    }
  }
  return null;
}

// One row at a time, with the reading it needs: how it is reported, what it
// relates to, and — in index mode — where the three measuring sticks part.
// Tek satır, ihtiyaç duyduğu okumayla: nasıl raporlandığı, neyle ilişkili
// olduğu ve endeks modunda üç ölçünün nerede ayrıştığı.
export default function FundExplorerLayout({ model, symbol }) {
  const str = useT();
  const { columns, sections, rows, period, basis } = model;
  const suffixes = { pp: str.fundPp };

  const keys = sections.flatMap((section) => section.rows.map((row) => row.key));
  const [picked, setPicked] = useState('3Z');
  const key = rows.has(picked) ? picked : keys[0];
  const row = rows.get(key);

  const unitFree = row && row.unit !== 'currency';
  const [mode, setMode] = useState('level');
  const active = unitFree ? 'level' : mode;
  const [others, setOthers] = useState({});

  useEffect(() => {
    if (active !== 'index') return undefined;
    let cancelled = false;
    const wanted = BASES.filter((entry) => entry.key !== basis);
    Promise.all(
      wanted.map((entry) =>
        fetch(summaryUrl(symbol, entry.key, period))
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
          .then((payload) => [entry.key, payload]),
      ),
    ).then((pairs) => {
      if (!cancelled) setOthers(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [active, symbol, period, basis]);

  if (!row) return null;

  const scale = scaleFor(row, str);
  // The headline figure is the latest period that actually reported, not the
  // latest column — a year in progress leaves the income statement empty.
  // Başlık rakamı son kolon değil, gerçekten raporlayan son dönem; süren yıl
  // gelir tablosunu boş bırakıyor.
  const reportedAt = row.values.reduce((at, value, i) => (value == null ? at : i), 0);
  const delta = change(row.values, row.unit, str.locale, suffixes);
  const window = overWindow(row.values, row.unit, str.locale, suffixes);
  const note = ROW_NOTES[key]?.[str.langKey] ?? KIND_NOTES[row.kind]?.[str.langKey] ?? '';
  const related = (RELATED[key] ?? []).map((other) => rows.get(other)).filter(Boolean);
  const format = (value) => `${formatCell(value, row.unit, scale, str.locale)} ${scale.suffix}`.trim();

  const indexSeries = BASES.map((entry) => {
    const values = entry.key === basis ? row.values : seriesFrom(others[entry.key], key, columns);
    const series = values ? indexed(values) : null;
    return series ? { name: str.fundBasisLabel[entry.key], color: entry.color, values: series } : null;
  }).filter(Boolean);

  return (
    <div className="stc-fund-split">
      <div className="stc-fund-list">
        <h3>{str.fundRows}</h3>
        {sections.map((section) => (
          <div key={section.id}>
            <div className="stc-fund-pick-group">{section.label[str.langKey] ?? section.label.tr}</div>
            {section.rows.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`stc-fund-pick${item.key === key ? ' is-active' : ''}`}
                aria-pressed={item.key === key}
                aria-label={str.fundPickLine(labelOf(item, str))}
                onClick={() => setPicked(item.key)}
              >
                <span>{labelOf(item, str)}</span>
                <Sparkline
                  values={item.values}
                  width={54}
                  height={14}
                  baseline={false}
                  color={item.key === key ? 'var(--accent)' : 'var(--crosshair)'}
                />
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="stc-fund-detail">
        <div className="stc-fund-detail-head">
          <div>
            <h2>{labelOf(row, str)}</h2>
            <div className="stc-fund-detail-kind">
              {key} · {unitFree ? str.fundKindDerived : str.fundKindLabel[row.kind]}
            </div>
          </div>
          <div className="stc-fund-stats">
            <div>
              <div className="stc-fund-stat-label">{columns[reportedAt]}</div>
              <div className="stc-fund-stat-big">
                {formatCell(row.values[reportedAt], row.unit, scale, str.locale)}
                <span>{scale.suffix}</span>
              </div>
            </div>
            <div>
              <div className="stc-fund-stat-label">{str.fundDeltaHead[period]}</div>
              <b
                className="stc-fund-stat"
                style={{ color: delta ? (delta.up ? 'var(--up)' : 'var(--down)') : 'var(--text-dim)' }}
              >
                {delta ? delta.text : '—'}
              </b>
            </div>
            <div>
              <div className="stc-fund-stat-label">{str.fundWindowHead(columns.length - 1)}</div>
              <b
                className="stc-fund-stat"
                style={{
                  color: window && window.up != null ? (window.up ? 'var(--up)' : 'var(--down)') : 'var(--text-dim)',
                }}
              >
                {window ? window.text : '—'}
              </b>
            </div>
          </div>
        </div>

        <div className="stc-fund-controls">
          {!unitFree && (
            <div className="stc-seg" role="group" aria-label={str.fundLayout}>
              {['level', 'index'].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={active === option ? 'is-active' : ''}
                  aria-pressed={active === option}
                  onClick={() => setMode(option)}
                  title={str.fundModeHint[option]}
                >
                  {str.fundModeLabel[option]}
                </button>
              ))}
            </div>
          )}
          <p>{unitFree ? str.fundRatioNote : active === 'index' ? str.fundIndexNote : str.fundLevelNote}</p>
        </div>

        <div className="stc-fund-card">
          {active === 'index' ? (
            <LineChart
              series={indexSeries}
              columns={columns}
              width={640}
              height={206}
              reference={100}
              format={(value) => num(value, str.locale, 0)}
              label={indexSeries.map((s) => `${s.name} ${num(last(s.values), str.locale, 0)}`).join(', ')}
            />
          ) : (
            <BarChart
              values={row.values}
              columns={columns}
              width={640}
              height={206}
              format={format}
              label={`${labelOf(row, str)} — ${columns[0]} → ${columns[columns.length - 1]}`}
            />
          )}
        </div>

        <div className="stc-fund-split" style={{ marginTop: '18px' }}>
          <div className="stc-fund-scroll" style={{ flex: '999 1 420px', minWidth: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: '92px' }} />
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{str.fundLevelRow}</th>
                  {row.values.map((value, i) => (
                    <td key={columns[i]} className={value != null && value < 0 ? 'is-neg' : ''}>
                      {formatCell(value, row.unit, scale, str.locale)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{str.fundChangeRow}</th>
                  {row.values.map((value, i) => {
                    const before = row.values[i - 1];
                    if (value == null || before == null || before === 0) {
                      return (
                        <td key={columns[i]} style={{ color: 'var(--text-dim)' }}>
                          —
                        </td>
                      );
                    }
                    const d = unitFree ? value - before : ((value - before) / Math.abs(before)) * 100;
                    return (
                      <td key={columns[i]} className={d >= 0 ? 'is-up' : 'is-neg'}>
                        {`${d >= 0 ? '+' : ''}${num(d, str.locale, unitFree ? 1 : 0)}${unitFree ? ` ${str.fundPp}` : '%'}`}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="stc-fund-card" style={{ flex: '1 1 280px', minWidth: '264px' }}>
            <h3>{str.fundAbout}</h3>
            <p className="stc-fund-card-sub" style={{ fontSize: '11.5px', color: 'var(--text)', margin: '0 0 12px' }}>
              {note}
            </p>
            {related.length > 0 && (
              <div className="stc-fund-chips">
                {related.map((other) => (
                  <button key={other.key} type="button" className="stc-fund-chip" onClick={() => setPicked(other.key)}>
                    {labelOf(other, str)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
