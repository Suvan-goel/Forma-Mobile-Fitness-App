/**
 * ErrorState - Display error messages with retry action
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../../constants/theme';
import { NeonButton } from './NeonButton';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export const ErrorState: React.FC<ErrorStateProps> = memo(({
  message,
  onRetry,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <AlertCircle size={32} color={COLORS.orange} />
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <NeonButton
          title="Try Again"
          variant="ghost"
          onPress={onRetry}
          style={styles.button}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...CARD_STYLE,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  message: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  button: {
    marginTop: SPACING.sm,
    minWidth: 120,
  },
});
