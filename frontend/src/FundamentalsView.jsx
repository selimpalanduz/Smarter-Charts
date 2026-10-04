import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

// Which measuring stick the figures are stated in. "usd-real" is absent on
// purpose: TÜFE is the wrong deflator for a dollar figure.
// Rakamların hangi ölçüyle yazıldığı. "usd-real" bilerek yok: dolar rakamı
// için TÜFE yanlış deflatör.
const BASES = ['try-real', 'try-nominal', 'usd'];
const PERIODS = ['annual', 'quarter'];
// Columns shown at once; the series goes back 7 years.
// Aynı anda gösterilen kolon sayısı; seri 7 yıl geriye gidiyor.
const MAX_COLUMNS = 8;

// A row picks its own unit from its largest value, so the figures stay short
// and the columns stay aligned.
// Satır birimini kendi en büyük değerinden seçiyor; böylece rakamlar kısa,
// kolonlar hizalı kalıyor.
function rowScale(values) {
  const peak = Math.max(...values.filter((v) => v != null).map(Math.abs), 0);
  if (peak >= 1e9) return { divisor: 1e9, suffix: 'mr' };
  if (peak >= 1e6) return { divisor: 1e6, suffix: 'mn' };
  if (peak >= 1e3) return { divisor: 1e3, suffix: 'bin' };
  return { divisor: 1, suffix: '' };
}

function formatCell(value, unit, scale, locale) {
  if (value == null) return '—';
  if (unit === 'pct') {
    return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  return (value / scale.divisor).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export default function FundamentalsView({ symbol }) {
  const str = useT();
  const [basis, setBasis] = useState('try-real');
  const [period, setPeriod] = useState('annual');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = `${API_BASE}/api/fundamentals/summary/${symbol}?basis=${basis}&period=${period}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(str.fundLoadFailed);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, basis, period, str.fundLoadFailed]);

  const columns = (data?.columns ?? []).slice(-MAX_COLUMNS);
  const allColumns = data?.columns ?? [];
  const partial = new Set(data?.partialColumns ?? []);
  const unsupported = data && data.supported === false;

  return (
    <div className="stc-fund">
      <style>{`
        .stc-fund {
          flex-grow: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 18px 22px 28px;
        }
        .stc-fund-head {
          display: flex;
          align-items: center;
          gap: 14px;
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
        }
        .stc-fund-section { margin-bottom: 26px; }
        .stc-fund-section h3 {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-dim);
          margin: 0 0 8px;
        }
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
          border-bottom-color: var(--text-dim);
        }
        .stc-fund thead th:first-child { text-align: left; }
        .stc-fund tbody th {
          text-align: left;
          font-weight: 400;
          color: var(--text);
        }
        .stc-fund tbody td { text-align: right; }
        .stc-fund .is-neg { color: var(--down); }
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
        .stc-fund-empty {
          padding: 40px 0;
          color: var(--text-dim);
          font-size: 13px;
          max-width: 46ch;
          line-height: 1.6;
        }
      `}</style>

      <div className="stc-fund-head">
        <span className="stc-fund-title">
          {symbol} · {str.fundTitle}
        </span>
        <div className="stc-seg" role="group" aria-label={str.fundBasis}>
          {BASES.map((key) => (
            <button
              key={key}
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
              className={period === key ? 'is-active' : ''}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >
              {str.fundPeriodLabel[key]}
            </button>
          ))}
        </div>
      </div>

      <p className="stc-fund-note">
        {str.fundBasisHint[basis]}
        {basis === 'try-real' && data?.target ? ` ${str.fundRealBase(data.target)}` : ''}
        {partial.size > 0 ? ` ${str.fundPartialNote([...partial].join(', '))}` : ''}
        {data?.unitDropped?.length ? ` ${str.fundUnitDropped(data.unitDropped.join(', '))}` : ''}
      </p>

      {loading && <div className="stc-fund-empty">{str.fundLoading}</div>}
      {error && !loading && <div className="stc-fund-empty">{error}</div>}
      {unsupported && !loading && (
        <div className="stc-fund-empty">
          {data.sector === 'financial' ? str.fundFinancialSector : str.fundNoData(symbol)}
        </div>
      )}

      {!loading &&
        !error &&
        !unsupported &&
        (data?.sections ?? []).map((section) => (
          <section key={section.id} className="stc-fund-section">
            <h3>{section.label[str.langKey] ?? section.label.tr}</h3>
            <table>
              <thead>
                <tr>
                  <th />
                  {columns.map((column) => (
                    <th key={column} className={partial.has(column) ? 'is-partial' : ''}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => {
                  const shown = columns.map((column) => row.values[allColumns.indexOf(column)]);
                  const scale = row.unit === 'pct' ? { divisor: 1, suffix: '' } : rowScale(shown);
                  return (
                    <tr key={row.key}>
                      <th scope="row">
                        {row.label[str.langKey] ?? row.label.tr}
                        {scale.suffix && <span className="is-unit">{scale.suffix}</span>}
                      </th>
                      {shown.map((value, i) => (
                        <td key={columns[i]} className={value != null && value < 0 ? 'is-neg' : ''}>
                          {formatCell(value, row.unit, scale, str.locale)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
    </div>
  );
}
