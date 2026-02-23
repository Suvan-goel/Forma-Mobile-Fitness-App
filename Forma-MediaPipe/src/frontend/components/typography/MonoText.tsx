import React, { memo } from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';

interface MonoTextProps extends Omit<TextProps, 'style'> {
  bold?: boolean;
  color?: string;
  style?: TextProps['style'];
}

export const MonoText: React.FC<MonoTextProps> = memo(({
  bold = false,
  color = COLORS.text,
  style,
  children,
  ...textProps
}) => {
  // Ensure bold is explicitly boolean
  const isBold = Boolean(bold);
  
  // Don't spread any props - only pass style and children
  // This completely prevents any prop leakage to native Text component
  return (
    <Text
      style={[
        styles.base,
        isBold ? styles.bold : styles.regular,
        { color },
        style,
      ]}
    >
      {children}
    </Text>
  );
});

const styles = StyleSheet.create({
  base: {
    fontFamily: FONTS.mono.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  regular: {
    fontFamily: FONTS.mono.regular,
  },
  bold: {
    fontFamily: FONTS.mono.bold,
  },
});

