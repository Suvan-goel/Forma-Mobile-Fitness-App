/**
 * Forma Mobile - Design System Tokens
 * Clean minimal fitness tracker with turquoise accents
 * Based on reference design
 */

export const COLORS = {
  // Backgrounds
  background: '#000000', // App Background - Pure black
  cardBackground: '#262626', // Card Background
  cardBackgroundLight: '#262626', // Lighter card background

  // Primary Actions
  primary: '#10B981', // Green - Primary accent
  primaryDark: '#059669', // Darker green for gradients
  
  // Secondary Colors
  orange: '#E07856', // Orange for secondary workout cards
  orangeDark: '#D86648',
  yellow: '#F5A623', // Yellow/Gold for progress indicators

  // Text
  text: '#FFFFFF', // Pure White
  textSecondary: '#8B92A0', // Muted Blue-Gray
  textTertiary: '#5A6270', // Darker Gray
  
  // UI Elements
  border: '#2A3340', // Subtle dark borders
  inactive: '#4A5568', // Inactive elements
  
  // Chart colors
  chartPrimary: '#10B981',
  chartSecondary: '#3A4550',
} as const;

/** Standard card styling - #262626 background, no border, 14px radius */
export const CARD_STYLE = {
  backgroundColor: '#262626',
  borderWidth: 0,
  borderRadius: 14,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  /** Reduced horizontal padding for screen edges - uses more of phone width */
  screenHorizontal: 12,
} as const;

export const FONTS = {
  // UI Font - Inter (Sen alternative)
  ui: {
    regular: 'Inter_400Regular',
    bold: 'Inter_700Bold',
  },
  // Numbers/HUD Font - JetBrains Mono
  mono: {
    regular: 'JetBrainsMono_400Regular',
    bold: 'JetBrainsMono_700Bold',
  },
} as const;
