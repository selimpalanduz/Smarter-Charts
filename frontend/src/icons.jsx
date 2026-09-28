// Stroke icons on a 24px grid, drawn in currentColor.
// 24px ızgarada, currentColor ile çizilen çizgi ikonlar.
function Icon({ size = 16, children, fill = 'none' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      <path d="M3 15V9M9 15V3M15 15V7" />
    </svg>
  );
}

export const CursorIcon = (p) => <Icon {...p}><path d="M5 3l14 8-6 2-3 6z" /></Icon>;
export const TrendLineIcon = (p) => (
  <Icon {...p}>
    <path d="M5 19L19 5" />
    <circle cx="5" cy="19" r="1.6" />
    <circle cx="19" cy="5" r="1.6" />
  </Icon>
);
export const HorizontalLineIcon = (p) => (
  <Icon {...p}>
    <path d="M3 12h18" />
    <circle cx="12" cy="12" r="1.6" />
  </Icon>
);
export const RectangleIcon = (p) => <Icon {...p}><rect x="4" y="6" width="16" height="12" rx="1" /></Icon>;
export const PatternIcon = (p) => (
  <Icon {...p}>
    <path d="M3 16l4-5 4 3 5-7" />
    <circle cx="18" cy="17" r="3" />
    <path d="M20.2 19.2L22 21" />
  </Icon>
);
export const ExtendLeftIcon = (p) => (
  <Icon {...p}>
    <path d="M21 12H4" />
    <path d="M8 8l-4 4 4 4" />
  </Icon>
);
export const ExtendRightIcon = (p) => (
  <Icon {...p}>
    <path d="M3 12h17" />
    <path d="M16 8l4 4-4 4" />
  </Icon>
);
export const DeleteIcon = (p) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Icon>
);
export const ClearAllIcon = (p) => (
  <Icon {...p}>
    <path d="M4 20h16" />
    <path d="M14.5 4.5l5 5L11 18H6.5L4 15.5z" />
  </Icon>
);
export const CloseIcon = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const PanelIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M15 4v16" />
  </Icon>
);
export const SunIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const MoonIcon = (p) => (
  <Icon {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
);
export const ExternalIcon = (p) => (
  <Icon {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);
