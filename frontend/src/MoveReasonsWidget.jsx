import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';
import { CloseIcon, ExternalIcon } from './icons.jsx';

const UP = 'var(--up)';
const DOWN = 'var(--down)';

function formatChange(pct) {
  if (pct == null) return '-';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function changeColor(pct) {
  if (pct == null) return undefined;
  return pct >= 0 ? UP : DOWN;
}

function formatDateTime(value) {
  const [date, clock] = value.split(' ');
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}${clock ? ` ${clock}` : ''}`;
}

// Rough reading of how much of the move the market explains.
// Hareketin ne kadarını piyasanın açıkladığına dair kaba bir yorum.
function marketNote(move, t) {
  const { pct, indexPct } = move;
  if (indexPct == null) return null;
  if (Math.sign(pct) === Math.sign(indexPct) && Math.abs(indexPct) >= Math.abs(pct) * 0.6) {
    return t.marketDriven;
  }
  if (Math.abs(move.relPct) >= Math.abs(pct) * 0.6) {
    return t.stockSpecific;
  }
  return null;
}

function DisclosureItem({ disclosure, text }) {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        paddingTop: '8px',
        borderTop: '1px solid var(--panel-border)',
        opacity: disclosure.routine ? 0.55 : 1,
      }}
    >
      <span className="stc-mono" style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
        {formatDateTime(disclosure.publishedAt)} · {disclosure.subject}
      </span>
      <strong style={{ fontSize: '14.5px', color: 'var(--text-strong)', lineHeight: 1.35 }}>{disclosure.summary || disclosure.subject}</strong>
      {text === undefined && !disclosure.routine && <span style={{ opacity: 0.5 }}>{t.textLoading}</span>}
      {text && <span style={{ opacity: 0.85, lineHeight: 1.5 }}>{text}</span>}
      <a
        href={disclosure.url}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--accent)', fontSize: '12.5px', textDecoration: 'none' }}
      >
        {t.openOnKap}
        <ExternalIcon size={13} />
      </a>
    </div>
  );
}

function MoveReasonsWidget({ move, onClose }) {
  const [texts, setTexts] = useState({});
  const t = useT();

  useEffect(() => {
    if (!move) return undefined;
    let cancelled = false;
    const ids = [...move.disclosures, ...move.earlier].filter((d) => !d.routine).map((d) => d.id);
    ids.forEach(async (id) => {
      let text = '';
      try {
        const res = await fetch(`${API_BASE}/api/kap/disclosure/${id}`);
        if (res.ok) text = (await res.json()).text;
      } catch {
        // Fall back to the summary only.
        // Sadece başlıkla devam et.
      }
      if (!cancelled) setTexts((prev) => ({ ...prev, [id]: text }));
    });
    return () => {
      cancelled = true;
    };
  }, [move]);

  if (!move) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="stc-panel-title">{t.movesTitle}</span>
        <p className="stc-muted">{t.movesEmpty}</p>
      </div>
    );
  }

  const note = marketNote(move, t);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '17px', color: 'var(--text-strong)' }}>{t.whyTitle(formatDateTime(move.date))}</strong>
        <button className="stc-icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
          <CloseIcon size={15} />
        </button>
      </div>

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
        {[
          [t.stock, formatChange(move.pct), changeColor(move.pct)],
          ['XU100', formatChange(move.indexPct), changeColor(move.indexPct)],
          [t.vsIndex, formatChange(move.relPct), changeColor(move.relPct)],
          [t.volume, move.rvol != null ? t.rvolValue(move.rvol) : '-'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 12px', background: 'var(--panel-bg)' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{label}</span>
            <span className="stc-mono" style={{ fontWeight: 600, fontSize: '16px', color: color ?? 'var(--text-strong)' }}>{value}</span>
          </div>
        ))}
      </div>

      {note && <span style={{ opacity: 0.75 }}>{note}</span>}

      <span className="stc-section-title" style={{ margin: '6px 0 0', borderBottom: 'none', paddingBottom: 0 }}>{t.sameDayDisclosures}</span>
      {move.disclosures.length === 0 && (
        <span className="stc-muted">{t.noDisclosures}</span>
      )}
      {move.disclosures.map((d) => (
        <DisclosureItem key={d.id} disclosure={d} text={texts[d.id]} />
      ))}

      {move.earlier.length > 0 && (
        <>
          <span className="stc-section-title" style={{ margin: '10px 0 0', borderBottom: 'none', paddingBottom: 0 }}>{t.previousDays}</span>
          {move.earlier.map((d) => (
            <DisclosureItem key={d.id} disclosure={d} text={texts[d.id]} />
          ))}
        </>
      )}
    </div>
  );
}

export default MoveReasonsWidget;
