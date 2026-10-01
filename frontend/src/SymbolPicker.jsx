import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from './config.js';
import { useT } from './i18n.js';

const RECENTS_KEY = 'stc.recentSymbols';
const RECENTS_MAX = 8;

function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY));
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecents(list) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Private mode or blocked storage: recents are a convenience, not required.
    // Gizli mod ya da kapalı depolama: son bakılanlar sadece kolaylık, zorunlu değil.
  }
}

// Names arrive unaccented from the screener, so both sides are folded to plain
// uppercase ASCII. NFD splits ş/ğ/ü into letter plus mark; ı has no decomposition.
// Adlar screener'dan aksansız geliyor, iki taraf da düz büyük ASCII'ye katlanıyor.
// NFD ş/ğ/ü'yü harf artı işaret diye ayırıyor; ı'nın ayrışımı yok.
function fold(text) {
  return text
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
}

// Symbol prefix beats symbol substring, which beats a name match.
// Sembol başlangıcı, sembolün içinde geçmesini, o da ad eşleşmesini yener.
function score(entry, query) {
  if (entry.key.startsWith(query)) return 0;
  if (entry.key.includes(query)) return 1;
  if (entry.folded.includes(query)) return 2;
  return -1;
}

function SymbolPicker({ symbol, onSelect, inputRef }) {
  const [query, setQuery] = useState(symbol);
  const [all, setAll] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(readRecents);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const t = useT();

  useEffect(() => {
    setQuery(symbol);
    setRecents((prev) => {
      const next = [symbol, ...prev.filter((s) => s !== symbol)].slice(0, RECENTS_MAX);
      writeRecents(next);
      return next;
    });
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/symbols`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setAll(data);
      } catch {
        // Without the list the field still works as a plain text input.
        // Liste gelmezse alan düz metin girişi olarak çalışmaya devam eder.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onPointerDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const bySymbol = useMemo(() => new Map(all.map((e) => [e.symbol, e])), [all]);

  // Folded once per list, not once per keystroke.
  // Her tuşta değil, liste başına bir kez katlanıyor.
  const indexed = useMemo(
    () => all.map((e) => ({ ...e, key: fold(e.symbol), folded: fold(e.name) })),
    [all],
  );

  const rows = useMemo(() => {
    const q = fold(query.trim());
    if (!q || q === symbol) {
      const recentRows = recents.map((s) => bySymbol.get(s) ?? { symbol: s, name: s });
      const seen = new Set(recents);
      const rest = all.filter((e) => !seen.has(e.symbol));
      return [...recentRows, ...rest];
    }
    return indexed
      .map((e) => [score(e, q), e])
      .filter(([s]) => s >= 0)
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => e);
  }, [query, symbol, all, indexed, recents, bySymbol]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(sym) {
    setOpen(false);
    setQuery(sym);
    onSelect(sym);
  }

  function submitTyped() {
    const typed = fold(query.trim());
    if (open && rows[active]) choose(rows[active].symbol);
    else if (typed) choose(typed);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (rows.length ? (i + step + rows.length) % rows.length : 0));
      return;
    }
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setQuery(symbol);
    }
  }

  return (
    <form
      ref={wrapRef}
      onSubmit={(e) => {
        e.preventDefault();
        submitTyped();
      }}
      style={{ display: 'flex', gap: '6px' }}
    >
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="stc-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Focus misses a click back into an already-focused field.
          // Odak, zaten odaklı alana geri dönen tıklamayı kaçırıyor.
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t.symbolPlaceholder}
          aria-label={t.symbolPlaceholder}
          aria-keyshortcuts="/"
          role="combobox"
          aria-expanded={open}
          aria-controls="stc-symbol-list"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck="false"
          style={{ width: '118px', paddingRight: '26px' }}
        />
        <kbd className="stc-kbd">/</kbd>

        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              width: '280px',
              maxHeight: '320px',
              overflowY: 'auto',
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '3px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              zIndex: 40,
            }}
          >
            {rows.length === 0 ? (
              <p className="stc-muted" style={{ margin: 0, padding: '8px 10px' }}>{t.noSymbolMatch}</p>
            ) : (
              <ul ref={listRef} id="stc-symbol-list" role="listbox" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map((row, i) => (
                  <li
                    key={row.symbol}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(row.symbol);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '8px',
                      padding: '5px 10px',
                      cursor: 'pointer',
                      background: i === active ? 'var(--btn-bg-hover)' : 'transparent',
                    }}
                  >
                    <span
                      className="stc-mono"
                      style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-strong)', minWidth: '52px' }}
                    >
                      {row.symbol}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-dim)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.name === row.symbol ? '' : row.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <button type="submit" className="stc-btn stc-btn-primary">{t.load}</button>
    </form>
  );
}

export default SymbolPicker;
