/**
 * ComparisonCard — Side-by-side stat comparison with visual bar
 */

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END ,
  CARD_SHADOW
} from '../../constants/theme';

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
  const youWins = higherIsBetter ? yourValue > friendValue : yourValue < friendValue;
  const friendWins = higherIsBetter ? friendValue > yourValue : friendValue < yourValue;
  const isDraw = yourValue === friendValue;

  const formatValue = (val: number) => {
    switch (format) {
      case 'integer': return val.toString();
      case 'score': return val.toFixed(0);
      case 'decimal': return val.toFixed(1);
    }
  };

  // Compute bar widths proportionally
  const barWidths = useMemo(() => {
    const total = yourValue + friendValue;
    if (total === 0) return { you: 50, friend: 50 };
    return {
      you: Math.max(15, (yourValue / total) * 100),
      friend: Math.max(15, (friendValue / total) * 100),
    };
  }, [yourValue, friendValue]);

  const youColor = youWins ? '#34E0A6' : isDraw ? COLORS.textSecondary : COLORS.textTertiary;
  const friendColor = friendWins ? '#34E0A6' : isDraw ? COLORS.textSecondary : COLORS.textTertiary;

  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.card}
      >
        <View style={styles.cardEdge}>
          {/* Label */}
          <Text style={styles.label}>{label}</Text>

          {/* Values row */}
          <View style={styles.valuesRow}>
            <Text style={[styles.value, { color: youColor }]}>
              {formatValue(yourValue)}
            </Text>
            <Text style={[styles.value, { color: friendColor }]}>
              {formatValue(friendValue)}
            </Text>
          </View>

          {/* Comparison bar */}
          <View style={styles.barContainer}>
            <View style={[
              styles.barLeft,
              { width: `${barWidths.you}%` },
              youWins && styles.barWinner,
              isDraw && styles.barDraw,
            ]} />
            <View style={styles.barGap} />
            <View style={[
              styles.barRight,
              { width: `${barWidths.friend}%` },
              friendWins && styles.barWinner,
              isDraw && styles.barDraw,
            ]} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
    borderRadius: 18,

    ...CARD_SHADOW,
},
  card: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 18,

    ...CARD_SHADOW,
},
  cardEdge: {
    padding: SPACING.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  label: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  value: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
  },
  barContainer: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barLeft: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  barRight: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  barGap: {
    width: 4,
  },
  barWinner: {
    backgroundColor: 'rgba(52, 211, 153, 0.4)',
  },
  barDraw: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
});
