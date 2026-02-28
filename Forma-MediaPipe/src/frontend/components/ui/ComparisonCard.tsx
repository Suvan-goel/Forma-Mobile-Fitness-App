/**
 * ComparisonCard — Side-by-side stat comparison card
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, CARD_STYLE } from '../../constants/theme';

interface ComparisonCardProps {
  label: string;
  yourValue: number;
  friendValue: number;
  format?: 'score' | 'integer' | 'decimal';
  higherIsBetter?: boolean;
}

export const ComparisonCard: React.FC<ComparisonCardProps> = memo(({
  label,
  yourValue,
  friendValue,
  format = 'decimal',
  higherIsBetter = true,
}) => {
  const youWins = higherIsBetter ? yourValue >= friendValue : yourValue <= friendValue;
  const friendWins = !youWins;
  const isDraw = yourValue === friendValue;

  const formatValue = (val: number) => {
    switch (format) {
      case 'integer': return val.toString();
      case 'score': return val.toFixed(0);
      case 'decimal': return val.toFixed(1);
    }
  };

  return (
    <View style={styles.card}>
      {/* Your side */}
      <View style={styles.side}>
        <Text style={[
          styles.value,
          youWins && !isDraw && styles.valueWinner,
        ]}>
          {formatValue(yourValue)}
        </Text>
      </View>

      {/* Label */}
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{label}</Text>
      </View>

      {/* Friend side */}
      <View style={styles.side}>
        <Text style={[
          styles.value,
          friendWins && !isDraw && styles.valueWinner,
        ]}>
          {formatValue(friendValue)}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...CARD_STYLE,
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  side: {
    flex: 1,
    alignItems: 'center',
  },
  value: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.textSecondary,
  },
  valueWinner: {
    color: '#34D399',
  },
  labelContainer: {
    paddingHorizontal: SPACING.md,
  },
  label: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
});
