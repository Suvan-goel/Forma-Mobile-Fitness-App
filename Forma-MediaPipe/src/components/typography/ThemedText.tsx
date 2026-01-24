import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';

type TextVariant = 'h1' | 'h2' | 'body' | 'caption';

interface ThemedTextProps extends Omit<TextProps, 'style'> {
  variant?: TextVariant;
  color?: string;
  style?: TextProps['style'];
}

export const ThemedText: React.FC<ThemedTextProps> = ({
  variant = 'body',
  color = COLORS.text,
  style,
  children,
  ...textProps
}) => {
  // Don't spread any props - only pass style and children
  // This completely prevents any prop leakage to native Text component
  return (
    <Text style={[styles.base, styles[variant], { color }, style]}>
      {children}
    </Text>
  );
};

const styles = StyleSheet.create({
  base: {
    fontFamily: FONTS.ui.regular,
  },
  h1: {
    fontSize: 32,
    lineHeight: 40,
    fontFamily: FONTS.ui.bold,
  },
  h2: {
    fontSize: 24,
    lineHeight: 32,
    fontFamily: FONTS.ui.bold,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: FONTS.ui.regular,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.ui.regular,
  },
});

