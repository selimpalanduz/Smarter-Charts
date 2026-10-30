import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

// Reads as history, never as a forecast: see backend/reaction_test.py for why
// no character claim is made here.
// Geçmiş olarak okunur, öngörü olarak asla: burada karakter iddiası
// kurulmamasının sebebi için bkz. backend/reaction_test.py.
function HorizonRow({ horizon, data }) {
  const t = useT();

  if (!data?.supported) {
    return (
      <div className="stc-reaction-row">
        <span className="stc-reaction-head">{t.reactionHorizon(horizon)}</span>
        <span className="stc-muted">{t.reactionThin(data?.events ?? 0)}</span>
      </div>
    );
  }

  const giveback = data.giveback == null ? null : Math.round(data.giveback * 100);
  const strong = data.verdict !== 'mixed';

  return (
    <div className="stc-reaction-row">
      <span className="stc-reaction-head">{t.reactionHorizon(horizon)}</span>
      <span className="stc-mono" style={{ fontSize: '15px', color: 'var(--text-strong)' }}>
        {t.reactionLine(data.reverted, data.events)}
      </span>
      {giveback != null && (
        <span style={{ opacity: 0.85 }}>
          {giveback >= 0 ? t.reactionGiveback(giveback) : t.reactionRunOn(-giveback)}
        </span>
      )}
      <span className="stc-muted">
        {strong ? t.reactionSolid(data.p, t.reactionVerdicts[data.verdict]) : t.reactionChance(data.p)}
      </span>
    </div>
  );
}

function Kind({ title, kind, horizons }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span className="stc-section-title" style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>
        {title}
      </span>
      {horizons.map((n) => (
        <HorizonRow key={n} horizon={n} data={kind?.horizons?.[n]} />
      ))}
    </div>
  );
}

function ReactionProfileWidget({ symbol }) {
  const [state, setState] = useState({ status: 'loading' });
  const t = useT();

  useEffect(() => {
    if (!symbol) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reaction/${symbol}`);
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
  }, [symbol]);

  if (state.status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.reactionTitle}</span>
        <span className="stc-muted">{t.anchorsLoading}</span>
      </div>
    );
  }

  if (state.status === 'failed' || !state.data?.supported) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.reactionTitle}</span>
        <span className="stc-muted">{t.reactionEmpty}</span>
      </div>
    );
  }

  const { data } = state;
  const horizons = data.horizons ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px' }}>
      <span className="stc-panel-title">{t.reactionTitle}</span>
      <span style={{ opacity: 0.8, lineHeight: 1.5 }}>{t.reactionIntro(data.years)}</span>
      <Kind title={t.reactionMoves} kind={data.moves} horizons={horizons} />
      <Kind title={t.reactionEarnings} kind={data.earnings} horizons={horizons} />
      <span className="stc-muted" style={{ lineHeight: 1.5, borderTop: '1px solid var(--panel-border)', paddingTop: '10px' }}>
        {t.reactionFooter}
      </span>
    </div>
  );
}

export default ReactionProfileWidget;
