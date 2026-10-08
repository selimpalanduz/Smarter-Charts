import { useState } from 'react';
import { SERIES } from './theme.js';
import { useT } from './i18n.js';
import { BandBar, BarChart, LineChart } from './FundCharts.jsx';
import { band, change, FLAT_SCALE, formatCell, num, rowScale } from './fundFormat.js';

const KPI_KEYS = ['3C', 'ebitda', '3Z', 'netMargin'];
const MARGIN_KEYS = ['grossMargin', 'operatingMargin', 'netMargin'];
const WARN = 'M7 1.5 L13 12.5 L1 12.5 Z M7 5.5 L7 8.5 M7 10.3 L7 10.4';
const OK = 'M2 7 L5.5 10.5 L12 3.5';

function labelOf(row, str) {
  return row.label[str.langKey] ?? row.label.tr;
}

function scaleFor(row, str) {
  return row.unit === 'currency' ? rowScale(row.values, str.fundScale) : FLAT_SCALE;
}

function median(values) {
  const seen = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!seen.length) return null;
  const mid = Math.floor(seen.length / 2);
  return seen.length % 2 ? seen[mid] : (seen[mid - 1] + seen[mid]) / 2;
}

function last(values) {
  return values.filter((v) => v != null).slice(-1)[0] ?? null;
}

// How many periods the line has fallen without interruption, counting back
// from the latest one.
// Satırın sondan geriye doğru kesintisiz kaç dönem düştüğü.
function fallingStreak(values) {
  const seen = values.filter((v) => v != null);
  let n = 0;
  for (let i = seen.length - 1; i > 0; i -= 1) {
    if (seen[i] >= seen[i - 1]) break;
    n += 1;
  }
  return n;
}

// Checks run over the statements themselves, so each one can be pointed back
// at the row it came from rather than being a judgement call.
// Kontroller tabloların kendisi üzerinde çalışıyor; her biri bir yorum değil,
// geldiği satıra işaret edebilen bir sonuç.
function checksFor(rows, str) {
  const out = [];
  const fcf = rows.get('4CB');
  if (fcf) {
    const streak = fallingStreak(fcf.values);
    if (streak >= 3) out.push({ icon: WARN, color: 'var(--accent)', text: str.fundFlagFcf(streak) });
  }
  const leverage = rows.get('netDebtEbitda');
  if (leverage) {
    const now = last(leverage.values);
    const mid = median(leverage.values);
    if (now != null && mid != null && now > mid) {
      out.push({ icon: WARN, color: 'var(--accent)', text: str.fundFlagLeverage(`${num(now, str.locale, 1)}x`) });
    }
  }
  const net = rows.get('netMargin');
  const operating = rows.get('operatingMargin');
  if (net && operating) {
    const gaps = operating.values
      .map((v, i) => (v == null || net.values[i] == null ? null : v - net.values[i]))
      .filter((v) => v != null);
    const now = gaps[gaps.length - 1];
    const mid = median(gaps);
    if (now != null && mid != null && mid > 0 && now > mid * 1.5) {
      out.push({ icon: WARN, color: 'var(--accent)', text: str.fundFlagMargin });
    }
  }
  const cash = rows.get('4C');
  const profit = rows.get('3Z');
  if (cash && profit) {
    const cashNow = last(cash.values);
    const profitNow = last(profit.values);
    if (cashNow != null && profitNow != null && profitNow > 0 && cashNow < profitNow * 0.6) {
      out.push({ icon: WARN, color: 'var(--accent)', text: str.fundFlagCash });
    }
  }
  if (!out.length) out.push({ icon: OK, color: 'var(--up)', text: str.fundFlagNone });
  return out;
}

// The scanning view: the four lines a reader opens with as charts, the ratio
// bands beside them, and the tables folded away until asked for.
// Tarama görünümü: okurun ilk baktığı dört satır grafik olarak, yanında oran
// bantları, tablolar istenene kadar katlı.
export default function FundBoardLayout({ model, summary }) {
  const str = useT();
  const { columns, sections, rows, partial, period, basis } = model;
  const [open, setOpen] = useState(sections[0]?.id ?? null);
  const suffixes = { pp: str.fundPp };

  const kpis = KPI_KEYS.map((key) => rows.get(key)).filter(Boolean);
  const margins = MARGIN_KEYS.map((key, i) => {
    const row = rows.get(key);
    return row ? { name: labelOf(row, str), color: SERIES[i], values: row.values } : null;
  }).filter(Boolean);

  const bars = ['3C', '3Z', 'netDebtEbitda']
    .map((key) => rows.get(key))
    .filter(Boolean)
    .map((row) => {
      const scale = scaleFor(row, str);
      return {
        row,
        scale,
        format: (value) => `${formatCell(value, row.unit, scale, str.locale)} ${scale.suffix}`.trim(),
        reference: row.unit === 'ratio' ? median(row.values) : null,
      };
    });

  const bandRows = sections
    .flatMap((section) => section.rows)
    .filter((row) => row.unit === 'pct' || row.unit === 'ratio')
    .map((row) => ({ row, band: band(row.values) }))
    .filter((entry) => entry.band)
    .slice(0, 5);

  const checks = checksFor(rows, str);

  return (
    <div className="stc-fund-split">
      <div className="stc-fund-main">
        {kpis.length > 0 && (
          <div className="stc-fund-kpis" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))`, marginBottom: 0 }}>
            {kpis.map((row) => {
              const scale = scaleFor(row, str);
              const delta = change(row.values, row.unit, str.locale, suffixes);
              return (
                <div key={row.key} className="stc-fund-kpi">
                  <div className="stc-fund-kpi-label">{labelOf(row, str)}</div>
                  <div className="stc-fund-kpi-value">
                    {formatCell(last(row.values), row.unit, scale, str.locale)}
                    <span>{scale.suffix}</span>
                  </div>
                  <div
                    className="stc-fund-kpi-foot"
                    style={{ color: delta ? (delta.up ? 'var(--up)' : 'var(--down)') : 'var(--text-dim)' }}
                  >
                    <span>{delta ? `${delta.text} ${period === 'annual' ? 'y/y' : 'ç/ç'}` : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="stc-fund-grid2">
          {bars.map(({ row, scale, format, reference }) => (
            <div key={row.key} className="stc-fund-card">
              <div className="stc-fund-card-head">
                <h3>{labelOf(row, str)}</h3>
                <span className="stc-fund-card-unit">{scale.suffix || (row.unit === 'ratio' ? 'x' : '')}</span>
              </div>
              <p className="stc-fund-card-sub">{reference != null ? str.fundMedianNote : str.fundLevelNote}</p>
              <BarChart
                values={row.values}
                columns={columns}
                format={format}
                refValue={reference}
                label={`${labelOf(row, str)} — ${columns[0]} → ${columns[columns.length - 1]}`}
              />
            </div>
          ))}

          {margins.length > 0 && (
            <div className="stc-fund-card">
              <div className="stc-fund-card-head">
                <h3>{str.fundMarginsTitle}</h3>
                <span className="stc-fund-card-unit">%</span>
              </div>
              <p className="stc-fund-card-sub">{str.fundRatioNote}</p>
              <LineChart
                series={margins}
                columns={columns}
                format={(value) => `${num(value, str.locale, 1)}%`}
                label={margins.map((s) => `${s.name} ${num(last(s.values), str.locale, 1)}%`).join(', ')}
              />
            </div>
          )}
        </div>

        <div className="stc-fund-card" style={{ padding: '2px 15px 8px' }}>
          {sections.map((section) => (
            <div key={section.id}>
              <button
                type="button"
                className="stc-fund-open"
                aria-expanded={open === section.id}
                onClick={() => setOpen(open === section.id ? null : section.id)}
              >
                <b>{section.label[str.langKey] ?? section.label.tr}</b>
                <span>{section.rows.length}</span>
              </button>
              {open === section.id && (
                <div className="stc-fund-scroll" style={{ padding: '6px 0 14px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ minWidth: '180px' }} />
                        {columns.map((column) => (
                          <th key={column} className={partial.has(column) ? 'is-partial' : ''}>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row) => {
                        const scale = scaleFor(row, str);
                        return (
                          <tr key={row.key}>
                            <th scope="row">
                              {labelOf(row, str)}
                              {scale.suffix && <span className="is-unit">{scale.suffix}</span>}
                            </th>
                            {row.values.map((value, i) => (
                              <td key={columns[i]} className={value != null && value < 0 ? 'is-neg' : ''}>
                                {formatCell(value, row.unit, scale, str.locale)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="stc-fund-rail">
        <div className="stc-fund-card">
          <h3>{str.fundBandTitle}</h3>
          <p className="stc-fund-card-sub">{str.fundBandNote}</p>
          {bandRows.map(({ row, band: bar }) => (
            <div key={row.key} style={{ marginBottom: '15px' }}>
              <div className="stc-fund-card-head">
                <span style={{ fontSize: '11.5px' }}>{labelOf(row, str)}</span>
                <b className="stc-mono" style={{ fontSize: '14px', color: 'var(--text-strong)' }}>
                  {formatCell(bar.value, row.unit, FLAT_SCALE, str.locale)}
                </b>
              </div>
              <BandBar
                band={bar}
                low={formatCell(bar.low, row.unit, FLAT_SCALE, str.locale)}
                high={formatCell(bar.high, row.unit, FLAT_SCALE, str.locale)}
                caption={str.fundBandPercentile(bar.percentile)}
              />
            </div>
          ))}
          <p className="stc-fund-card-sub" style={{ margin: '4px 0 0' }}>{str.fundValuationSoon}</p>
        </div>

        <div className="stc-fund-card">
          <h3>{str.fundFlagsTitle}</h3>
          {checks.map((check) => (
            <div key={check.text} className="stc-fund-flag">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d={check.icon} fill="none" stroke={check.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{check.text}</span>
            </div>
          ))}
        </div>

        <div className="stc-fund-card">
          <h3>{str.fundDataTitle}</h3>
          <div className="stc-fund-meta">
            <span>{str.fundDataColumns}</span>
            <b>{summary?.columns?.length ?? columns.length}</b>
          </div>
          <div className="stc-fund-meta">
            <span>{str.fundDataLast}</span>
            <b>{columns[columns.length - 1]}</b>
          </div>
          <div className="stc-fund-meta">
            <span>{str.fundDataBasis}</span>
            <b>{str.fundBasisLabel[basis]}</b>
          </div>
          <div className="stc-fund-meta">
            <span>{str.fundDataPartial}</span>
            <b style={{ color: partial.size ? 'var(--accent)' : undefined }}>{partial.size}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
