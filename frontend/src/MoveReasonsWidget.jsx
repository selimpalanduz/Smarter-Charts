import { useEffect, useState } from 'react';
import { API_BASE } from './config.js';

const UP = '#26a69a';
const DOWN = '#ef5350';

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
function marketNote(move) {
  const { pct, indexPct } = move;
  if (indexPct == null) return null;
  if (Math.sign(pct) === Math.sign(indexPct) && Math.abs(indexPct) >= Math.abs(pct) * 0.6) {
    return 'Hareketin büyük kısmı piyasa geneliyle uyumlu.';
  }
  if (Math.abs(move.relPct) >= Math.abs(pct) * 0.6) {
    return 'Hareket büyük ölçüde hisseye özel.';
  }
  return null;
}

function DisclosureItem({ disclosure, text }) {
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
      <span style={{ fontSize: '12.5px', opacity: 0.7 }}>
        {formatDateTime(disclosure.publishedAt)} · {disclosure.subject}
      </span>
      <strong style={{ fontSize: '14.5px' }}>{disclosure.summary || disclosure.subject}</strong>
      {text === undefined && !disclosure.routine && <span style={{ opacity: 0.5 }}>Metin yükleniyor...</span>}
      {text && <span style={{ opacity: 0.85, lineHeight: 1.5 }}>{text}</span>}
      <a href={disclosure.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '12.5px' }}>
        KAP'ta aç ↗
      </a>
    </div>
  );
}

function MoveReasonsWidget({ move, onClose }) {
  const [texts, setTexts] = useState({});

  useEffect(() => {
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

  const note = marketNote(move);

  return (
    <div
      className="stc-header"
      style={{
        position: 'absolute',
        top: '68px',
        right: '16px',
        zIndex: 25,
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '10px',
        padding: '16px',
        width: '460px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '70vh',
        overflowY: 'auto',
        fontSize: '14px',
        color: 'var(--text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '17px' }}>{formatDateTime(move.date)} · Neden oldu?</strong>
        <button className="stc-btn" style={{ padding: '4px 10px', fontSize: '13px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {[
          ['Hisse', formatChange(move.pct), changeColor(move.pct)],
          ['XU100', formatChange(move.indexPct), changeColor(move.indexPct)],
          ['Endekse göre', formatChange(move.relPct), changeColor(move.relPct)],
          ['Hacim', move.rvol != null ? `${move.rvol}x ort.` : '-'],
        ].map(([label, value, color]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ opacity: 0.6, fontSize: '12.5px' }}>{label}</span>
            <span style={{ fontWeight: 600, fontSize: '16px', color }}>{value}</span>
          </div>
        ))}
      </div>

      {note && <span style={{ opacity: 0.75 }}>{note}</span>}

      <strong style={{ fontSize: '15px', marginTop: '6px' }}>Bu güne ait KAP bildirimleri</strong>
      {move.disclosures.length === 0 && (
        <span style={{ opacity: 0.6 }}>Bildirim yok. Sebep piyasa geneli ya da haber/söylenti olabilir.</span>
      )}
      {move.disclosures.map((d) => (
        <DisclosureItem key={d.id} disclosure={d} text={texts[d.id]} />
      ))}

      {move.earlier.length > 0 && (
        <>
          <strong style={{ fontSize: '15px', marginTop: '6px' }}>Önceki 2 işlem günü</strong>
          {move.earlier.map((d) => (
            <DisclosureItem key={d.id} disclosure={d} text={texts[d.id]} />
          ))}
        </>
      )}
    </div>
  );
}

export default MoveReasonsWidget;
