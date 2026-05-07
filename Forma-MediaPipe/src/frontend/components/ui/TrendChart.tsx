/**
 * TrendChart — SVG line/area chart with glass card container.
 * Uses react-native-svg (already installed). No additional dependencies.
 *
 * Renders a smooth Catmull-Rom spline with accent gradient fill.
 */

import React, { useMemo, memo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Text as SvgText, ClipPath, Rect, G, Line } from 'react-native-svg';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_START, CARD_GRADIENT_END, CARD_RADIUS, CARD_VERTICAL_GAP, CARD_SHADOW } from '../../constants/theme';

const TREND_CHART_CARD_RADIUS = CARD_RADIUS - 2;
const TREND_CHART_CARD_GRADIENT: readonly [string, string, string] = [
  'rgba(34, 39, 43, 0.80)',
  'rgba(40, 45, 49, 0.80)',
  'rgba(44, 49, 53, 0.80)',
];

interface TrendChartProps {
  title: string;
  icon?: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  data: { values: number[]; dates: Date[] };
  unit?: string;
  height?: number;
  formatValue?: (v: number) => string;
  timeRange: string;
  /** When provided, shown in the card header by default (period average).
   *  Tapping a data point temporarily shows that point's value instead. */
  headerValue?: number;
  /** Override the line/area accent (default = COLORS.accent purple). */
  lineColor?: string;
  /** Header right-side label (defaults to "Average"). */
  averageLabel?: string;
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
      return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
    default:
      return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
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
  height = 190,
  formatValue,
  timeRange,
  headerValue,
  lineColor,
  averageLabel,
}) => {
  const accent = lineColor ?? COLORS.green;
  const { width: screenWidth } = useWindowDimensions();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartId = title.replace(/[^a-zA-Z0-9]/g, '') || 'Trend';

  const chartWidth = screenWidth - SPACING.screenHorizontal * 2 - 34;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 12;
  const padBottom = 38;
  const graphW = chartWidth - padLeft - padRight;
  const graphH = height - padTop - padBottom;

  const svgContent = useMemo(() => {
    if (data.values.length === 0) return null;

    const vals = data.values;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const isPercentChart = unit === '%' || title.toUpperCase().includes('FORM');
    const rawRange = maxVal - minVal || 1;
    const rangePad = isPercentChart ? 0 : rawRange * 0.14;
    const displayMin = isPercentChart ? 0 : Math.max(0, minVal - rangePad);
    const displayMax = isPercentChart ? 100 : maxVal + rangePad;
    const displayRange = displayMax - displayMin || 1;
    const gridValues = isPercentChart
      ? [100, 75, 50, 25, 0]
      : [displayMax, displayMin + displayRange * 0.75, displayMin + displayRange * 0.5, displayMin + displayRange * 0.25, displayMin];

    // Single data point — render a dot with a horizontal baseline
    if (vals.length === 1) {
      const centerX = padLeft + graphW / 2;
      const centerY = padTop + graphH / 2;
      return {
        linePath: `M${padLeft},${centerY} L${padLeft + graphW},${centerY}`,
        areaPath: `M${padLeft},${centerY} L${padLeft + graphW},${centerY} L${padLeft + graphW},${padTop + graphH} L${padLeft},${padTop + graphH} Z`,
        points: [{ x: centerX, y: centerY }],
        yLabels: gridValues.map((value) => ({
          value,
          y: padTop + graphH - ((value - displayMin) / displayRange) * graphH,
        })),
        gridLines: gridValues.map((value) => ({
          y: padTop + graphH - ((value - displayMin) / displayRange) * graphH,
        })),
        xLabels: [{ label: 'Today', x: centerX }],
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
    const yLabels = gridValues.map((value) => ({ value, y: valToY(value) }));
    const gridLines = gridValues.map((value) => ({ y: valToY(value) }));

    // X-axis labels
    const xIndices = pickXLabels(data.dates, 5);
    const xLabels = xIndices.map((idx) => ({
      label: idx === data.dates.length - 1 ? 'Today' : formatDateLabel(data.dates[idx], timeRange),
      x: points[idx].x,
    }));

    return { linePath, areaPath, points, yLabels, gridLines, xLabels, lastPt };
  }, [data.values, data.dates, graphW, graphH, padLeft, padTop, timeRange, title, unit]);

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
        colors={[...TREND_CHART_CARD_GRADIENT]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardGlassEdge}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>{title}</Text>
              {Icon ? <Icon size={18} color={COLORS.textSecondary} strokeWidth={1.7} /> : null}
            </View>
            <View style={styles.headerRight}>
              {averageLabel ? (
                <Text style={styles.averageLabel}>{averageLabel}</Text>
              ) : null}
              <View style={styles.avgRow}>
                <Text style={[styles.currentValue, { color: accent }]}>{displayValue}</Text>
                {unit ? <Text style={styles.unitText}>{unit}</Text> : null}
              </View>
              {selectedDisplayValue != null && (
                <Text style={[styles.selectedPointText, { color: accent }]}>
                  {selectedDisplayValue}{unit ? ` ${unit}` : ''} · {selectedDateLabel}
                </Text>
              )}
            </View>
          </View>

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
                  <Stop offset="0" stopColor={accent} stopOpacity="0.28" />
                  <Stop offset="0.55" stopColor={accent} stopOpacity="0.12" />
                  <Stop offset="1" stopColor={accent} stopOpacity="0.025" />
                </SvgGradient>
                <ClipPath id={`chartClip${chartId}`}>
                  <Rect x={0} y={padTop - 12} width={chartWidth} height={graphH + 24} />
                </ClipPath>
              </Defs>

              {svgContent.gridLines.map((line, i) => (
                <Line
                  key={`grid-${i}`}
                  x1={padLeft + 8}
                  x2={padLeft + graphW}
                  y1={line.y}
                  y2={line.y}
                  stroke="rgba(255, 255, 255, 0.055)"
                  strokeWidth={1.1}
                />
              ))}

              <G clipPath={`url(#chartClip${chartId})`}>
                <Path d={svgContent.areaPath} fill={`url(#areaGrad${chartId})`} />

                <Path
                  d={svgContent.linePath}
                  stroke={accent}
                  strokeWidth={7.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.12}
                />
                <Path
                  d={svgContent.linePath}
                  stroke={accent}
                  strokeWidth={4.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.18}
                />
                <Path
                  d={svgContent.linePath}
                  stroke={accent}
                  strokeWidth={2.4}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {svgContent.points.map((pt, i) => {
                  const isActive = activeIndex === i;
                  return (
                  <G key={i}>
                    <Circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isActive ? 7 : 6.2}
                      fill="#F4FFF9"
                      stroke={accent}
                      strokeWidth={3}
                    />
                  </G>
                  );
                })}
              </G>

              {/* Y-axis labels */}
              {svgContent.yLabels.map((yl, i) => (
                <SvgText
                  key={`y-${i}`}
                  x={2}
                  y={yl.y + 5}
                  fill={COLORS.textSecondary}
                  fontSize={12}
                  fontFamily={FONTS.display.semibold}
                  opacity={0.92}
                >
                  {Math.round(yl.value)}
                </SvgText>
              ))}

              {/* X-axis labels */}
              {svgContent.xLabels.map((xl, i) => (
                <SvgText
                  key={`x-${i}`}
                  x={xl.x}
                  y={height - 5}
                  fill={COLORS.textSecondary}
                  fontSize={12}
                  fontFamily={FONTS.display.semibold}
                  textAnchor="middle"
                  opacity={0.92}
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
    borderRadius: TREND_CHART_CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
    ...CARD_SHADOW,
  },
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: TREND_CHART_CARD_RADIUS,
    overflow: 'hidden',
  },
  cardGlassEdge: {
    borderRadius: TREND_CHART_CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 17,
    paddingTop: 17,
    paddingBottom: 13,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingTop: 2,
  },
  headerTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 0,
    minWidth: 80,
  },
  averageLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: -0.1,
  },
  avgRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  selectedPointText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
  currentValue: {
    fontFamily: FONTS.display.medium,
    fontSize: 34,
    color: COLORS.text,
    lineHeight: 38,
    letterSpacing: -0.8,
  },
  unitText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
    marginBottom: 5,
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
