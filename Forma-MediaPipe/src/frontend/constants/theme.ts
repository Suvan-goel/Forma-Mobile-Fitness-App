/**
 * Forma Mobile - Design System Tokens
 * Graphite glass — neutral dark gradient, purple primary, green form accent
 */

export const COLORS = {
  // Backgrounds — deep graphite, close to black without feeling flat
  background: '#070A0D',
  cardBackground: '#171B1E',
  cardBackgroundLight: '#1E2225',

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
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(255, 255, 255, 0.085)',
  inactive: '#33383D',

  // Chart colors
  chartPrimary: '#34E0A6',
  chartSecondary: 'rgba(255, 255, 255, 0.045)',

  // Overlays
  overlayBackground: 'rgba(4,8,12,0.88)',

  // Glow — soft violet
  glowViolet: 'rgba(122, 85, 255, 0.30)',
  glowVioletStrong: 'rgba(122, 85, 255, 0.50)',
} as const;

/** Standard screen background gradient — graphite vertical */
export const SCREEN_GRADIENT_COLORS: readonly [string, string, string] = ['#202326', '#121619', '#070A0D'];
export const SCREEN_GRADIENT_START = { x: 0.5, y: 0 } as const;
export const SCREEN_GRADIENT_END = { x: 0.5, y: 1 } as const;

/** Glass card surface gradient — matches the homepage card treatment */
export const CARD_GRADIENT_COLORS: readonly [string, string, string] = ['#171B1E', '#1C2023', '#202428'];
export const CARD_GRADIENT_START = { x: 0.5, y: 1 } as const;
export const CARD_GRADIENT_END = { x: 0.5, y: 0 } as const;

/** Stronger card gradient for elevated surfaces */
export const CARD_GRADIENT_ELEVATED: readonly [string, string, string] = ['#171B1E', '#1C2023', '#202428'];

/** Card radius — moderate rounding for compact pro look */
export const CARD_RADIUS = 14;
export const CARD_RADIUS_SM = 10;
export const CARD_RADIUS_LG = 18;

/** Card glass edge — thin light border */
export const CARD_GLASS_BORDER = {
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.06)',
  borderRadius: CARD_RADIUS,
} as const;

/** Glass card flat surface (no gradient) */
export const CARD_STYLE = {
  backgroundColor: '#171B1E',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.06)',
  borderRadius: CARD_RADIUS,
} as const;

/** Violet glow shadow for iOS */
export const GLOW_SHADOW = {
  shadowColor: '#7A55FF',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.45,
  shadowRadius: 18,
  elevation: 8,
} as const;

/** Soft elevation for cards */
export const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.32,
  shadowRadius: 16,
  elevation: 6,
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
  // Display — Space Grotesk (Modern Geometric Grotesk)
  display: {
    medium: 'SpaceGrotesk_500Medium',
    semibold: 'SpaceGrotesk_600SemiBold',
    bold: 'SpaceGrotesk_700Bold',
    mediumFallback: 'System',
    semiboldFallback: 'System',
    boldFallback: 'System',
  },
  // UI Font — Inter (Sans-Serif)
  ui: {
    regular: 'Inter_400Regular',
    bold: 'Inter_700Bold',
    regularFallback: 'System',
    boldFallback: 'System',
  },
  // Numbers/HUD — JetBrains Mono
  mono: {
    regular: 'JetBrainsMono_400Regular',
    bold: 'JetBrainsMono_700Bold',
    regularFallback: 'Courier',
    boldFallback: 'Courier',
  },
} as const;
