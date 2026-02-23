/**
 * RetryButton - Simple retry action button
 */

import React, { memo } from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../../constants/theme';

interface RetryButtonProps {
  onPress: () => void;
  label?: string;
  style?: ViewStyle;
}

export const RetryButton: React.FC<RetryButtonProps> = memo(({
  onPress,
  label = 'Retry',
  style,
}) => {
  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <RefreshCw size={16} color={COLORS.primary} />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  label: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
});
