/**
 * NeonArc — Precision horseshoe gauge with electric violet UV bloom
 *
 * A 240-degree arc opening at the BOTTOM, rendered with react-native-svg.
 * Geometry: Start at 8 o'clock (left), CW over the top, end at 4 o'clock (right).
 * The 120° gap sits symmetrically at the bottom.
 *
 * Text is optically centered in the bowl of the horseshoe.
 * Numbers rendered in Space Grotesk SemiBold (geometric grotesk).
 */

import React, { memo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COLORS, FONTS } from '../../constants/theme';

interface NeonArcProps {
  value: number;
  label: string;
  displayValue?: string;
  size?: number;
  strokeWidth?: number;
  /** Trend direction arrow shown below the label */
  trendDirection?: 'up' | 'down' | 'flat';
  /** Trend percentage (e.g. 34.4) shown below the label */
  trendPercent?: number;
}

const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

const pointOnCircle = (cx: number, cy: number, r: number, deg: number) => ({
  x: cx + r * Math.cos(toRad(deg)),
  y: cy + r * Math.sin(toRad(deg)),
});

const describeArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number): string => {
  const p1 = pointOnCircle(cx, cy, r, startDeg);
  const p2 = pointOnCircle(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
};

// 240° horseshoe: 8 o'clock → over top → 4 o'clock. Gap at bottom.
const ARC_START = -120;
const ARC_END = 120;
const ARC_SWEEP = ARC_END - ARC_START;

export const NeonArc: React.FC<NeonArcProps> = memo(({
  value,
  label,
  displayValue,
  size = 280,
  strokeWidth = 14,
  trendDirection,
  trendPercent,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth * 2) / 2;

  const clampedValue = Math.min(Math.max(value, 0), 100);
  const progressEnd = ARC_START + (ARC_SWEEP * clampedValue) / 100;

  const trackPath = describeArc(cx, cy, r, ARC_START, ARC_END);
  const progressPath = clampedValue > 0 ? describeArc(cx, cy, r, ARC_START, progressEnd) : '';
  const knob = pointOnCircle(cx, cy, r, progressEnd);

  const tickInner = r + strokeWidth / 2 + 4;
  const tickOuter = tickInner + 8;
  const makeTick = (deg: number) => {
    const p1 = pointOnCircle(cx, cy, tickInner, deg);
    const p2 = pointOnCircle(cx, cy, tickOuter, deg);
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  };

  const viewHeight = size * 0.82;
  const textCenterY = cy - size * 0.02;

  return (
    <Animated.View
      style={[styles.container, { width: size, height: viewHeight, opacity: fadeAnim }]}
    >
      {Platform.OS === 'ios' && (
        <View
          style={[styles.glowLayer, { width: size, height: viewHeight }]}
          pointerEvents="none"
        />
      )}

      <Svg width={size} height={viewHeight} viewBox={`0 0 ${size} ${viewHeight}`}>
        <Defs>
          <LinearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#633FE5" stopOpacity="0.4" />
            <Stop offset="50%" stopColor="#7A55FF" stopOpacity="1" />
            <Stop offset="100%" stopColor="#A395FF" stopOpacity="0.7" />
          </LinearGradient>
        </Defs>

        {/* Background track */}
        <Path
          d={trackPath}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Active progress arc */}
        {clampedValue > 0 && (
          <Path
            d={progressPath}
            fill="none"
            stroke="url(#arcGrad)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}

        {/* Knob — violet tip */}
        {clampedValue > 0 && (
          <Circle
            cx={knob.x}
            cy={knob.y}
            r={strokeWidth / 2 + 1.5}
            fill="#A78BFA"
            opacity={0.9}
          />
        )}

        {/* Endpoint ticks */}
        <Path d={makeTick(ARC_START)} stroke={COLORS.textTertiary} strokeWidth={1.5} strokeLinecap="round" />
        <Path d={makeTick(ARC_END)} stroke={COLORS.textTertiary} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>

      {/* Centre text — Space Grotesk SemiBold */}
      <View style={[styles.centerText, { top: textCenterY - 52 }]}>
        <Text style={styles.valueText}>{displayValue ?? value}</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.labelText}>{label.toUpperCase()}</Text>
        {trendDirection && trendPercent !== undefined && trendPercent > 0 && (
          <View style={styles.trendRow}>
            <Text style={[
              styles.trendArrow,
              { color: trendDirection === 'up' ? '#34E0A6' : trendDirection === 'down' ? '#E07856' : COLORS.textTertiary },
            ]}>
              {trendDirection === 'up' ? '\u25B2' : trendDirection === 'down' ? '\u25BC' : '\u2500'}
            </Text>
            <Text style={[
              styles.trendText,
              { color: trendDirection === 'up' ? '#34E0A6' : trendDirection === 'down' ? '#E07856' : COLORS.textTertiary },
            ]}>
              {trendPercent}%
            </Text>
            <Text style={styles.trendLabel}>vs prev</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    alignSelf: 'center',
  },
  glowLayer: {
    position: 'absolute',
    shadowColor: '#7A55FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  centerText: {
    position: 'absolute',
    alignItems: 'center',
    left: 0,
    right: 0,
  },
  valueText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 64,
    color: COLORS.text,
    lineHeight: 68,
    letterSpacing: -2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  labelText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 3,
    textAlign: 'center',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
  },
  trendArrow: {
    fontSize: 10,
  },
  trendText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  trendLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
});
