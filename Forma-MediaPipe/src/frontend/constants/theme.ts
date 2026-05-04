/**
 * Forma Mobile - Design System Tokens
 * Graphite glass — neutral graphite gradient, purple primary, green form accent
 */

export const COLORS = {
  // Backgrounds — lifted neutral graphite, close to the reference without skewing blue
  background: '#151A1D',
  cardBackground: '#1A1F23',
  cardBackgroundLight: '#22282D',

  // Primary Actions — Forma Violet
  primary: '#7A55FF',
  primaryDark: '#633FE5',

  // Accent — Forma Violet
  accent: '#7A55FF',
  accentDark: '#633FE5',

  // Secondary Colors
  orange: '#D96F50',
  orangeDark: '#C85E42',
  yellow: '#ECA13A',
  green: '#34E0A6',
  red: '#F05252',

  // Text
  text: '#FFFFFF',
  textSecondary: '#ADB2B6',
  textTertiary: '#6B7176',

  // UI Elements
  border: 'rgba(255, 255, 255, 0.07)',
  borderStrong: 'rgba(255, 255, 255, 0.10)',
  inactive: '#383E43',

  // Chart colors
  chartPrimary: '#34E0A6',
  chartSecondary: 'rgba(255, 255, 255, 0.052)',

  // Overlays
  overlayBackground: 'rgba(6,10,13,0.87)',

  // Glow — soft violet
  glowViolet: 'rgba(122, 85, 255, 0.30)',
  glowVioletStrong: 'rgba(122, 85, 255, 0.50)',
} as const;

/** Standard screen background gradient — graphite vertical */
export const SCREEN_GRADIENT_COLORS: readonly [string, string, string] = ['#303438', '#1C2125', '#151A1D'];
export const SCREEN_GRADIENT_START = { x: 0.5, y: 0 } as const;
export const SCREEN_GRADIENT_END = { x: 0.5, y: 1 } as const;

/** Glass card surface gradient — matches the homepage card treatment */
export const CARD_GRADIENT_COLORS: readonly [string, string, string] = ['#202529', '#21262A', '#22272B'];
export const CARD_GRADIENT_START = { x: 0.5, y: 1 } as const;
export const CARD_GRADIENT_END = { x: 0.5, y: 0 } as const;

/** Stronger card gradient for elevated surfaces */
export const CARD_GRADIENT_ELEVATED: readonly [string, string, string] = ['#22272B', '#23282C', '#252A2F'];

/** Card radius — moderate rounding for compact pro look */
export const CARD_RADIUS = 14;
export const CARD_RADIUS_SM = 10;
export const CARD_RADIUS_LG = 18;
export const CARD_VERTICAL_GAP = 18;

/** Glass card flat surface (no gradient) */
export const CARD_STYLE = {
  backgroundColor: '#1A1F23',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.07)',
  borderRadius: CARD_RADIUS,
} as const;

/** Card surfaces avoid legacy shadows because clipped Android elevation can render as a black inset while content mounts. */
export const CARD_SHADOW = {
  shadowColor: 'transparent',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
} as const;

export const getScoreColor = (score: number): string => {
  if (score >= 90) return '#34E0A6';   // emerald (form accent)
  if (score >= 75) return '#7A55FF';   // violet
  if (score >= 50) return '#ECA13A';   // yellow
  return '#D96F50';                    // orange
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  screenHorizontal: 16,
} as const;

export const FONTS = {
  // Brand wordmark — Urbanist, wide-tracked geometric sans
  brand: {
    semibold: 'Urbanist_600SemiBold',
    bold: 'Urbanist_700Bold',
    semiboldFallback: 'System',
    boldFallback: 'System',
  },
  // Display — Geist, close to SF Pro's clean product UI feel
  display: {
    medium: 'Geist_500Medium',
    semibold: 'Geist_600SemiBold',
    bold: 'Geist_700Bold',
    mediumFallback: 'System',
    semiboldFallback: 'System',
    boldFallback: 'System',
  },
  // UI Font — Geist
  ui: {
    regular: 'Geist_400Regular',
    medium: 'Geist_500Medium',
    bold: 'Geist_600SemiBold',
    regularFallback: 'System',
    mediumFallback: 'System',
    boldFallback: 'System',
  },
  // Numbers/HUD — Geist with tabular numerals where alignment matters
  mono: {
    regular: 'Geist_500Medium',
    bold: 'Geist_700Bold',
    regularFallback: 'System',
    boldFallback: 'System',
  },
} as const;
