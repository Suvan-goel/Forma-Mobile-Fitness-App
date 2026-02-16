/**
 * Forma Mobile - Design System Tokens
 * Cyber-Minimalist — OLED black, electric violet, bold grotesk
 */

export const COLORS = {
  // Backgrounds
  background: '#000000',
  cardBackground: '#0A0A0A',
  cardBackgroundLight: '#141414',

  // Primary Actions — Teal (used across the app)
  primary: '#00ac7c',
  primaryDark: '#00936a',

  // Accent — Electric Violet
  accent: '#8B5CF6',
  accentDark: '#7C3AED',

  // Secondary Colors
  orange: '#E07856',
  orangeDark: '#D86648',
  yellow: '#F5A623',

  // Text
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#52525B',

  // UI Elements
  border: '#1C1C1E',
  inactive: '#4A5568',

  // Chart colors
  chartPrimary: '#00ac7c',
  chartSecondary: 'rgba(255,255,255,0.06)',

  // Neon glow — UV blacklight violet
  glowViolet: 'rgba(139, 92, 246, 0.35)',
  glowVioletStrong: 'rgba(139, 92, 246, 0.55)',
} as const;

/** Editorial card — near-black stealth surface with hairline border */
export const CARD_STYLE = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  borderRadius: 20,
} as const;

/** Violet glow shadow for iOS — apply with spread operator */
export const GLOW_SHADOW = {
  shadowColor: '#8B5CF6',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.5,
  shadowRadius: 20,
  elevation: 8,
} as const;

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
  // Legacy Serif — Playfair Display (kept for non-analytics screens)
  serif: {
    regular: 'PlayfairDisplay_400Regular',
    bold: 'PlayfairDisplay_700Bold',
    black: 'PlayfairDisplay_900Black',
    regularFallback: 'Georgia',
    boldFallback: 'Georgia',
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
