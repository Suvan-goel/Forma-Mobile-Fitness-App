/**
 * TrendChart — SVG line/area chart with glass card container.
 * Uses react-native-svg (already installed). No additional dependencies.
 *
 * Renders a smooth Catmull-Rom spline with violet gradient fill.
 */

import React, { useMemo, memo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Text as SvgText, ClipPath, Rect, G, Line } from 'react-native-svg';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, CARD_RADIUS } from '../../constants/theme';

const SCREEN_W = Dimensions.get('window').width;

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
  lineColor,
  averageLabel,
}) => {
  const accent = lineColor ?? COLORS.green;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartId = title.replace(/[^a-zA-Z0-9]/g, '') || 'Trend';

  const chartWidth = SCREEN_W - SPACING.screenHorizontal * 2 - 24;
  const padLeft = 31;
  const padRight = 8;
  const padTop = 22;
  const padBottom = 31;
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
    const yLabels = gridValues.map((value) => ({ value, y: valToY(value) }));
    const gridLines = gridValues.map((value) => ({ y: valToY(value) }));

    // X-axis labels
    const xIndices = pickXLabels(data.dates, 5);
    const xLabels = xIndices.map((idx) => ({
      label: formatDateLabel(data.dates[idx], timeRange),
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
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardGlassEdge}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {Icon ? <Icon size={14} color={accent} strokeWidth={1.5} /> : null}
              <Text style={styles.headerTitle}>{title}</Text>
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
                  <Stop offset="0" stopColor={accent} stopOpacity="0.25" />
                  <Stop offset="1" stopColor={accent} stopOpacity="0" />
                </SvgGradient>
                <ClipPath id={`chartClip${chartId}`}>
                  <Rect x={0} y={padTop} width={chartWidth} height={graphH} />
                </ClipPath>
              </Defs>

              {svgContent.gridLines.map((line, i) => (
                <Line
                  key={`grid-${i}`}
                  x1={padLeft}
                  x2={padLeft + graphW}
                  y1={line.y}
                  y2={line.y}
                  stroke="rgba(255,255,255,0.055)"
                  strokeWidth={1}
                />
              ))}

              <G clipPath={`url(#chartClip${chartId})`}>
                <Path d={svgContent.areaPath} fill={`url(#areaGrad${chartId})`} />

                <Path
                  d={svgContent.linePath}
                  stroke={accent}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {svgContent.points.map((pt, i) => (
                  <G key={i}>
                    <Circle
                      cx={pt.x}
                      cy={pt.y}
                      r={activeIndex === i ? 6.5 : 4.2}
                      fill={accent + (activeIndex === i ? '35' : '1F')}
                    />
                    <Circle
                      cx={pt.x}
                      cy={pt.y}
                      r={activeIndex === i ? 4.1 : 3}
                      fill="#FFFFFF"
                    />
                    <Circle
                      cx={pt.x}
                      cy={pt.y}
                      r={activeIndex === i ? 2.7 : 2}
                      fill={accent}
                    />
                  </G>
                ))}

                {activePoint && (
                  <Circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r={8}
                    fill={accent + '33'}
                  />
                )}
              </G>

              {/* Y-axis labels */}
              {svgContent.yLabels.map((yl, i) => (
                <SvgText
                  key={`y-${i}`}
                  x={2}
                  y={yl.y + 3}
                  fill={COLORS.textTertiary}
                  fontSize={8.5}
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
    borderRadius: CARD_RADIUS,
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: CARD_RADIUS,

    overflow: 'hidden',
},
  cardGlassEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: 'rgba(10, 12, 14, 0.24)',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 7,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.1,
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  averageLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textTertiary,
    letterSpacing: 0.4,
  },
  avgRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  selectedPointText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
  currentValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
    lineHeight: 28,
    letterSpacing: -0.8,
  },
  unitText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
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
