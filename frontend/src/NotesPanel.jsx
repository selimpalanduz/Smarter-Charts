import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n.js';
import { fetchNote, fetchNotes, saveNote } from './notesApi.js';

// How long the typing has to stop before the note is written. Long enough
// that a sentence is one request, short enough that nothing is lost by
// closing the panel right after typing.
// Not yazılmadan önce yazmanın ne kadar durması gerektiği. Bir cümlenin tek
// istek olacağı kadar uzun, yazdıktan hemen sonra paneli kapatmanın bir şey
// kaybettirmeyeceği kadar kısa.
const SAVE_DEBOUNCE_MS = 700;

function relativeDay(iso, t) {
  const days = Math.floor((Date.now() - iso * 1000) / 86400000);
  if (days <= 0) return t.notesToday;
  if (days === 1) return t.notesYesterday;
  return t.notesDaysAgo(days);
}

export default function NotesPanel({ symbol, onSelectSymbol }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [status, setStatus] = useState('idle');
  const [others, setOthers] = useState([]);
  // What the box held when it was last written, so an unchanged note is not
  // saved again and the "saved" line does not flicker on every keystroke.
  // Kutunun en son yazıldığında tuttuğu şey; ki değişmemiş not tekrar
  // kaydedilmesin ve "kaydedildi" satırı her tuşta titremesin.
  const lastSavedRef = useRef('');

  function reloadOthers() {
    fetchNotes()
      .then(setOthers)
      .catch(() => setOthers([]));
  }

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchNote(symbol)
      .then((note) => {
        if (cancelled) return;
        setBody(note.body ?? '');
        lastSavedRef.current = note.body ?? '';
        setSavedAt(note.updatedAt ?? null);
        setStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    reloadOthers();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Autosave: there is no save button, so the box has to be trustworthy on
  // its own. The symbol is captured per effect run, which keeps a note from
  // landing on the symbol the user switched to mid-sentence.
  // Kendiliğinden kayıt: kaydet düğmesi yok, o yüzden kutunun kendi başına
  // güvenilir olması gerekiyor. Sembol her çalıştırmada yakalanıyor; böylece
  // cümlenin ortasında geçilen sembole yanlış not düşmüyor.
  useEffect(() => {
    if (status === 'loading' || body === lastSavedRef.current) return undefined;
    const pending = body;
    const forSymbol = symbol;
    const timer = setTimeout(() => {
      setStatus('saving');
      saveNote(forSymbol, pending)
        .then((note) => {
          lastSavedRef.current = pending;
          setSavedAt(note.updatedAt ?? null);
          setStatus('idle');
          reloadOthers();
        })
        .catch(() => setStatus('error'));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, symbol]);

  const rest = others.filter((note) => note.symbol !== symbol.toUpperCase());

  return (
    <div className="stc-notes">
      <div className="stc-notes-symbol stc-mono">{symbol}</div>
      <textarea
        className="stc-notes-box"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t.notesPlaceholder}
        aria-label={t.notesFor(symbol)}
        spellCheck="false"
      />
      <div className="stc-notes-status">
        {status === 'saving' && t.notesSaving}
        {status === 'error' && t.notesSaveFailed}
        {status === 'idle' && savedAt != null && t.notesSaved(relativeDay(savedAt, t))}
        {status === 'idle' && savedAt == null && t.notesUnwritten}
      </div>

      {rest.length > 0 && (
        <>
          <div className="stc-section-title">{t.notesOthers}</div>
          <div className="stc-notes-list">
            {rest.map((note) => (
              <button
                key={note.symbol}
                className="stc-notes-other"
                onClick={() => onSelectSymbol?.(note.symbol)}
                title={note.body}
              >
                <span className="stc-mono stc-notes-other-symbol">{note.symbol}</span>
                <span className="stc-notes-other-body">{note.body}</span>
                <span className="stc-notes-other-when">{relativeDay(note.updatedAt, t)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
