// Terminal palette: dark graphite and its light counterpart.
// Terminal paleti: koyu grafit ve açık karşılığı.
export const THEME = {
  dark: {
    pageBg: '#0e1012',
    panelBg: '#121417',
    panelBorder: '#24282e',
    text: '#d7dce1',
    textStrong: '#eef1f4',
    textDim: '#7d858e',
    btnBg: '#16191d',
    btnBgHover: '#1f2328',
    btnBorder: '#2c3137',
    inputBg: '#0e1012',
    accent: '#e8a33d',
    accentHover: '#f3bd66',
    accentText: '#0e1012',
    accentRing: 'rgba(232, 163, 61, 0.25)',
    chartBg: '#0e1012',
    chartText: '#7d858e',
    gridColor: '#1b1f23',
    separator: '#24282e',
    separatorHover: '#3a4047',
    crosshair: '#5b636c',
    up: '#4cc38a',
    down: '#e5605a',
    upSoft: 'rgba(76, 195, 138, 0.35)',
    downSoft: 'rgba(229, 96, 90, 0.35)',
    upZone: 'rgba(76, 195, 138, 0.08)',
    downZone: 'rgba(229, 96, 90, 0.08)',
    accentSoft: 'rgba(232, 163, 61, 0.12)',
    drawing: '#f5c542',
    drawingFill: 'rgba(245, 197, 66, 0.12)',
  },
  light: {
    pageBg: '#f6f6f4',
    panelBg: '#ffffff',
    panelBorder: '#dfe2e6',
    text: '#2a2f35',
    textStrong: '#111417',
    textDim: '#6b737c',
    btnBg: '#ffffff',
    btnBgHover: '#f0f1f3',
    btnBorder: '#d4d8dd',
    inputBg: '#ffffff',
    accent: '#9a6414',
    accentHover: '#7f5210',
    accentText: '#ffffff',
    accentRing: 'rgba(154, 100, 20, 0.2)',
    chartBg: '#ffffff',
    chartText: '#6b737c',
    gridColor: '#f0f1f3',
    separator: '#dfe2e6',
    separatorHover: '#c9ced4',
    crosshair: '#9aa1a9',
    up: '#1f8a5b',
    down: '#c8453c',
    upSoft: 'rgba(31, 138, 91, 0.3)',
    downSoft: 'rgba(200, 69, 60, 0.3)',
    upZone: 'rgba(31, 138, 91, 0.08)',
    downZone: 'rgba(200, 69, 60, 0.08)',
    accentSoft: 'rgba(154, 100, 20, 0.1)',
    drawing: '#b8860b',
    drawingFill: 'rgba(184, 134, 11, 0.1)',
  },
};

// Series colours for the statement charts, checked for colour-vision
// separation and contrast against both the dark and the light surface, so one
// set serves both themes.
// Mali tablo grafiklerinin seri renkleri; renk körlüğü ayrımı ve kontrast için
// hem koyu hem açık zeminde doğrulandı, tek set ikisine de yetiyor.
export const SERIES = ['#c48622', '#3f86bd', '#36a776'];

// Canvas-drawn chart parts can't read CSS variables, so they read the active palette from here.
// Canvas'a çizilen grafik parçaları CSS değişkenlerini okuyamaz; aktif paleti buradan okur.
let active = THEME.dark;

export function setPalette(palette) {
  active = palette;
}

export function colors() {
  return active;
}
