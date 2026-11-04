import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

// A sector row is the median of its members and the colour is that median
// against the MARKET's median, not against XU100: XU100 is cap-weighted, so
// colouring equal-weighted medians against it paints the whole map red
// whenever small caps lag, which is a fact about the market and not about any
// sector. XU100 is kept as its own reference row, next to the cap-weighted
// sector return that is comparable with it.
//
// Sektör satırı üyelerinin medyanı; renk, bu medyanın PİYASA medyanına göre
// durumu, XU100'e göre değil: XU100 piyasa değeriyle ağırlıklı, yani eşit
// ağırlıklı medyanları ona karşı renklendirmek, küçükler geride kaldığında tüm
// haritayı kırmızıya boyuyor — bu piyasaya ait bir olgu, bir sektöre ait
// değil. XU100 kendi referans satırında duruyor; yanında da onunla
// karşılaştırılabilir olan, piyasa değeriyle ağırlıklı sektör getirisi.

// Where the colour saturates, in points of difference from the market median.
// Renk nerede doyuyor; piyasa medyanından kaç puan farkta.
const COLOUR_CAP = 12;
const MAX_TINT = 52;
// Members listed per sector before the list is cut; the question is which one
// leads, not the full roster.
// Sektör başına listelenen üye sayısı; soru hangisinin önde olduğu, tüm kadro değil.
const MEMBER_LIMIT = 10;

function tint(diff) {
  if (diff == null) return 'transparent';
  const strength = Math.min(Math.abs(diff) / COLOUR_CAP, 1) * MAX_TINT;
  if (strength < 1) return 'transparent';
  const pole = diff >= 0 ? 'var(--up)' : 'var(--down)';
  return `color-mix(in srgb, ${pole} ${strength.toFixed(0)}%, transparent)`;
}

// The sector name comes from TradingView, so it is looked up as an own key:
// a sector called "constructor" would otherwise reach through to Object's
// prototype and hand a function to React instead of a name.
// Sektör adı TradingView'dan geliyor, o yüzden yalnızca kendi anahtarı
// aranıyor: "constructor" adlı bir sektör yoksa Object'in prototipine uzanıp
// React'e ad yerine bir fonksiyon verirdi.
function sectorName(names, sector) {
  return Object.hasOwn(names, sector) ? names[sector] : sector;
}

function pct(value, locale) {
  if (value == null) return '–';
  const n = value.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${value > 0 ? '+' : ''}${n}%`;
}

function diffOf(sector, market, period) {
  const own = sector.median?.[period];
  const base = market?.[period];
  if (own == null || base == null) return null;
  return own - base;
}

function Legend() {
  const t = useT();
  return (
    <div className="stc-heat-legend">
      <span className="stc-muted">{t.heatBelow}</span>
      <div className="stc-heat-ramp">
        {[-COLOUR_CAP, -COLOUR_CAP / 2, 0, COLOUR_CAP / 2, COLOUR_CAP].map((step) => (
          <i key={step} style={{ background: tint(step) }} />
        ))}
      </div>
      <span className="stc-muted">{t.heatAbove}</span>
    </div>
  );
}

function Members({ sector, period, symbol, locale, onSelectSymbol }) {
  const t = useT();
  const ranked = useMemo(
    () =>
      [...sector.symbols]
        .filter((m) => m.perf?.[period] != null)
        .sort((a, b) => b.perf[period] - a.perf[period]),
    [sector, period],
  );

  if (ranked.length === 0) return <div className="stc-muted stc-heat-members">{t.heatNoMembers}</div>;

  return (
    <div className="stc-heat-members">
      {ranked.slice(0, MEMBER_LIMIT).map((m) => (
        <button
          key={m.symbol}
          className={`stc-heat-member ${m.symbol === symbol ? 'is-current' : ''}`}
          onClick={() => onSelectSymbol?.(m.symbol)}
          title={t.heatMemberTitle(m.symbol)}
        >
          <span>{m.symbol}</span>
          <span className="stc-mono" style={{ color: m.perf[period] >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {pct(m.perf[period], locale)}
          </span>
        </button>
      ))}
      {ranked.length > MEMBER_LIMIT && (
        <span className="stc-muted">{t.heatMoreMembers(ranked.length - MEMBER_LIMIT)}</span>
      )}
    </div>
  );
}

function SectorHeatWidget({ symbol, onSelectSymbol }) {
  const [state, setState] = useState({ status: 'loading' });
  const [period, setPeriod] = useState('1m');
  const [open, setOpen] = useState(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sectors`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setState({ status: 'ready', data });
      } catch {
        if (!cancelled) setState({ status: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;

  // The symbol's own sector, read off the map rather than asked for again.
  // Sembolün sektörü; yeniden sorulmak yerine haritadan okunuyor.
  const ownSector = useMemo(() => {
    if (!data) return null;
    const hit = data.sectors.find((s) => s.symbols.some((m) => m.symbol === symbol));
    return hit?.sector ?? null;
  }, [data, symbol]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.sectors].sort((a, b) => {
      const da = diffOf(a, data.market, period);
      const db = diffOf(b, data.market, period);
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    });
  }, [data, period]);

  if (state.status === 'loading') {
    return (
      <div className="stc-heat">
        <span className="stc-panel-title">{t.heatTitle}</span>
        <span className="stc-muted">{t.anchorsLoading}</span>
      </div>
    );
  }

  if (state.status === 'failed' || !data?.sectors?.length) {
    return (
      <div className="stc-heat">
        <span className="stc-panel-title">{t.heatTitle}</span>
        <span className="stc-muted">{t.heatEmpty}</span>
      </div>
    );
  }

  const { locale } = t;
  const periods = data.periods;

  return (
    <div className="stc-heat">
      <span className="stc-panel-title">{t.heatTitle}</span>
      <span style={{ opacity: 0.8, lineHeight: 1.5 }}>{t.heatIntro}</span>

      <table className="stc-heat-table">
        <colgroup>
          <col />
          {periods.map((key) => (
            <col key={key} className="stc-heat-period" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>{t.heatSector}</th>
            {periods.map((key) => (
              <th key={key}>
                <button
                  className={`stc-heat-col ${key === period ? 'is-active' : ''}`}
                  onClick={() => setPeriod(key)}
                  title={t.heatSortBy(t.heatPeriods[key])}
                >
                  {t.heatPeriods[key]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="stc-heat-reference">
            <td>{t.heatMarket}</td>
            {periods.map((key) => (
              <td key={key} className="stc-mono">
                {pct(data.market?.[key], locale)}
              </td>
            ))}
          </tr>
          <tr className="stc-heat-reference">
            <td>{data.indexSymbol}</td>
            {periods.map((key) => (
              <td key={key} className="stc-mono">
                {pct(data.index?.[key], locale)}
              </td>
            ))}
          </tr>

          {rows.flatMap((sector) => {
            const isOpen = open === sector.sector;
            const row = (
              <tr
                key={sector.sector}
                className={`stc-heat-row ${sector.sector === ownSector ? 'is-own' : ''} ${isOpen ? 'is-open' : ''}`}
                onClick={() => setOpen(isOpen ? null : sector.sector)}
                title={t.heatRowTitle(sector.members)}
              >
                <td>
                  <span className="stc-heat-name">{sectorName(t.sectorNames, sector.sector)}</span>
                  <span className="stc-muted"> {sector.members}</span>
                </td>
                {periods.map((key) => {
                  const diff = diffOf(sector, data.market, key);
                  return (
                    <td
                      key={key}
                      className="stc-mono stc-heat-cell"
                      style={{ background: tint(diff) }}
                      title={t.heatCellTitle({
                        sector: sectorName(t.sectorNames, sector.sector),
                        period: t.heatPeriods[key],
                        median: pct(sector.median?.[key], locale),
                        market: pct(data.market?.[key], locale),
                        diff: pct(diff, locale),
                        weighted: pct(sector.weighted?.[key], locale),
                        index: pct(data.index?.[key], locale),
                        indexSymbol: data.indexSymbol,
                      })}
                    >
                      {pct(sector.median?.[key], locale)}
                    </td>
                  );
                })}
              </tr>
            );
            if (!isOpen) return [row];
            return [
              row,
              <tr key={`${sector.sector}-members`}>
                <td colSpan={periods.length + 1} style={{ padding: 0 }}>
                  <Members
                    sector={sector}
                    period={period}
                    symbol={symbol}
                    locale={locale}
                    onSelectSymbol={onSelectSymbol}
                  />
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>

      <Legend />
      <span className="stc-muted stc-heat-foot">{t.heatFooter(data.dropped)}</span>
    </div>
  );
}

export default SectorHeatWidget;
