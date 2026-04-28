/**
 * TrendChart — SVG line/area chart with glass card container.
 * Uses react-native-svg (already installed). No additional dependencies.
 *
 * Renders a smooth Catmull-Rom spline with violet gradient fill.
 */

import React, { useMemo, memo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Text as SvgText, ClipPath, Rect, G } from 'react-native-svg';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../../constants/theme';

const SCREEN_W = Dimensions.get('window').width;
const CHART_CARD_GRADIENT: readonly [string, string, string] = ['#2A3136', '#222A30', '#192126'];
const CHART_CARD_BORDER = 'rgba(255,255,255,0.085)';
const CHART_CARD_SHADOW = 'rgba(0,0,0,0.22)';

interface TrendChartProps {
  title: string;
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  data: { values: number[]; dates: Date[] };
  unit?: string;
  height?: number;
  formatValue?: (v: number) => string;
  timeRange: string;
  /** When provided, shown in the card header by default (period average).
   *  Tapping a data point temporarily shows that point's value instead. */
  headerValue?: number;
  headerLabel?: string;
  accentColor?: string;
  compact?: boolean;
}

// ── Catmull-Rom → Cubic Bezier conversion ───────────────────────

interface Point {
  x: number;
  y: number;
}

function catmullRomToBezierPath(
  points: Point[],
  tension: number = 0.3,
  yMin?: number,
  yMax?: number,
): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }

  const clampY = (y: number) =>
    yMin !== undefined && yMax !== undefined
      ? Math.min(Math.max(y, yMin), yMax)
      : y;

  let path = `M${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = clampY(p1.y + (p2.y - p0.y) * tension);
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = clampY(p2.y - (p3.y - p1.y) * tension);

    path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}

// ── X-axis label formatting ─────────────────────────────────────

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateLabel(date: Date, timeRange: string): string {
  switch (timeRange) {
    case '1 week':
      return DAY_ABBR[date.getDay()];
    case '4 weeks':
      return `${date.getDate()}/${date.getMonth() + 1}`;
    default:
      return MONTH_ABBR[date.getMonth()];
  }
}

function pickXLabels(dates: Date[], maxLabels: number): number[] {
  if (dates.length <= maxLabels) return dates.map((_, i) => i);
  const step = (dates.length - 1) / (maxLabels - 1);
  const indices: number[] = [];
  for (let i = 0; i < maxLabels; i++) {
    indices.push(Math.round(i * step));
  }
  return indices;
}

// ── Component ───────────────────────────────────────────────────

export const TrendChart: React.FC<TrendChartProps> = memo(({
  title,
  icon: Icon,
  data,
  unit = '',
  height = 160,
  formatValue,
  timeRange,
  headerValue,
  headerLabel,
  accentColor = COLORS.accent,
  compact = false,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const accentGlow = accentColor === '#34D399'
    ? 'rgba(52,211,153,0.22)'
    : 'rgba(124,92,255,0.22)';
  const accentArea = accentColor === '#34D399'
    ? 'rgba(52,211,153,0.25)'
    : 'rgba(124,92,255,0.25)';
  const chartId = title.replace(/[^a-zA-Z0-9]/g, '');

  const chartWidth = SCREEN_W - SPACING.screenHorizontal * 2 - SPACING.xl * 2;
  const padLeft = compact ? 28 : 32;
  const padRight = 8;
  const padTop = compact ? 18 : 26;
  const padBottom = compact ? 24 : 32;
  const graphW = chartWidth - padLeft - padRight;
  const graphH = height - padTop - padBottom;

  const svgContent = useMemo(() => {
    if (data.values.length === 0) return null;

    const vals = data.values;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const rawRange = maxVal - minVal || 1;
    // Pad the data range by 10% so min/max values don't sit at the very
    // edge of the chart — gives the bezier curves room to stay smooth.
    const rangePad = rawRange * 0.1;
    const displayMin = minVal - rangePad;
    const displayRange = rawRange + rangePad * 2;

    // Single data point — render a dot with a horizontal baseline
    if (vals.length === 1) {
      const centerX = padLeft + graphW / 2;
      const centerY = padTop + graphH / 2;
      return {
        linePath: `M${padLeft},${centerY} L${padLeft + graphW},${centerY}`,
        areaPath: `M${padLeft},${centerY} L${padLeft + graphW},${centerY} L${padLeft + graphW},${padTop + graphH} L${padLeft},${padTop + graphH} Z`,
        points: [{ x: centerX, y: centerY }],
        yLabels: [{ value: vals[0], y: centerY }],
        xLabels: [{ label: formatDateLabel(data.dates[0], timeRange), x: centerX }],
        lastPt: { x: centerX, y: centerY },
      };
    }

    // Compute points with padded range
    const points: Point[] = vals.map((v, i) => ({
      x: padLeft + (i / (vals.length - 1)) * graphW,
      y: padTop + graphH - ((v - displayMin) / displayRange) * graphH,
    }));

    // Line path (clamp control points to chart bounds to prevent overshoot)
    const linePath = catmullRomToBezierPath(points, 0.15, padTop, padTop + graphH);

    // Area path — line path + close along bottom
    const lastPt = points[points.length - 1];
    const firstPt = points[0];
    const areaPath = `${linePath} L${lastPt.x},${padTop + graphH} L${firstPt.x},${padTop + graphH} Z`;

    // Y-axis labels — position using the same padded mapping as data points
    const valToY = (v: number) => padTop + graphH - ((v - displayMin) / displayRange) * graphH;
    const yLabels = [
      { value: maxVal, y: valToY(maxVal) },
      { value: Math.round((maxVal + minVal) / 2), y: valToY((maxVal + minVal) / 2) },
      { value: minVal, y: valToY(minVal) },
    ];

    // X-axis labels
    const xIndices = pickXLabels(data.dates, 5);
    const xLabels = xIndices.map((idx) => ({
      label: formatDateLabel(data.dates[idx], timeRange),
      x: points[idx].x,
    }));

    return { linePath, areaPath, points, yLabels, xLabels, lastPt };
  }, [data.values, data.dates, graphW, graphH, padLeft, padTop, timeRange]);

  const activeIndex =
    data.values.length > 0
      ? selectedIndex != null
        ? selectedIndex
        : data.values.length - 1
      : null;

  // Header always shows period average (headerValue) or last point if no headerValue.
  const primaryValue = headerValue !== undefined
    ? headerValue
    : (activeIndex != null ? data.values[activeIndex] : 0);
  const displayValue = formatValue ? formatValue(primaryValue) : String(Math.round(primaryValue));

  // Secondary: selected point's value + date label (visible alongside the primary).
  const selectedDisplayValue = selectedIndex != null
    ? (formatValue ? formatValue(data.values[selectedIndex]) : String(Math.round(data.values[selectedIndex])))
    : null;
  const selectedDateLabel = selectedIndex != null && data.dates[selectedIndex]
    ? formatDateLabel(data.dates[selectedIndex], timeRange)
    : null;

  const activePoint =
    svgContent && activeIndex != null ? svgContent.points[activeIndex] : null;

  const handlePointPress = useCallback(
    (evt: any) => {
      if (!svgContent || svgContent.points.length === 0) return;
      const x = evt.nativeEvent.locationX as number;
      let nearestIndex = 0;
      let minDist = Number.POSITIVE_INFINITY;
      svgContent.points.forEach((pt, idx) => {
        const dist = Math.abs(pt.x - x);
        if (dist < minDist) {
          minDist = dist;
          nearestIndex = idx;
        }
      });
      setSelectedIndex(nearestIndex);
    },
    [svgContent],
  );

  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={[...CHART_CARD_GRADIENT]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={[styles.cardGlassEdge, compact && styles.cardGlassEdgeCompact]}>
          {/* Header */}
          <View style={[styles.header, compact && styles.headerCompact]}>
            <View style={styles.headerLeft}>
              <Icon size={14} color={accentColor} strokeWidth={1.5} />
              <Text style={styles.headerTitle}>{title}</Text>
            </View>
            <View style={styles.headerRight}>
              {headerLabel ? <Text style={styles.headerValueLabel}>{headerLabel}</Text> : null}
              <View style={styles.avgRow}>
                <Text style={[styles.currentValue, compact && styles.currentValueCompact, { color: accentColor }]}>{displayValue}</Text>
                {unit ? <Text style={styles.unitText}>{unit}</Text> : null}
              </View>
              {selectedDisplayValue != null && (
                <Text style={[styles.selectedPointText, { color: accentColor }]}>
                  {selectedDisplayValue}{unit ? ` ${unit}` : ''} · {selectedDateLabel}
                </Text>
              )}
            </View>
          </View>

          {/* Chart */}
          {svgContent ? (
            <Svg width={chartWidth} height={height} onPress={handlePointPress}>
              <Defs>
                {/* userSpaceOnUse + pixel coords so gradient renders correctly on native (objectBoundingBox can show solid fill) */}
                <SvgGradient
                  id={`areaGrad${chartId}`}
                  x1={padLeft}
                  y1={padTop}
                  x2={padLeft}
                  y2={padTop + graphH}
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0" stopColor={accentArea} stopOpacity="1" />
                  <Stop offset="1" stopColor={accentArea} stopOpacity="0" />
                </SvgGradient>
                <ClipPath id={`chartClip${chartId}`}>
                  <Rect x={0} y={padTop} width={chartWidth} height={graphH} />
                </ClipPath>
              </Defs>

              <G clipPath={`url(#chartClip${chartId})`}>
                {/* Area fill — faded purple under the line */}
                <Path d={svgContent.areaPath} fill={`url(#areaGrad${chartId})`} />

                {/* Line */}
                <Path
                  d={svgContent.linePath}
                  stroke={accentColor}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data point dots */}
                {svgContent.points.map((pt, i) => (
                  <Circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r={
                      activeIndex === i
                        ? 6
                        : activeIndex == null && i === svgContent.points.length - 1
                          ? 4
                          : 0
                    }
                    fill={accentColor}
                  />
                ))}

                {/* Last point glow */}
                {activePoint && (
                  <Circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r={8}
                    fill={accentGlow}
                  />
                )}
              </G>

              {/* Y-axis labels */}
              {svgContent.yLabels.map((yl, i) => (
                <SvgText
                  key={`y-${i}`}
                  x={2}
                  y={yl.y}
                  fill={COLORS.textTertiary}
                  fontSize={9}
                  fontFamily={FONTS.mono.regular}
                >
                  {Math.round(yl.value)}
                </SvgText>
              ))}

              {/* X-axis labels */}
              {svgContent.xLabels.map((xl, i) => (
                <SvgText
                  key={`x-${i}`}
                  x={xl.x}
                  y={height - 2}
                  fill={COLORS.textTertiary}
                  fontSize={9}
                  fontFamily={FONTS.ui.regular}
                  textAnchor="middle"
                >
                  {xl.label}
                </SvgText>
              ))}
            </Svg>
          ) : (
            <View style={[styles.emptyChart, { height }]}>
              <Text style={styles.emptyText}>No data yet</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: CHART_CARD_SHADOW,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
      },
      android: { elevation: 2 },
    }),
  },
  cardGradient: {
    borderRadius: 8,
  },
  cardGlassEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CHART_CARD_BORDER,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
  },
  cardGlassEdgeCompact: {
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerCompact: {
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11.75,
    color: COLORS.textSecondary,
    letterSpacing: 0.45,
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  avgRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  selectedPointText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  headerValueLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textSecondary,
  },
  currentValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -1,
  },
  currentValueCompact: {
    fontSize: 25,
    lineHeight: 30,
  },
  unitText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },
  emptyChart: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
