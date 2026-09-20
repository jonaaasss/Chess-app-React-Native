// Design tokens for this redesign, sourced from nextlevelbuilder/ui-ux-pro-max-skill
// (github.com/nextlevelbuilder/ui-ux-pro-max-skill, referenced as static reference
// data only — no code from that repo runs in this app):
//  - Color palette: data/colors.csv, row 122 "Card & Board Game"
//    ("Felt green + gold on dark") — thematically fits a chess app and ships
//    with pre-computed on-color pairings (On Primary/On Accent) used verbatim.
//  - Motion/shape pattern: data/styles.csv, row 76 "Material 3 Expressive
//    (Mobile)" — pill-shaped CTAs and tonal (flat, borderless) elevated
//    surfaces instead of hard 1px borders everywhere, appropriate since this
//    is a native Android app.
//  - Typography: data/typography.csv, row 60 "Modern Dark Cinema (Inter
//    System)" — single-family Inter with a defined weight/tracking ramp.
//  - Touch target: data/ux-guidelines.csv "Touch Target Size" row —
//    "48dp on Android" (this app is Android-only, so 48 not the iOS 44).

export const colors = {
  bg: '#0f172a',
  surface: '#192134',
  surfaceRaised: '#0f1f2b',
  border: 'rgba(255,255,255,0.08)',

  textPrimary: '#ffffff',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',

  primary: '#15803d',
  onPrimary: '#ffffff',
  primaryPressed: '#166534',

  gold: '#d97706',
  onGold: '#000000',
  goldPressed: '#b45309',

  danger: '#dc2626',
  onDanger: '#ffffff',
  dangerPressed: '#b91c1c',

  evalRight: '#15803d',
  evalWrong: '#dc2626',

  // The cburnett king art always outlines in black (white king: white fill
  // + black outline; black king: black fill + white detail lines), so a
  // single mid-tone badge — lighter than the app's near-black surfaces,
  // darker than white — reads both pieces clearly instead of favoring one.
  pieceBadgeBg: '#454c5c',

  // Deprecated aliases kept during migration; prefer the names above.
  panel: '#192134',
  panel2: '#0f1f2b',
  text: '#ffffff',
  textDim: '#94a3b8',
  accent: '#15803d',
  accentHover: '#166534',
  accentPressed: '#166534',
  accentSubtle: '#152a1c'
};

// 4pt base grid (Material convention).
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999
};

// Single-family Inter, per the sourced type ramp (display 700/-1.5 tracking,
// h1/h2 600/-0.5, body 400, labels 500 uppercase). React Native has no
// letter-spacing-by-em, so tracking is approximated in px per size.
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold'
};

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.extrabold, letterSpacing: -0.5 },
  h1: { fontSize: 21, lineHeight: 27, fontFamily: fontFamily.semibold, letterSpacing: -0.3 },
  h2: { fontSize: 17, lineHeight: 22, fontFamily: fontFamily.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.regular },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.semibold },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.medium },
  micro: { fontSize: 11.5, lineHeight: 14, fontFamily: fontFamily.semibold, letterSpacing: 0.6 }
};

// Android's documented minimum (48dp) — this repo/app is Android-only, so we
// use the Android figure rather than iOS's 44pt.
export const touchTarget = 48;

export const arrowColors: Record<'green' | 'orange' | 'red' | 'blue', string> = {
  green: '#7CDB8A',
  orange: '#F5B266',
  red: '#F27C7C',
  blue: '#7EB8F2'
};

// Distinct from arrowColors.blue (a paler, pastel shade meant for the
// user's own annotations) — an engine suggestion needs to read as clearly
// not a hand-drawn arrow, even when the board also has blue plan/other
// arrows on it.
export const engineColors = {
  best: '#3B82F6',
  alt: '#94a3b8'
};

// Marks where a recorded line branches (the board editor's numbered
// continuations, Study's variant callouts). A hue of its own, so it never
// reads as one of the four annotation colors or as an engine suggestion.
export const variationColor = '#B592F2';

export const boardStyles: { light: string; dark: string }[] = [
  { light: '#e9edcc', dark: '#6a9455' },
  { light: '#e8cfa4', dark: '#97643f' },
  { light: '#cfd8e3', dark: '#5c6b7a' }
];
