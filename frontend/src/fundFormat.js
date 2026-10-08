// Shared arithmetic and formatting for the fundamentals layouts.
// Temel analiz yerleşimlerinin paylaştığı aritmetik ve biçimlendirme.

// A row picks its own unit from its largest value, so figures stay short and
// columns stay aligned.
// Satır birimini kendi en büyük değerinden seçiyor; rakamlar kısa, kolonlar
// hizalı kalıyor.
export function rowScale(values, scaleNames) {
  const peak = Math.max(...values.filter((v) => v != null).map(Math.abs), 0);
  if (peak >= 1e9) return { divisor: 1e9, suffix: scaleNames.bn };
  if (peak >= 1e6) return { divisor: 1e6, suffix: scaleNames.mn };
  if (peak >= 1e3) return { divisor: 1e3, suffix: scaleNames.th };
  return { divisor: 1, suffix: '' };
}

export const FLAT_SCALE = { divisor: 1, suffix: '' };

export function num(value, locale, digits = 1) {
  return value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCell(value, unit, scale, locale) {
  if (value == null) return '—';
  if (unit === 'pct') return `${num(value, locale, 1)}%`;
  if (unit === 'ratio') return `${num(value, locale, 1)}x`;
  return num(value / scale.divisor, locale, 1);
}

function present(values) {
  return values.filter((v) => v != null);
}

// Period-over-period change: percentage points for a ratio row, percent for a
// money row. Signed text plus the direction, so callers only pick a colour.
// Dönemsel değişim: oran satırında puan, para satırında yüzde. İşaretli metin
// ve yön dönüyor, çağıran yalnızca rengi seçiyor.
export function change(values, unit, locale, suffixes) {
  const seen = present(values);
  if (seen.length < 2) return null;
  const last = seen[seen.length - 1];
  const prev = seen[seen.length - 2];
  if (unit === 'pct' || unit === 'ratio') {
    const d = last - prev;
    const tail = unit === 'pct' ? ` ${suffixes.pp}` : 'x';
    return { text: `${d >= 0 ? '+' : ''}${num(d, locale, 1)}${tail}`, up: d >= 0 };
  }
  if (prev === 0) return null;
  const d = ((last - prev) / Math.abs(prev)) * 100;
  return { text: `${d >= 0 ? '+' : ''}${num(d, locale, 1)}%`, up: d >= 0 };
}

// Compound growth over the whole window, which only means something when both
// ends are positive; otherwise the plain difference.
// Pencerenin tamamındaki bileşik büyüme — ancak iki uç da pozitifse anlamlı;
// değilse düz fark.
export function overWindow(values, unit, locale, suffixes) {
  const seen = present(values);
  if (seen.length < 2) return null;
  const first = seen[0];
  const last = seen[seen.length - 1];
  if (unit === 'pct' || unit === 'ratio') {
    const d = last - first;
    const tail = unit === 'pct' ? ` ${suffixes.pp}` : 'x';
    return { text: `${d >= 0 ? '+' : ''}${num(d, locale, 1)}${tail}`, up: d >= 0, span: seen.length - 1 };
  }
  if (first <= 0 || last <= 0) {
    return { text: '—', up: null, span: seen.length - 1 };
  }
  const g = (Math.pow(last / first, 1 / (seen.length - 1)) - 1) * 100;
  return { text: `${g >= 0 ? '+' : ''}${num(g, locale, 1)}%`, up: g >= 0, span: seen.length - 1 };
}

// Gaps are bridged rather than drawn as a break: a missing quarter should not
// look like a collapse to zero.
// Boşluklar kırık olarak çizilmiyor, köprüleniyor: eksik çeyrek sıfıra iniş
// gibi görünmemeli.
export function sparkline(values, width, height) {
  const points = [];
  const seen = present(values);
  if (seen.length < 2) return null;
  const lo = Math.min(...seen, 0);
  const hi = Math.max(...seen, 0);
  const span = hi - lo || 1;
  const y = (v) => height - ((v - lo) / span) * height;
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / Math.max(values.length - 1, 1)) * width;
    points.push(`${x.toFixed(1)},${y(v).toFixed(1)}`);
  });
  return { points: points.join(' '), zeroY: y(0).toFixed(1) };
}

// One bar anchored to the baseline, its data end rounded.
// Tabana oturan bir çubuk, veri ucu yuvarlatılmış.
export function barPath(x, width, baseY, valueY) {
  const r = Math.min(4, width / 2, Math.abs(valueY - baseY));
  const dir = valueY <= baseY ? 1 : -1;
  const near = valueY + r * dir;
  return [
    `M${x},${baseY}`,
    `L${x},${near}`,
    `Q${x},${valueY} ${x + r},${valueY}`,
    `L${x + width - r},${valueY}`,
    `Q${x + width},${valueY} ${x + width},${near}`,
    `L${x + width},${baseY}`,
    'Z',
  ].join(' ');
}

export function scaleOf(values, height) {
  const seen = present(values);
  const lo = Math.min(...seen, 0);
  const hi = Math.max(...seen, 0);
  const span = hi - lo || 1;
  return { lo, hi, span, y: (v) => height - ((v - lo) / span) * height };
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

// Where the latest figure sits inside the row's own history — the reading that
// makes a single ratio mean something without a peer group.
// Son rakamın satırın kendi geçmişindeki yeri — tek bir oranı emsal grubu
// olmadan anlamlı kılan okuma.
export function band(values) {
  const seen = present(values);
  if (seen.length < 3) return null;
  const sorted = [...seen].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const span = hi - lo || 1;
  const value = seen[seen.length - 1];
  const at = (v) => `${(((v - lo) / span) * 100).toFixed(1)}%`;
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const below = sorted.filter((v) => v < value).length;
  return {
    low: lo,
    high: hi,
    value,
    percentile: Math.round((below / (sorted.length - 1)) * 100),
    markLeft: at(value),
    bandLeft: at(p25),
    bandWidth: `${(((p75 - p25) / span) * 100).toFixed(1)}%`,
  };
}

// Tint strength for a ratio cell: its place in the row's own range.
// Oran hücresinin zemin tonu: satırın kendi aralığındaki yeri.
export function tintFor(value, values) {
  if (value == null) return 'transparent';
  const seen = present(values);
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  const t = hi === lo ? 0.5 : (value - lo) / (hi - lo);
  return `rgba(196, 134, 34, ${(0.04 + t * 0.16).toFixed(3)})`;
}

// Each basis is set to 100 at its first reported column, which is the only way
// to put three measuring sticks on one axis.
// Her baz ilk raporlanan kolonunda 100 kabul ediliyor; üç ölçüyü tek eksene
// koymanın tek yolu bu.
export function indexed(values) {
  const first = present(values)[0];
  if (first == null || first === 0) return null;
  const base = Math.abs(first);
  return values.map((v) => (v == null ? null : (v / base) * 100));
}
