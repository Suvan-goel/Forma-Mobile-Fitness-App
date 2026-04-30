/**
 * Forma Mobile - Design System Tokens
 * Graphite glass — neutral dark gradient, purple primary, green form accent
 */

export const COLORS = {
  // Backgrounds (graphite, NOT pure black, NOT purple)
  background: '#1B2126',
  cardBackground: '#222A30',
  cardBackgroundLight: '#2A3136',

  // Primary Actions — Forma Violet
  primary: '#7C5CFF',
  primaryDark: '#6746E8',

  // Accent — Forma Violet
  accent: '#7C5CFF',
  accentDark: '#6746E8',

  // Secondary Colors
  orange: '#E07856',
  orangeDark: '#D86648',
  yellow: '#F5A623',
  green: '#34D399',
  red: '#EF4444',

  // Text
  text: '#FFFFFF',
  textSecondary: '#B8C0C7',
  textTertiary: '#7A848D',

  // UI Elements
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  inactive: '#4A5563',

  // Chart colors
  chartPrimary: '#34D399',
  chartSecondary: 'rgba(255,255,255,0.06)',

  // Overlays
  overlayBackground: 'rgba(8,12,16,0.85)',

  // Glow — soft violet
  glowViolet: 'rgba(124, 92, 255, 0.32)',
  glowVioletStrong: 'rgba(124, 92, 255, 0.55)',
} as const;

/** Standard screen background gradient — graphite vertical */
export const SCREEN_GRADIENT_COLORS: readonly [string, string, string] = ['#353B40', '#252B30', '#11181D'];
export const SCREEN_GRADIENT_START = { x: 0.5, y: 0 } as const;
export const SCREEN_GRADIENT_END = { x: 0.5, y: 1 } as const;

/** Glass card surface gradient (premium graphite, low-contrast bottom-to-top sheen) */
export const CARD_GRADIENT_COLORS: readonly [string, string, string] = ['#252D32', '#273035', '#2A3338'];
export const CARD_GRADIENT_START = { x: 0.5, y: 1 } as const;
export const CARD_GRADIENT_END = { x: 0.5, y: 0 } as const;

/** Stronger card gradient for elevated surfaces */
export const CARD_GRADIENT_ELEVATED: readonly [string, string, string] = ['#273037', '#2A3339', '#2D363C'];

/** Card radius — moderate rounding for compact pro look */
export const CARD_RADIUS = 14;
export const CARD_RADIUS_SM = 10;
export const CARD_RADIUS_LG = 18;

/** Card glass edge — thin light border */
export const CARD_GLASS_BORDER = {
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.11)',
  borderRadius: CARD_RADIUS,
} as const;

/** Glass card flat surface (no gradient) */
export const CARD_STYLE = {
  backgroundColor: '#20282E',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.11)',
  borderRadius: CARD_RADIUS,
} as const;

/** Violet glow shadow for iOS */
export const GLOW_SHADOW = {
  shadowColor: '#7C5CFF',
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
  if (score >= 90) return '#34D399';   // emerald (form accent)
  if (score >= 75) return '#7C5CFF';   // violet
  if (score >= 50) return '#F5A623';   // yellow
  return '#E07856';                    // orange
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
