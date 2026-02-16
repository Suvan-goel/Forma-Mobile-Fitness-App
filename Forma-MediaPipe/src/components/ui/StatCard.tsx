/**
 * StatCard — Cyber-minimalist bento-grid metric card
 *
 * Stealth-surface card with a bold grotesk number (Space Grotesk SemiBold),
 * small-caps label, and optional ultra-thin micro bar-chart in electric violet.
 * Icons are lucide-react-native thin strokes in violet.
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Zap, Activity, Target, Dumbbell } from 'lucide-react-native';
import { COLORS, FONTS, CARD_STYLE, SPACING } from '../../constants/theme';

const ICON_MAP: Record<string, any> = {
  move: Zap,
  exercise: Activity,
  consistency: Target,
  strength: Dumbbell,
};

interface StatCardProps {
  label: string;
  value: string;
  suffix?: string;
  iconName?: string;
  barData?: number[];
  fullWidth?: boolean;
}

/** Ultra-thin micro bar chart — 3px bars, 2px gap, electric violet */
const MicroBars: React.FC<{ data: number[] }> = memo(({ data }) => {
  const barCount = data.length;
  const barWidth = 3;
  const gap = 2;
  const chartHeight = 24;
  const chartWidth = barCount * (barWidth + gap) - gap;

  return (
    <View style={barStyles.container}>
      <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        {data.map((val, i) => {
          const h = Math.max(2, (val / 100) * chartHeight);
          const x = i * (barWidth + gap);
          const y = chartHeight - h;
          const opacity = val > 0 ? 0.4 + (val / 100) * 0.6 : 0.08;
          return (
            <React.Fragment key={i}>
              <Rect
                x={x}
                y={0}
                width={barWidth}
                height={chartHeight}
                rx={1}
                fill="#FFFFFF"
                opacity={0.04}
              />
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                rx={1}
                fill={COLORS.accent}
                opacity={opacity}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
});

const barStyles = StyleSheet.create({
  container: {
    marginTop: 14,
  },
});

export const StatCard: React.FC<StatCardProps> = memo(({ label, value, suffix, iconName, barData, fullWidth }) => {
  const IconComponent = iconName ? ICON_MAP[iconName.toLowerCase()] : null;

  return (
    <View style={[styles.card, fullWidth && styles.cardFullWidth]}>
      <View style={styles.header}>
        {IconComponent && (
          <IconComponent
            size={14}
            color={COLORS.accent}
            strokeWidth={1.5}
          />
        )}
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      </View>

      <View style={styles.metricRow}>
        <Text style={styles.value}>{value}</Text>
        {suffix && <Text style={styles.suffix}>{suffix}</Text>}
      </View>

      {barData && barData.length > 0 && <MicroBars data={barData} />}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...CARD_STYLE,
    flex: 1,
    padding: SPACING.xl,
    minHeight: 150,
    justifyContent: 'space-between',
  },
  cardFullWidth: {
    flex: undefined,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 10,
  },
  value: {
    fontFamily: FONTS.display.semibold,
    fontSize: 42,
    color: COLORS.text,
    lineHeight: 48,
    letterSpacing: -1.5,
    includeFontPadding: false,
  },
  suffix: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 4,
  },
});
