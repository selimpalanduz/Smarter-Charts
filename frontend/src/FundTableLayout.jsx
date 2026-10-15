import { useT } from './i18n.js';
import { Sparkline } from './FundCharts.jsx';
import { change, FLAT_SCALE, formatCell, overWindow, rowScale, tintFor } from './fundFormat.js';

const KPI_KEYS = ['3C', 'ebitda', '3Z', 'netDebtEbitda', 'roe'];

function scaleFor(row, str) {
  return row.unit === 'currency' ? rowScale(row.values, str.fundScale) : FLAT_SCALE;
}

// The densest reading of a statement set: every line as reported, plus the two
// columns a reader would otherwise work out on paper — the shape of the series
// and its move across the whole window.
// Bir tablo setinin en yoğun okuması: her satır raporlandığı gibi, artı okurun
// yoksa kâğıtta hesaplayacağı iki kolon — serinin biçimi ve pencere boyunca
// değişimi.
export default function FundTableLayout({ model }) {
  const str = useT();
  const { columns, sections, rows, partial, period } = model;
  const suffixes = { pp: str.fundPp };

  const kpis = KPI_KEYS.map((key) => rows.get(key)).filter(Boolean);
  // Where a new year starts, so four quarters read as one block. In the annual
  // view every column is a year and a rule on each one would be noise.
  // Yeni yılın başladığı yer; dört çeyrek tek blok olarak okunsun. Yıllık
  // görünümde her kolon bir yıl, hepsine çizgi koymak gürültü olurdu.
  const yearStarts = new Set(
    period === 'quarter'
      ? columns.filter((column, i) => i > 0 && column.slice(0, 4) !== columns[i - 1].slice(0, 4))
      : [],
  );
  // Half year, dashed: the same landmark one level down.
  // Yarıyıl, kesikli: aynı işaret bir alt kademede.
  const halfStarts = new Set(
    period === 'quarter' ? columns.filter((column, i) => i > 0 && column.endsWith('Q3')) : [],
  );

  return (
    <>
      {kpis.length > 0 && (
        <div className="stc-fund-kpis" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))` }}>
          {kpis.map((row) => {
            const scale = scaleFor(row, str);
            const last = row.values.filter((v) => v != null).slice(-1)[0];
            const delta = change(row.values, row.unit, str.locale, suffixes);
            return (
              <div key={row.key} className="stc-fund-kpi">
                <div className="stc-fund-kpi-label">{row.label[str.langKey] ?? row.label.tr}</div>
                <div className="stc-fund-kpi-value">
                  {formatCell(last, row.unit, scale, str.locale)}
                  <span>{scale.suffix}</span>
                </div>
                <div className="stc-fund-kpi-foot">
                  <span style={{ color: delta ? (delta.up ? 'var(--up)' : 'var(--down)') : 'var(--text-dim)' }}>
                    {delta ? `${delta.text} ${period === 'annual' ? 'y/y' : 'ç/ç'}` : '—'}
                  </span>
                  <Sparkline values={row.values} width={78} height={22} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sections.map((section) => (
        <section key={section.id} className="stc-fund-section">
          <h3>{section.label[str.langKey] ?? section.label.tr}</h3>
          <div className="stc-fund-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '230px' }} />
                  {columns.map((column) => (
                    <th
                      key={column}
                      className={[
                        partial.has(column) ? 'is-partial' : '',
                        yearStarts.has(column) ? 'is-year-start' : '',
                        halfStarts.has(column) ? 'is-half-start' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {column}
                    </th>
                  ))}
                  <th style={{ width: '92px', textAlign: 'center' }}>{str.fundTrend}</th>
                  {/* Wide enough for the Turkish "+24,4 puan"; the English
                      equivalent is shorter.
                      Türkçe "+24,4 puan" sığacak kadar; İngilizcesi daha kısa. */}
                  <th style={{ width: '104px' }}>{str.fundWindow(columns.length - 1)}</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => {
                  const scale = scaleFor(row, str);
                  const ratio = row.unit !== 'currency';
                  const window = overWindow(row.values, row.unit, str.locale, suffixes);
                  return (
                    <tr key={row.key}>
                      <th scope="row">
                        {row.label[str.langKey] ?? row.label.tr}
                        {scale.suffix && <span className="is-unit">{scale.suffix}</span>}
                      </th>
                      {row.values.map((value, i) => (
                        <td
                          key={columns[i]}
                          className={[
                            value != null && value < 0 ? 'is-neg' : '',
                            yearStarts.has(columns[i]) ? 'is-year-start' : '',
                            halfStarts.has(columns[i]) ? 'is-half-start' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={ratio ? { background: tintFor(value, row.values) } : undefined}
                        >
                          {formatCell(value, row.unit, scale, str.locale)}
                        </td>
                      ))}
                      <td className="stc-fund-spark">
                        <Sparkline values={row.values} />
                      </td>
                      <td
                        style={{
                          color:
                            window && window.up != null
                              ? window.up
                                ? 'var(--up)'
                                : 'var(--down)'
                              : 'var(--text-dim)',
                        }}
                      >
                        {window ? window.text : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="stc-fund-foot">{str.fundTintNote}</p>
    </>
  );
}
