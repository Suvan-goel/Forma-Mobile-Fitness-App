/**
 * EmptyState - Display when no data is available
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Inbox, LucideIcon } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../../constants/theme';
import { NeonButton } from './NeonButton';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
  style?: ViewStyle;
}

export const EmptyState: React.FC<EmptyStateProps> = memo(({
  title,
  message,
  actionLabel,
  onAction,
  icon: Icon = Inbox,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <Icon size={32} color={COLORS.textSecondary} />
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <NeonButton
          title={actionLabel}
          variant="primary"
          onPress={onAction}
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
    gap: SPACING.sm,
  },
  title: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  button: {
    marginTop: SPACING.md,
    minWidth: 140,
  },
});
