/**
 * AnalyticsScreen — Progress (single page)
 *
 * Sections (matches design reference):
 *   1. Header: "Progress" + calendar/settings
 *   2. Form Score Trend chart (green) + Average
 *   3. Time range selector (1W / 1M / 3M / 1Y / ALL)
 *   4. Consistency card (weekday checks)
 *   5. Recent Personal Bests
 *   6. Summary metrics (workouts / streak / avg form / total reps / training time / volume / most trained)
 *   7. Volume + Duration trends (compact charts)
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, Animated, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Calendar,
  Settings as SettingsIcon,
  Info,
  Check,
  Trophy,
  ChevronRight,
  Activity,
  Dumbbell,
  TrendingUp,
  Clock,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics, useWorkoutPreferences } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { TimeRangeSelector, TIME_RANGE_OPTIONS } from '../components/ui/TimeRangeSelector';
import { TrendChart } from '../components/ui/TrendChart';
import type { RootStackParamList } from '../app/RootNavigator';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const formatDuration = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const formatVolume = (kg: number): string => {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(kg));
};

export const AnalyticsScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { prefs } = useWorkoutPreferences();
  const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;

  const [selectedTimeRange, setSelectedTimeRange] = useState('1 week');
  const { analytics, isLoading, error, refetch } = useAnalytics('1 week', weeklyTarget);

  const handleTimeRangeChange = useCallback((range: string) => {
    setSelectedTimeRange(range);
    refetch(range);
  }, [refetch]);

  useEffect(() => {
    if (analytics) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]).start();
    }
  }, [analytics, fadeAnim, slideAnim]);

  if (isLoading || !analytics) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Progress</Text>
        </View>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={200} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={40} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={140} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Progress</Text>
        </View>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={() => refetch()} />
        </View>
      </View>
    );
  }

  const summary = analytics.summary;
  const hasData = analytics.formData.values.length > 0;

  // Average form score across the selected range
  const avgFormScore = hasData
    ? Math.round(analytics.formData.values.reduce((s, v) => s + v, 0) / analytics.formData.values.length)
    : 0;

  // Average consistency (used in trend chart header)
  const avgConsistency = analytics.consistencyData.values.length > 0
    ? Math.round(analytics.consistencyData.values.reduce((s, v) => s + v, 0) / analytics.consistencyData.values.length)
    : 0;

  // Compute completed weekdays for THIS week from weeklyBarData (Mon..Sun mapping)
  // analytics.weeklyBarData is ordered as the most-recent week (Mon..Sun) when range is 1 week.
  const weeklyBars = analytics.weeklyBarData;
  const weekdayCompleted = DAY_LETTERS.map((_, idx) => {
    const bar = weeklyBars[idx];
    return bar ? bar.value > 0 : false;
  });
  const completedThisWeek = weekdayCompleted.filter(Boolean).length;

  const totalVolume = analytics.strengthData.values.reduce((s, v) => s + v, 0);

  return (
    <View style={styles.container}>
      {/* ── HEADER ──────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Progress</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => navigation.navigate('MainTabs', { screen: 'Logbook' })}
          >
            <Calendar size={18} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => navigation.navigate('Settings')}
          >
            <SettingsIcon size={18} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── FORM SCORE TREND ────────────────────── */}
          <View style={styles.formScoreCardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.formScoreGradient}
            >
              <View style={styles.formScoreEdge}>
                <View style={styles.formScoreHeader}>
                  <View style={styles.cardLabelRow}>
                    <Text style={styles.cardLabel}>FORM SCORE TREND</Text>
                    <Info size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.avgLabel}>Average</Text>
                    <Text style={[styles.avgValue, { color: COLORS.green }]}>{hasData ? avgFormScore : '—'}</Text>
                  </View>
                </View>
                <View style={styles.miniChartWrap}>
                  <TrendChart
                    title=""
                    data={analytics.formData}
                    unit=""
                    timeRange={selectedTimeRange}
                    headerValue={avgFormScore}
                    lineColor={COLORS.green}
                    height={140}
                  />
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── TIME RANGE SELECTOR ─────────────────── */}
          <TimeRangeSelector
            options={TIME_RANGE_OPTIONS}
            selected={selectedTimeRange}
            onSelect={handleTimeRangeChange}
          />

          {/* ── CONSISTENCY ─────────────────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardEdge}>
                <View style={styles.cardLabelRow}>
                  <Text style={styles.cardLabel}>CONSISTENCY</Text>
                  <Text style={styles.consistencyCount}>
                    {completedThisWeek} of {weeklyTarget} workouts
                  </Text>
                </View>
                <View style={styles.weekdaysRow}>
                  {DAY_LETTERS.map((letter, i) => {
                    const completed = weekdayCompleted[i];
                    return (
                      <View key={i} style={styles.weekdayCell}>
                        <Text style={styles.weekdayLetter}>{letter}</Text>
                        <View
                          style={[
                            styles.weekdayCircle,
                            completed
                              ? styles.weekdayCircleCompleted
                              : styles.weekdayCircleEmpty,
                          ]}
                        >
                          {completed ? (
                            <Check size={12} color="#FFFFFF" strokeWidth={3} />
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── PERSONAL BESTS ──────────────────────── */}
          {summary.personalBest && (
            <View style={styles.cardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.cardGradient}
              >
                <View style={styles.cardEdge}>
                  <View style={styles.cardLabelRow}>
                    <Text style={styles.cardLabel}>RECENT PERSONAL BESTS</Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => navigation.navigate('MainTabs', { screen: 'Logbook' })}
                    >
                      <Text style={styles.viewAllLink}>View all</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.pbRow}>
                    <View style={styles.pbThumb}>
                      <Trophy size={18} color={COLORS.yellow} strokeWidth={1.5} />
                    </View>
                    <View style={styles.pbInfo}>
                      <Text style={styles.pbName}>{summary.personalBest.exercise}</Text>
                      <Text style={styles.pbSub}>1RM</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.pbWeight}>{summary.personalBest.weight} kg</Text>
                    </View>
                  </View>

                  {summary.mostTrainedExercise && (
                    <View style={[styles.pbRow, styles.pbRowBordered]}>
                      <View style={styles.pbThumb}>
                        <Dumbbell size={18} color={COLORS.accent} strokeWidth={1.5} />
                      </View>
                      <View style={styles.pbInfo}>
                        <Text style={styles.pbName}>Most Trained</Text>
                        <Text style={styles.pbSub}>{summary.mostTrainedExercise}</Text>
                      </View>
                      <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.6} />
                    </View>
                  )}
                </View>
              </LinearGradient>
            </View>
          )}

          {/* ── SUMMARY METRICS ─────────────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardEdge}>
                <View style={styles.cardLabelRow}>
                  <Text style={styles.cardLabel}>SUMMARY</Text>
                </View>
                <View style={styles.summaryGrid}>
                  <SummaryCell
                    icon={<Activity size={14} color={COLORS.accent} strokeWidth={1.6} />}
                    value={String(summary.workoutCount)}
                    label="Workouts"
                  />
                  <View style={styles.summaryDivider} />
                  <SummaryCell
                    icon={<Trophy size={14} color={COLORS.yellow} strokeWidth={1.6} />}
                    value={summary.streakDays > 0 ? `${summary.streakDays}` : '—'}
                    label="Day streak"
                  />
                  <View style={styles.summaryDivider} />
                  <SummaryCell
                    icon={<TrendingUp size={14} color={COLORS.green} strokeWidth={1.6} />}
                    value={hasData ? String(avgFormScore) : '—'}
                    label="Avg form"
                  />
                </View>
                <View style={styles.summaryGrid}>
                  <SummaryCell
                    icon={<Dumbbell size={14} color={COLORS.accent} strokeWidth={1.6} />}
                    value={summary.totalReps >= 1000
                      ? `${(summary.totalReps / 1000).toFixed(1).replace(/\.0$/, '')}k`
                      : String(summary.totalReps)}
                    label="Total reps"
                  />
                  <View style={styles.summaryDivider} />
                  <SummaryCell
                    icon={<Clock size={14} color={COLORS.textSecondary} strokeWidth={1.6} />}
                    value={formatDuration(summary.totalDurationMinutes)}
                    label="Time"
                  />
                  <View style={styles.summaryDivider} />
                  <SummaryCell
                    icon={<TrendingUp size={14} color={COLORS.accent} strokeWidth={1.6} />}
                    value={`${formatVolume(totalVolume)}`}
                    label="Volume kg"
                  />
                </View>
                {avgConsistency > 0 && (
                  <View style={styles.consistencyHint}>
                    <Text style={styles.consistencyHintText}>
                      Consistency · {avgConsistency}%
                    </Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </View>

          {/* ── VOLUME TREND ─────────────────────────── */}
          <TrendChart
            title="VOLUME"
            icon={TrendingUp}
            data={analytics.strengthData}
            unit="kg"
            formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v))}
            timeRange={selectedTimeRange}
            averageLabel="Average"
          />

          {/* ── CONSISTENCY TREND ────────────────────── */}
          <TrendChart
            title="CONSISTENCY"
            icon={Activity}
            data={analytics.consistencyData}
            unit="%"
            timeRange={selectedTimeRange}
            headerValue={avgConsistency}
            averageLabel="Average"
          />

        </Animated.View>
      </ScrollView>
    </View>
  );
};

// ── Summary Cell ────────────────────────────────────

const SummaryCell: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({
  icon, value, label,
}) => (
  <View style={styles.summaryCell}>
    {icon}
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>
);

// ── Styles ─────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  errorWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 160,
  },

  /* Card label */
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 10,
  },
  cardLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },
  viewAllLink: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },

  /* Form score card */
  formScoreCardOuter: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    marginBottom: 4,
  },
  formScoreGradient: { borderRadius: CARD_RADIUS },
  formScoreEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 16,
  },
  formScoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  avgLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.4,
  },
  avgValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  miniChartWrap: {
    marginTop: -10,
    marginHorizontal: -16,
  },

  /* Generic card */
  cardOuter: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    marginBottom: 12,
  },
  cardGradient: { borderRadius: CARD_RADIUS },
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 16,
  },

  /* Consistency */
  consistencyCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  weekdayCell: {
    alignItems: 'center',
    gap: 8,
  },
  weekdayLetter: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
  weekdayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayCircleCompleted: {
    backgroundColor: COLORS.green,
  },
  weekdayCircleEmpty: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },

  /* Personal Bests */
  pbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  pbRowBordered: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  pbThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  pbInfo: { flex: 1, gap: 2 },
  pbName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  pbSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
  },
  pbWeight: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.2,
  },

  /* Summary grid */
  summaryGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  summaryLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  consistencyHint: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  consistencyHintText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
});
