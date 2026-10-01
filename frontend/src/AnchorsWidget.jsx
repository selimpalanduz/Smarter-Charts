import { useT } from './i18n.js';

// Below this many tests a hold rate says little.
// Bu sayının altındaki testlerde tutma oranı pek bir şey söylemez.
const MIN_TESTS = 3;
// Round levels must beat control levels by this many points to count as an effect.
// Etki sayılması için yuvarlak seviyeler kontrolü bu kadar puan geçmeli.
const EFFECT_MARGIN = 3;

function holdRate(s) {
  const total = s.held + s.broke;
  return total ? (s.held / total) * 100 : null;
}

function formatPct(pct) {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatPrice(value, locale) {
  return value.toLocaleString(locale, { maximumFractionDigits: 2 });
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function TestCell({ stats }) {
  const t = useT();
  const total = stats.held + stats.broke;
  if (!total) return <span style={{ opacity: 0.4 }}>-</span>;
  const rate = holdRate(stats);
  return (
    <span title={t.anchorHeldTitle(stats.held, total)} style={{ opacity: total < MIN_TESTS ? 0.5 : 1 }}>
      {stats.held}/{total}
      <span style={{ opacity: 0.6 }}> · {rate.toFixed(0)}%</span>
    </span>
  );
}

function ExtremeCard({ label, data, resistance }) {
  const t = useT();
  const total = data.held + data.broke;
  const rate = holdRate(data);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '10px 12px', background: 'var(--panel-bg)' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{label}</span>
      <span className="stc-mono" style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-strong)' }}>
        {formatPrice(data.level, t.locale)}
        <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--text-dim)' }}> {formatPct(data.distancePct)}</span>
      </span>
      <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{formatDate(data.date)}</span>
      <span style={{ fontSize: '12.5px' }}>
        {total ? t.anchorExtremeStats(rate.toFixed(0), data.held, total, resistance) : t.anchorNoTests}
      </span>
    </div>
  );
}

function RoundEffect({ effect }) {
  const t = useT();
  const round = holdRate(effect.round);
  const control = holdRate(effect.control);
  if (round == null || control == null) return null;
  const diff = round - control;
  const verdict = diff >= EFFECT_MARGIN ? t.roundEffectStrong : diff <= -EFFECT_MARGIN ? t.roundEffectWeak : t.roundEffectNone;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span className="stc-mono">
        {t.roundEffectRates(round.toFixed(1), control.toFixed(1))}
      </span>
      <span style={{ opacity: 0.8, lineHeight: 1.45 }}>{verdict}</span>
      <span style={{ opacity: 0.5, fontSize: '11.5px' }}>
        {t.roundEffectSample(effect.round.held + effect.round.broke, effect.control.held + effect.control.broke)}
      </span>
    </div>
  );
}

function AnchorsWidget({ data }) {
  const t = useT();

  if (!data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.anchorsTitle}</span>
        <p className="stc-muted">{t.anchorsLoading}</p>
      </div>
    );
  }

  if (!data.price) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.anchorsTitle}</span>
        <p className="stc-muted">{t.anchorsNoData}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
      <span className="stc-panel-title">{t.anchorsTitle}</span>
      <span style={{ opacity: 0.75, lineHeight: 1.45 }}>{t.anchorsIntro}</span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '1px',
          background: 'var(--panel-border)',
          border: '1px solid var(--panel-border)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <ExtremeCard label={t.high52} data={data.high52} resistance />
        <ExtremeCard label={t.low52} data={data.low52} resistance={false} />
      </div>

      <span className="stc-section-title" style={{ margin: '6px 0 0', borderBottom: 'none', paddingBottom: 0 }}>{t.roundLevels}</span>
      <div className="stc-mono" style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr 1fr', columnGap: '12px', rowGap: '6px', fontSize: '12.5px' }}>
        <span style={{ color: 'var(--text-dim)' }}>{t.anchorLevel}</span>
        <span style={{ color: 'var(--text-dim)' }}>{t.anchorDistance}</span>
        <span style={{ color: 'var(--text-dim)' }}>{t.asResistance}</span>
        <span style={{ color: 'var(--text-dim)' }}>{t.asSupport}</span>
        {[...data.round].reverse().map((r) => (
          <div key={r.level} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{formatPrice(r.level, t.locale)}</span>
            <span style={{ color: r.distancePct >= 0 ? 'var(--up)' : 'var(--down)' }}>{formatPct(r.distancePct)}</span>
            <TestCell stats={r.resistance} />
            <TestCell stats={r.support} />
          </div>
        ))}
      </div>

      <span className="stc-section-title" style={{ margin: '6px 0 0', borderBottom: 'none', paddingBottom: 0 }}>{t.roundEffectTitle}</span>
      <RoundEffect effect={data.roundEffect} />

      <span style={{ opacity: 0.5, fontSize: '11.5px', lineHeight: 1.45 }}>{t.anchorsMethod}</span>
    </div>
  );
}

export default AnchorsWidget;
