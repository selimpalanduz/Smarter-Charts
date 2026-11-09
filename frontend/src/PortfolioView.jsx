import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from './i18n.js';
import { SERIES } from './theme.js';
import SymbolPicker from './SymbolPicker.jsx';
import { addAction, addTrade, deleteTrade, fetchTrades, useOverview } from './portfolioApi.js';

// The portfolio line and the benchmark line, in that order. Two series, so a
// legend is always on screen and both lines are labelled at their own end --
// identity never rests on colour alone.
// Portföy çizgisi ve ölçüt çizgisi, bu sırayla. İki seri var; bu yüzden
// gösterge her zaman ekranda ve iki çizgi kendi ucunda etiketli — kimlik
// hiçbir zaman yalnızca renge dayanmıyor.
const LINE_PORTFOLIO = SERIES[0];
const LINE_BENCHMARK = SERIES[1];

const CHART_HEIGHT = 260;
const PAD = { top: 16, right: 76, bottom: 26, left: 68 };

const DEFAULT_BENCHMARK = 'XU100';

function money(value, locale, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value, locale) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function signed(value, locale, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return sign + money(value, locale, digits);
}

// Gain and loss carry a sign in the text as well as a colour, so the sign
// survives a colour-blind reader, a greyscale print and a forced-colours mode.
// Kâr ve zarar metinde de işaret taşıyor, renkte de; böylece işaret renk körü
// bir okuyucuda, gri baskıda ve zorlanmış renk modunda da ayakta kalıyor.
function toneOf(value) {
  if (value == null || Math.abs(value) < 0.005) return 'stc-pf-flat';
  return value > 0 ? 'stc-pf-up' : 'stc-pf-down';
}

function useWidth(ref) {
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width;
      if (next) setWidth(next);
    });
    observer.observe(node);
    setWidth(node.clientWidth || 720);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const first = Math.ceil(min / step) * step;
  const out = [];
  for (let v = first; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

function ValueChart({ series, benchSeries, benchSymbol, locale, str }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!series || series.length < 2) return null;
    const ours = series.map((r) => r.total);
    const theirs = benchSeries && benchSeries.length === series.length ? benchSeries.map((r) => r.total) : null;
    const pool = theirs ? ours.concat(theirs) : ours;
    // No forced zero baseline. Both lines start at the same lira on the day of
    // the first trade, so what the reader is here for is the gap that opens
    // between them; anchoring at zero squeezes that gap into a sliver. A zero
    // baseline is a bar-chart rule, not a line-chart one.
    // Sıfır taban zorlanmıyor. İki çizgi de ilk işlem günü aynı liradan
    // başlıyor; okuyanın derdi aralarında açılan fark. Sıfıra çakmak o farkı
    // kıl payı bir şeye sıkıştırıyor. Sıfır taban çubuk grafiğin kuralı,
    // çizginin değil.
    const lo = Math.min(...pool);
    const hi = Math.max(...pool);
    const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(Math.abs(hi) * 0.08, 1);
    const min = Math.max(lo - pad, 0);
    const max = hi + pad;
    const plotW = Math.max(width - PAD.left - PAD.right, 10);
    const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (series.length === 1 ? 0 : (i / (series.length - 1)) * plotW);
    const y = (v) => PAD.top + (max === min ? plotH / 2 : (1 - (v - min) / (max - min)) * plotH);
    const path = (values) => values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return {
      min,
      max,
      x,
      y,
      plotW,
      plotH,
      ours,
      theirs,
      oursPath: path(ours),
      theirsPath: theirs ? path(theirs) : null,
      ticks: niceTicks(min, max),
    };
  }, [series, benchSeries, width]);

  function onMove(event) {
    if (!model) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const ratio = (px - PAD.left) / model.plotW;
    const index = Math.round(ratio * (series.length - 1));
    setHover(Math.min(Math.max(index, 0), series.length - 1));
  }

  if (!model) {
    return (
      <div className="stc-pf-chart-empty stc-muted" ref={wrapRef}>
        {str.pfChartTooShort}
      </div>
    );
  }

  const last = series.length - 1;
  // When the two lines finish close together their end labels would sit on top
  // of each other, so they are pushed apart around their midpoint. The lines
  // themselves are untouched -- only the text moves.
  // İki çizgi birbirine yakın bittiğinde uç etiketleri üst üste binerdi; bu
  // yüzden orta noktaları etrafında ayrılıyorlar. Çizgilere dokunulmuyor,
  // sadece yazı kayıyor.
  const endLabels = (() => {
    const ourY = model.y(model.ours[last]);
    if (!model.theirs) return { ourY, theirY: null };
    const theirY = model.y(model.theirs[last]);
    const gap = Math.abs(ourY - theirY);
    const need = 13;
    if (gap >= need) return { ourY, theirY };
    const mid = (ourY + theirY) / 2;
    const half = need / 2;
    return ourY <= theirY
      ? { ourY: mid - half, theirY: mid + half }
      : { ourY: mid + half, theirY: mid - half };
  })();
  const point = hover == null ? null : series[hover];
  const benchPoint = hover == null || !model.theirs ? null : benchSeries[hover];
  const tipX = hover == null ? 0 : model.x(hover);
  const tipSide = tipX > width / 2 ? -1 : 1;

  return (
    <div className="stc-pf-chart" ref={wrapRef}>
      <div className="stc-pf-legend">
        <span className="stc-pf-legend-item">
          <span className="stc-pf-swatch" style={{ background: LINE_PORTFOLIO }} />
          {str.pfChartPortfolio}
        </span>
        {model.theirs && (
          <span className="stc-pf-legend-item">
            <span className="stc-pf-swatch" style={{ background: LINE_BENCHMARK }} />
            {str.pfChartBenchmark(benchSymbol)}
          </span>
        )}
        <span className="stc-pf-legend-note stc-muted">{str.pfChartNote}</span>
      </div>

      <svg
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        role="img"
        aria-label={str.pfChartAria}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {model.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={model.y(tick)}
              x2={width - PAD.right}
              y2={model.y(tick)}
              stroke="var(--grid-color)"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={model.y(tick) + 4} textAnchor="end" className="stc-pf-axis">
              {money(tick, locale)}
            </text>
          </g>
        ))}

        <text x={PAD.left} y={CHART_HEIGHT - 8} textAnchor="start" className="stc-pf-axis">
          {series[0].date}
        </text>
        <text x={width - PAD.right} y={CHART_HEIGHT - 8} textAnchor="end" className="stc-pf-axis">
          {series[last].date}
        </text>

        {model.theirsPath && (
          <polyline
            points={model.theirsPath}
            fill="none"
            stroke={LINE_BENCHMARK}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <polyline
          points={model.oursPath}
          fill="none"
          stroke={LINE_PORTFOLIO}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <text
          x={width - PAD.right + 8}
          y={endLabels.ourY + 4}
          className="stc-pf-endlabel"
          fill={LINE_PORTFOLIO}
        >
          {str.pfYou}
        </text>
        {model.theirs && (
          <text
            x={width - PAD.right + 8}
            y={endLabels.theirY + 4}
            className="stc-pf-endlabel"
            fill={LINE_BENCHMARK}
          >
            {benchSymbol}
          </text>
        )}

        {hover != null && (
          <g>
            <line
              x1={tipX}
              y1={PAD.top}
              x2={tipX}
              y2={CHART_HEIGHT - PAD.bottom}
              stroke="var(--crosshair)"
              strokeWidth="1"
            />
            <circle cx={tipX} cy={model.y(model.ours[hover])} r="4.5" fill={LINE_PORTFOLIO}
                    stroke="var(--panel-bg)" strokeWidth="2" />
            {model.theirs && (
              <circle cx={tipX} cy={model.y(model.theirs[hover])} r="4.5" fill={LINE_BENCHMARK}
                      stroke="var(--panel-bg)" strokeWidth="2" />
            )}
          </g>
        )}
      </svg>

      {point && (
        <div
          className="stc-pf-tip"
          style={{
            left: tipSide > 0 ? tipX + 14 : undefined,
            right: tipSide > 0 ? undefined : width - tipX + 14,
          }}
        >
          <div className="stc-pf-tip-date">{point.date}</div>
          <div className="stc-pf-tip-row">
            <span className="stc-pf-swatch" style={{ background: LINE_PORTFOLIO }} />
            {str.pfChartPortfolio}
            <b>{money(point.total, locale)}</b>
          </div>
          {benchPoint && (
            <div className="stc-pf-tip-row">
              <span className="stc-pf-swatch" style={{ background: LINE_BENCHMARK }} />
              {benchSymbol}
              <b>{money(benchPoint.total, locale)}</b>
            </div>
          )}
          <div className="stc-pf-tip-row stc-muted">
            {str.pfInvested}
            <b>{money(point.invested, locale)}</b>
          </div>
          {point.dividends > 0 && (
            <div className="stc-pf-tip-row stc-muted">
              {str.pfDividends}
              <b>{money(point.dividends, locale)}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, tone, hint }) {
  return (
    <div className="stc-pf-tile">
      <div className="stc-pf-tile-label">{label}</div>
      <div className={`stc-pf-tile-value ${tone ?? ''}`}>{value}</div>
      {hint && <div className="stc-pf-tile-hint stc-muted">{hint}</div>}
    </div>
  );
}

const EMPTY_TRADE = { side: 'buy', date: '', quantity: '', price: '', fee: '', note: '' };

// Saturday and Sunday, the days BIST is certainly shut. A public holiday is
// just as shut but is not in the calendar, so it is caught on the overview as
// a note rather than refused here -- the backend draws the same line.
// Cumartesi ve pazar, BIST'in kesin kapali oldugu günler. Resmi tatil de o
// kadar kapali ama takvimde yok; o yüzden burada reddedilmek yerine özet
// ekranında not olarak yakalanıyor — arka uç da aynı çizgiyi çiziyor.
function isWeekend(iso) {
  if (!iso) return false;
  const day = new Date(`${iso}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function TradeForm({ onSaved, str }) {
  const [symbol, setSymbol] = useState('');
  const [form, setForm] = useState(EMPTY_TRADE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!symbol) {
      setError(str.pfNeedSymbol);
      return;
    }
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    if (!(quantity > 0) || !(price >= 0) || !form.date) {
      setError(str.pfNeedNumbers);
      return;
    }
    if (isWeekend(form.date)) {
      setError(str.pfMarketClosed);
      return;
    }
    setBusy(true);
    try {
      await addTrade({
        symbol,
        side: form.side,
        date: form.date,
        quantity,
        price,
        fee: Number(form.fee) || 0,
        note: form.note || null,
      });
      setForm(EMPTY_TRADE);
      onSaved();
    } catch (e) {
      setError(str.pfSaveFailed(e.detail?.code ?? e.status));
    } finally {
      setBusy(false);
    }
  }

  // Not a <form>: SymbolPicker brings its own, and a form inside a form makes
  // the picker's Enter bubble up here as a submit -- it fired before the
  // chosen symbol had landed in state, so nothing was saved. Saving is on the
  // button instead, which also keeps Enter doing one thing only: picking the
  // stock.
  // <form> değil: SymbolPicker kendi formunu getiriyor ve form içinde form,
  // seçicinin Enter'ını buraya submit olarak kabartıyor -- seçilen sembol
  // state'e düşmeden tetikleniyordu, kayıt da olmuyordu. Kaydetme butonda;
  // böylece Enter tek bir iş yapıyor: hisseyi seçmek.
  return (
    <div className="stc-pf-form">
      <div className="stc-pf-field stc-pf-field-symbol">
        <label>{str.pfSymbol}</label>
        <SymbolPicker symbol={symbol} onSelect={setSymbol} />
      </div>

      <div className="stc-pf-field">
        <label>{str.pfSide}</label>
        <div className="stc-seg" role="group">
          {['buy', 'sell'].map((side) => (
            <button
              key={side}
              type="button"
              className={form.side === side ? 'is-active' : ''}
              aria-pressed={form.side === side}
              onClick={() => set('side', side)}
            >
              {side === 'buy' ? str.pfBuy : str.pfSell}
            </button>
          ))}
        </div>
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-date">{str.pfDate}</label>
        <input
          id="pf-date"
          className="stc-input"
          type="date"
          value={form.date}
          max={new Date().toISOString().slice(0, 10)}
          aria-invalid={isWeekend(form.date) || undefined}
          onChange={(e) => {
            const next = e.target.value;
            set('date', next);
            // Said at the moment it is picked rather than held back until
            // Save, so the date picker is still open in the user's mind.
            // Kaydet'e kadar bekletilmeyip seçildiği anda söyleniyor; böylece
            // takvim kullanıcının aklında hâlâ açık.
            setError(isWeekend(next) ? str.pfMarketClosed : null);
          }}
        />
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-qty">{str.pfQuantity}</label>
        <input
          id="pf-qty"
          className="stc-input"
          type="number"
          min="0"
          step="any"
          value={form.quantity}
          onChange={(e) => set('quantity', e.target.value)}
        />
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-price">{str.pfPrice}</label>
        <input
          id="pf-price"
          className="stc-input"
          type="number"
          min="0"
          step="any"
          value={form.price}
          onChange={(e) => set('price', e.target.value)}
        />
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-fee">{str.pfFee}</label>
        <input
          id="pf-fee"
          className="stc-input"
          type="number"
          min="0"
          step="any"
          value={form.fee}
          onChange={(e) => set('fee', e.target.value)}
        />
      </div>

      <div className="stc-pf-field stc-pf-field-note">
        <label htmlFor="pf-note">{str.pfNote}</label>
        <input
          id="pf-note"
          className="stc-input"
          type="text"
          maxLength={500}
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
        />
      </div>

      <button
        className="stc-btn stc-btn-primary stc-pf-submit"
        type="button"
        onClick={submit}
        disabled={busy}
      >
        {busy ? str.pfSaving : str.pfSave}
      </button>

      <p className="stc-pf-pricehint stc-muted">{str.pfPriceHint}</p>
      {error && <p className="stc-error stc-pf-formerror">{error}</p>}
    </div>
  );
}

function ActionForm({ onSaved, str }) {
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState('dividend');
  const [date, setDate] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    const amount = Number(value);
    if (!symbol || !date || !(amount > 0)) {
      setError(str.pfNeedNumbers);
      return;
    }
    setBusy(true);
    try {
      await addAction({ symbol, kind, date, value: amount, note: null });
      setValue('');
      setDate('');
      onSaved();
    } catch (e) {
      setError(str.pfSaveFailed(e.detail?.code ?? e.status));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stc-pf-form stc-pf-form-action">
      <div className="stc-pf-field stc-pf-field-symbol">
        <label>{str.pfSymbol}</label>
        <SymbolPicker symbol={symbol} onSelect={setSymbol} />
      </div>

      <div className="stc-pf-field">
        <label>{str.pfActionKind}</label>
        <div className="stc-seg" role="group">
          {['dividend', 'bonus', 'rights'].map((key) => (
            <button
              key={key}
              type="button"
              className={kind === key ? 'is-active' : ''}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {str.pfActionLabel[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-adate">{str.pfDate}</label>
        <input
          id="pf-adate"
          className="stc-input"
          type="date"
          value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="stc-pf-field">
        <label htmlFor="pf-avalue">{str.pfActionValue[kind]}</label>
        <input
          id="pf-avalue"
          className="stc-input"
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <button className="stc-btn stc-pf-submit" type="button" onClick={submit} disabled={busy}>
        {busy ? str.pfSaving : str.pfSave}
      </button>

      <p className="stc-pf-pricehint stc-muted">{str.pfActionHint[kind]}</p>
      {error && <p className="stc-error stc-pf-formerror">{error}</p>}
    </div>
  );
}

function PortfolioView() {
  const str = useT();
  const locale = str.locale;
  const [benchmark, setBenchmark] = useState(DEFAULT_BENCHMARK);
  const [showForms, setShowForms] = useState(false);
  const { data, error, loading, reload } = useOverview(benchmark);

  const totals = data?.totals;
  const bench = data?.benchmark;

  async function removeTrade(id) {
    await deleteTrade(id).catch(() => null);
    reload();
  }

  const noteText = (note) => {
    const fn = str.pfNotes[note.code];
    return typeof fn === 'function' ? fn(note) : note.code;
  };

  return (
    <div className="stc-pf">
      <style>{PORTFOLIO_CSS}</style>

      <div className="stc-pf-head">
        <span className="stc-pf-title">{str.pfTitle}</span>
        <div className="stc-vrule" />
        <div className="stc-pf-bench">
          <label>{str.pfBenchmark}</label>
          <SymbolPicker symbol={benchmark} onSelect={(s) => setBenchmark(s || DEFAULT_BENCHMARK)} />
        </div>
        <button
          type="button"
          className={`stc-btn ${showForms ? 'stc-btn-active' : ''}`}
          onClick={() => setShowForms((v) => !v)}
        >
          {showForms ? str.pfHideForms : str.pfShowForms}
        </button>
      </div>

      {loading && !data && <div className="stc-loading">{str.pfLoading}</div>}
      {error && <div className="stc-error">{str.pfLoadFailed}</div>}

      {showForms && (
        <div className="stc-pf-forms">
          <div className="stc-pf-panel">
            <div className="stc-panel-title">{str.pfAddTrade}</div>
            <TradeForm onSaved={reload} str={str} />
          </div>
          <div className="stc-pf-panel">
            <div className="stc-panel-title">{str.pfAddAction}</div>
            <ActionForm onSaved={reload} str={str} />
          </div>
        </div>
      )}

      {data && data.positions.length === 0 && (
        <div className="stc-pf-empty">
          <p>{str.pfNoTrades}</p>
          <p className="stc-muted">{str.pfNoTradesHint}</p>
          <button type="button" className="stc-btn stc-btn-primary" onClick={() => setShowForms(true)}>
            {str.pfAddTrade}
          </button>
        </div>
      )}

      {data && data.positions.length > 0 && (
        <>
          <div className="stc-pf-tiles">
            <StatTile label={str.pfInvested} value={money(totals.cost, locale)} />
            <StatTile label={str.pfValueNow} value={money(totals.value, locale)} />
            <StatTile label={str.pfDividends} value={money(totals.dividends, locale)} />
            <StatTile
              label={str.pfTotalReturn}
              value={pct(totals.total_return_pct, locale)}
              tone={toneOf(totals.total_return_pct)}
              hint={signed(totals.total_return, locale)}
            />
            {bench && (
              <StatTile
                label={str.pfBenchmarkReturn(bench.symbol)}
                value={pct(bench.total_return_pct, locale)}
                tone={toneOf(bench.total_return_pct)}
                hint={signed(bench.total_return, locale)}
              />
            )}
          </div>

          {data.notes.length > 0 && (
            <ul className="stc-pf-notes">
              {data.notes.map((note, i) => (
                <li key={`${note.code}-${note.symbol}-${i}`}>{noteText(note)}</li>
              ))}
            </ul>
          )}

          <ValueChart
            series={data.series}
            benchSeries={bench?.series}
            benchSymbol={bench?.symbol}
            locale={locale}
            str={str}
          />

          <table className="stc-pf-table">
            <caption className="stc-panel-title">{str.pfPositions}</caption>
            <thead>
              <tr>
                <th scope="col">{str.pfSymbol}</th>
                <th scope="col">{str.pfShares}</th>
                <th scope="col">{str.pfAvgCost}</th>
                <th scope="col">{str.pfLast}</th>
                <th scope="col">{str.pfValue}</th>
                <th scope="col">{str.pfUnrealized}</th>
                <th scope="col">{str.pfRealized}</th>
                <th scope="col">{str.pfDividends}</th>
                <th scope="col">{str.pfTotalReturn}</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={p.symbol}>
                  <th scope="row">{p.symbol}</th>
                  <td>{money(p.shares, locale, 2)}</td>
                  <td>{money(p.avg_cost, locale, 2)}</td>
                  <td>{money(p.price, locale, 2)}</td>
                  <td>{money(p.value, locale)}</td>
                  <td className={toneOf(p.unrealized)}>{signed(p.unrealized, locale)}</td>
                  <td className={toneOf(p.realized)}>{signed(p.realized, locale)}</td>
                  <td>{money(p.dividends, locale)}</td>
                  <td className={toneOf(p.total_return)}>
                    {signed(p.total_return, locale)}
                    <span className="stc-pf-pctcell">{pct(p.total_return_pct, locale)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{str.pfTotal}</th>
                <td colSpan="3" />
                <td>{money(totals.value, locale)}</td>
                <td className={toneOf(totals.unrealized)}>{signed(totals.unrealized, locale)}</td>
                <td className={toneOf(totals.realized)}>{signed(totals.realized, locale)}</td>
                <td>{money(totals.dividends, locale)}</td>
                <td className={toneOf(totals.total_return)}>
                  {signed(totals.total_return, locale)}
                  <span className="stc-pf-pctcell">{pct(totals.total_return_pct, locale)}</span>
                </td>
              </tr>
            </tfoot>
          </table>

          {data.dividends.length > 0 && (
            <table className="stc-pf-table stc-pf-table-divs">
              <caption className="stc-panel-title">{str.pfDividendsReceived}</caption>
              <thead>
                <tr>
                  <th scope="col">{str.pfDate}</th>
                  <th scope="col">{str.pfSymbol}</th>
                  <th scope="col">{str.pfPerShare}</th>
                  <th scope="col">{str.pfShares}</th>
                  <th scope="col">{str.pfAmount}</th>
                  <th scope="col">{str.pfSource}</th>
                </tr>
              </thead>
              <tbody>
                {data.dividends.map((d, i) => (
                  <tr key={`${d.symbol}-${d.date}-${i}`}>
                    <td>{d.date}</td>
                    <th scope="row">{d.symbol}</th>
                    <td>{money(d.per_share, locale, 4)}</td>
                    <td>{money(d.shares, locale, 2)}</td>
                    <td>{money(d.amount, locale)}</td>
                    <td className="stc-muted">{str.pfSourceLabel[d.source] ?? d.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <TradeList onRemove={removeTrade} reloadKey={data} locale={locale} str={str} />
        </>
      )}
    </div>
  );
}

function TradeList({ onRemove, reloadKey, locale, str }) {
  const [rows, setRows] = useState([]);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchTrades()
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (rows.length === 0) return null;

  return (
    <table className="stc-pf-table stc-pf-table-trades">
      <caption className="stc-panel-title">{str.pfTrades}</caption>
      <thead>
        <tr>
          <th scope="col">{str.pfDate}</th>
          <th scope="col">{str.pfSymbol}</th>
          <th scope="col">{str.pfSide}</th>
          <th scope="col">{str.pfQuantity}</th>
          <th scope="col">{str.pfPrice}</th>
          <th scope="col">{str.pfFee}</th>
          <th scope="col">{str.pfNote}</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td>{t.date}</td>
            <th scope="row">{t.symbol}</th>
            <td className={t.side === 'buy' ? 'stc-pf-up' : 'stc-pf-down'}>
              {t.side === 'buy' ? str.pfBuy : str.pfSell}
            </td>
            <td>{money(t.quantity, locale, 2)}</td>
            <td>{money(t.price, locale, 2)}</td>
            <td>{money(t.fee, locale, 2)}</td>
            <td className="stc-muted">{t.note ?? ''}</td>
            <td>
              {confirming === t.id ? (
                <span className="stc-pf-confirm">
                  <button type="button" className="stc-btn" onClick={() => onRemove(t.id)}>
                    {str.pfConfirmDelete}
                  </button>
                  <button type="button" className="stc-btn" onClick={() => setConfirming(null)}>
                    {str.pfCancel}
                  </button>
                </span>
              ) : (
                <button type="button" className="stc-btn" onClick={() => setConfirming(t.id)}>
                  {str.pfDelete}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PORTFOLIO_CSS = `
  .stc-pf {
    flex-grow: 1;
    overflow: auto;
    padding: 14px 18px 40px;
    color: var(--text);
  }
  .stc-pf-head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--panel-border);
    margin-bottom: 14px;
  }
  .stc-pf-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-strong);
  }
  .stc-pf-bench {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stc-pf-bench label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .stc-pf-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .stc-pf-tile {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 10px 12px;
  }
  .stc-pf-tile-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .stc-pf-tile-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .stc-pf-tile-hint {
    font-size: 11px;
    margin-top: 2px;
  }
  .stc-pf-up { color: var(--up); }
  .stc-pf-down { color: var(--down); }
  .stc-pf-flat { color: var(--text-dim); }
  .stc-pf-notes {
    margin: 0 0 14px;
    padding: 10px 12px 10px 28px;
    background: var(--accent-soft);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
  }
  .stc-pf-chart {
    position: relative;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 10px 12px 4px;
    margin-bottom: 16px;
  }
  .stc-pf-chart-empty {
    padding: 24px 12px;
    font-size: 12px;
  }
  .stc-pf-legend {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 11.5px;
    margin-bottom: 4px;
  }
  .stc-pf-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .stc-pf-legend-note { font-size: 11px; }
  .stc-pf-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
    flex: none;
  }
  .stc-pf-axis {
    font-size: 10px;
    fill: var(--text-dim);
  }
  .stc-pf-endlabel {
    font-size: 11px;
    font-weight: 600;
  }
  .stc-pf-tip {
    position: absolute;
    top: 42px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 7px 9px;
    font-size: 11.5px;
    pointer-events: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    min-width: 170px;
  }
  .stc-pf-tip-date {
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .stc-pf-tip-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stc-pf-tip-row b {
    margin-left: auto;
    color: var(--text-strong);
  }
  .stc-pf-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-bottom: 18px;
  }
  .stc-pf-table caption {
    text-align: left;
    padding-bottom: 6px;
  }
  .stc-pf-table th,
  .stc-pf-table td {
    padding: 6px 8px;
    text-align: right;
    border-bottom: 1px solid var(--panel-border);
    white-space: nowrap;
  }
  .stc-pf-table thead th {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    font-weight: 500;
  }
  .stc-pf-table th[scope='row'] {
    text-align: left;
    color: var(--text-strong);
  }
  .stc-pf-table thead th:first-child,
  .stc-pf-table tbody td:first-child,
  .stc-pf-table tfoot th {
    text-align: left;
  }
  .stc-pf-table tfoot th,
  .stc-pf-table tfoot td {
    border-top: 1px solid var(--separator-hover, var(--panel-border));
    border-bottom: none;
    font-weight: 600;
  }
  .stc-pf-pctcell {
    display: inline-block;
    min-width: 72px;
    text-align: right;
  }
  .stc-pf-forms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .stc-pf-panel {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 10px 12px 12px;
  }
  .stc-pf-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .stc-pf-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stc-pf-field label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }
  .stc-pf-field input {
    width: 108px;
  }
  .stc-pf-field-note { flex: 1 1 160px; }
  .stc-pf-field-note input { width: 100%; }
  .stc-pf-pricehint {
    flex: 1 1 100%;
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.5;
  }
  .stc-pf-formerror { flex: 1 1 100%; margin: 0; }
  .stc-pf-empty {
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    padding: 28px 20px;
    text-align: center;
    font-size: 13px;
  }
  .stc-pf-confirm {
    display: inline-flex;
    gap: 6px;
  }
`;

export default PortfolioView;
