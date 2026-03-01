/**
 * SummaryStrip — row of 3 compact stat tiles for analytics summary.
 * Shows workout count, streak days, and total reps.
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Hash, Flame, Repeat } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../../constants/theme';

interface SummaryStripProps {
  workoutCount: number;
  streakDays: number;
  totalReps: number;
}

const SummaryTile = memo(({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  value: string;
  label: string;
}) => (
  <View style={styles.tileOuter}>
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.tileGradient}
    >
      <View style={styles.tileGlassEdge}>
        <View style={styles.tileAccentLine} />
        <Icon size={14} color={COLORS.accent} strokeWidth={1.5} />
        <Text style={styles.tileValue}>{value}</Text>
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
    </LinearGradient>
  </View>
));

export const SummaryStrip: React.FC<SummaryStripProps> = memo(({ workoutCount, streakDays, totalReps }) => {
  const formatNumber = (n: number): string => {
    if (n >= 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  };

  return (
    <View style={styles.container}>
      <SummaryTile icon={Hash} value={String(workoutCount)} label="WORKOUTS" />
      <SummaryTile icon={Flame} value={String(streakDays)} label="DAY STREAK" />
      <SummaryTile icon={Repeat} value={formatNumber(totalReps)} label="TOTAL REPS" />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  tileOuter: {
    flex: 1,
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  tileGradient: {
    flex: 1,
    borderRadius: 19,
  },
  tileGlassEdge: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.md,
    minHeight: 100,
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tileAccentLine: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
    opacity: 0.4,
  },
  tileValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 32,
    color: COLORS.text,
    lineHeight: 38,
    letterSpacing: -0.5,
    marginTop: 6,
    textAlign: 'center',
  },
  tileLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    marginTop: 2,
    textAlign: 'center',
  },
});
