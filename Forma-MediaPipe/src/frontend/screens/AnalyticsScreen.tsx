/**
 * AnalyticsScreen — Cyber-minimalist fitness dashboard
 *
 * Layout:
 *   1. Header: Grotesk title "ANALYTICS" + avatar
 *   2. Date line
 *   3. Time range selector (1W / 1M / 3M / 1Y / ALL)
 *   4. Hero: NeonArc gauge showing Form Score + trend arrow
 *   5. Summary strip: Workouts | Streak | Total Reps
 *   6. Bento Grid: StatCards (Workouts, Exercise)
 *   7. Form Score trend chart
 *   8. Volume + Workout Time cards
 *   9. Volume trend chart
 *  10. Consistency trend chart
 *  11. Personal Best card
 *  12. Weekly duration bars
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, Animated, Dimensions, Platform, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Timer, Trophy, Target, Activity, TrendingUp, ChevronUp, ChevronDown, Minus } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics, useUser } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { NeonArc } from '../components/ui/NeonArc';
import { StatCard } from '../components/ui/StatCard';
import { TimeRangeSelector, TIME_RANGE_OPTIONS } from '../components/ui/TimeRangeSelector';
import { TrendChart } from '../components/ui/TrendChart';
import { SummaryStrip } from '../components/ui/SummaryStrip';
import type { RootStackParamList } from '../app/RootNavigator';

const { width: SCREEN_W } = Dimensions.get('window');

const formatHeaderDate = (): string => {
  const d = new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()} \u2022 TODAY`;
};

const generateMicroBars = (count: number, seed: number): number[] => {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = ((seed * (i + 1) * 7 + 13) % 100);
    bars.push(Math.max(10, val));
  }
  return bars;
};

const TIME_RANGE_LABELS: Record<string, string> = {
  '1 week': 'THIS WEEK',
  '4 weeks': 'LAST 4 WEEKS',
  '3 months': 'LAST 3 MONTHS',
  'Year': 'THIS YEAR',
  'All Time': 'ALL TIME',
};

export const AnalyticsScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user: profileUser } = useUser();

  const [selectedTimeRange, setSelectedTimeRange] = useState('1 week');
  const [selectedBarIndex, setSelectedBarIndex] = useState<number | null>(null);
  const { analytics, isLoading, error, refetch } = useAnalytics('1 week');

  const handleTimeRangeChange = useCallback((range: string) => {
    setSelectedTimeRange(range);
    refetch(range);
  }, [refetch]);

  useEffect(() => {
    if (analytics) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }
  }, [analytics, fadeAnim]);

  if (isLoading || !analytics) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={60} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={34} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={200} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={150} style={{ marginTop: SPACING.md }} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={() => refetch()} />
        </View>
      </View>
    );
  }

  const hasData = analytics.formData.values.length > 0;
  const summary = analytics.summary;

  const formScore = hasData
    ? Math.round(analytics.formData.values.reduce((sum, v) => sum + v, 0) / analytics.formData.values.length)
    : 0;

  const totalVolume = analytics.strengthData.values.reduce((sum, v) => sum + v, 0);
  const formattedVolume = totalVolume >= 1000
    ? `${(totalVolume / 1000).toFixed(1).replace(/\.0$/, '')}k`
    : String(totalVolume);

  const totalMinutes = summary.totalDurationMinutes;
  const workoutHours = Math.floor(totalMinutes / 60);
  const workoutMins = totalMinutes % 60;

  const weeklyValues = analytics.weeklyBarData.map(d => d.value);
  const weeklyMax = Math.max(...weeklyValues, 1);
  const exerciseBars = weeklyValues.map(v => v > 0 ? Math.max(10, Math.round((v / weeklyMax) * 100)) : 0);
  const workoutBars = generateMicroBars(18, summary.workoutCount || 1);

  const periodLabel = TIME_RANGE_LABELS[selectedTimeRange] || 'THIS WEEK';

  // Trend arrow
  const TrendArrow = summary.formTrendDirection === 'up' ? ChevronUp
    : summary.formTrendDirection === 'down' ? ChevronDown
    : Minus;
  const trendColor = summary.formTrendDirection === 'up' ? '#34D399'
    : summary.formTrendDirection === 'down' ? '#E07856'
    : COLORS.textTertiary;

  return (
    <View style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* ── HEADER ─────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ANALYTICS</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('ProfileSettings')}
            activeOpacity={0.7}
            style={styles.avatarButton}
          >
            {profileUser?.avatarUrl ? (
              <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
            ) : profileUser ? (
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarGradient}
              >
                <Text style={styles.avatarInitial}>
                  {profileUser.displayName[0].toUpperCase()}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.avatarPlaceholder} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <Text style={styles.headerDate}>{formatHeaderDate()}</Text>

          {/* ── TIME RANGE SELECTOR ──────────────── */}
          <TimeRangeSelector
            options={TIME_RANGE_OPTIONS}
            selected={selectedTimeRange}
            onSelect={handleTimeRangeChange}
          />

          {/* ── HERO ARC GAUGE ─────────────────────── */}
          <NeonArc
            value={formScore}
            label="Form score"
            displayValue={hasData ? undefined : '--'}
            size={SCREEN_W - SPACING.screenHorizontal * 2}
          />

          {/* ── TREND INDICATOR ────────────────────── */}
          {hasData && (
            <View style={styles.trendRow}>
              <TrendArrow size={14} color={trendColor} strokeWidth={2} />
              <Text style={[styles.trendText, { color: trendColor }]}>
                {summary.formTrendPercent > 0 ? `${summary.formTrendPercent}%` : 'Stable'}
              </Text>
              <Text style={styles.trendLabel}>vs previous period</Text>
            </View>
          )}

          {/* ── SUMMARY STRIP ──────────────────────── */}
          <SummaryStrip
            workoutCount={summary.workoutCount}
            streakDays={summary.streakDays}
            totalReps={summary.totalReps}
          />

          {/* ── BENTO GRID ─────────────────────────── */}
          <View style={styles.bentoRow}>
            <StatCard
              label="Workouts"
              value={hasData ? String(summary.workoutCount) : '--'}
              suffix={periodLabel.toLowerCase()}
              iconName="move"
              barData={workoutBars}
            />
            <StatCard
              label="Exercise"
              value={hasData ? String(totalMinutes) : '--'}
              suffix="/ 60 Min"
              iconName="exercise"
              barData={exerciseBars}
            />
          </View>

          {/* ── FORM SCORE TREND CHART ─────────────── */}
          <TrendChart
            title="FORM SCORE"
            icon={Activity}
            data={analytics.formData}
            unit="pts"
            timeRange={selectedTimeRange}
          />

          {/* ── VOLUME + TIME CARDS ────────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.activityHeader}>
                  <Timer size={14} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.activityTitle}>Total volume</Text>
                </View>
                <View style={styles.activityMetricRow}>
                  <View style={styles.activityBadge}>
                    <Trophy size={20} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <View style={styles.activityValueWrap}>
                    <Text style={styles.activityValue}>{hasData ? formattedVolume : '--'}</Text>
                    <Text style={styles.activitySuffix}>KG</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.activityHeader}>
                  <Target size={14} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.activityTitle}>Workout time</Text>
                </View>
                <View style={styles.challengeMetricRow}>
                  <View style={styles.challengeValueWrap}>
                    <Text style={styles.challengeValueSmall}>
                      {hasData ? (workoutHours > 0 ? `${workoutHours}h ` : '') + `${workoutMins}m` : '--'}
                    </Text>
                    <Text style={styles.activitySuffix}>{periodLabel.toLowerCase()}</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── VOLUME TREND CHART ─────────────────── */}
          <TrendChart
            title="VOLUME"
            icon={TrendingUp}
            data={analytics.strengthData}
            unit="KG"
            formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v))}
            timeRange={selectedTimeRange}
          />

          {/* ── CONSISTENCY TREND CHART ────────────── */}
          <TrendChart
            title="CONSISTENCY"
            icon={Target}
            data={analytics.consistencyData}
            unit="%"
            timeRange={selectedTimeRange}
          />

          {/* ── PERSONAL BEST CARD ─────────────────── */}
          {summary.personalBest && (
            <View style={styles.cardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.cardGradient}
              >
                <View style={styles.cardGlassEdge}>
                  <View style={styles.activityHeader}>
                    <Trophy size={14} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.activityTitle}>Personal best</Text>
                  </View>
                  <View style={styles.activityMetricRow}>
                    <View style={styles.pbExerciseWrap}>
                      <Text style={styles.pbExerciseName}>{summary.personalBest.exercise}</Text>
                      {summary.mostTrainedExercise && (
                        <Text style={styles.activitySuffix}>Most trained: {summary.mostTrainedExercise}</Text>
                      )}
                    </View>
                    <View style={styles.activityValueWrap}>
                      <Text style={styles.activityValue}>{summary.personalBest.weight}</Text>
                      <Text style={styles.activitySuffix}>KG</Text>
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </View>
          )}

          {/* ── WORKOUT DURATION BARS ─────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.weekTitleRow}>
                  <Text style={styles.weekTitle}>{periodLabel}</Text>
                  {selectedBarIndex !== null && analytics.weeklyBarData[selectedBarIndex].value > 0 && (
                    <Text style={styles.weekBarTooltip}>
                      {analytics.weeklyBarData[selectedBarIndex].day} — {analytics.weeklyBarData[selectedBarIndex].value}m
                    </Text>
                  )}
                </View>
                <View style={styles.weekBarsRow}>
                  {analytics.weeklyBarData.map((d, i) => {
                    const maxVal = Math.max(...analytics.weeklyBarData.map(b => b.value), 1);
                    const h = Math.max(3, (d.value / maxVal) * 56);
                    const isSelected = selectedBarIndex === i;
                    return (
                      <TouchableOpacity
                        key={i}
                        style={styles.weekBarCol}
                        activeOpacity={0.7}
                        onPress={() => setSelectedBarIndex(isSelected ? null : i)}
                      >
                        <View style={styles.weekBarTrack}>
                          <View
                            style={[
                              styles.weekBar,
                              {
                                height: h,
                                opacity: d.value > 0 ? 0.5 + (d.value / maxVal) * 0.5 : 0.08,
                                backgroundColor: isSelected ? '#A78BFA' : COLORS.accent,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[
                          styles.weekBarLabel,
                          isSelected && { color: COLORS.text },
                        ]}>{d.day.slice(0, 1)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* paddingBottom on scrollContent handles tab bar clearance */}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xl,
  },
  errorWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    paddingBottom: 130,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 5,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 46,
  },
  headerDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 3,
    marginTop: 0,
    marginBottom: 20,
  },

  /* ── Trend Indicator ───────────────────────── */
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 16,
    marginTop: -8,
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
    letterSpacing: 0.5,
  },

  /* ── Bento Grid ──────────────────────────── */
  bentoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  /* ── Shared Gradient Card ────────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.xl,
  },

  /* ── Activity Card ───────────────────────── */
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  activityTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  activityMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityValueWrap: {
    alignItems: 'flex-end',
  },
  activityValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 38,
    color: COLORS.text,
    lineHeight: 44,
    letterSpacing: -1.5,
  },
  activitySuffix: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },

  /* ── Challenge Card ────────────────────────── */
  challengeMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  challengeValueWrap: {
    alignItems: 'flex-end',
  },
  challengeValueSmall: {
    fontFamily: FONTS.display.semibold,
    fontSize: 34,
    color: COLORS.text,
    lineHeight: 40,
    letterSpacing: -1,
  },

  /* ── Personal Best Card ────────────────────── */
  pbExerciseWrap: {
    flex: 1,
  },
  pbExerciseName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },

  /* ── Week Bars Card ──────────────────────── */
  weekTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 26,
  },
  weekTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  weekBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 72,
  },
  weekBarCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  weekBarTrack: {
    width: 3,
    height: 56,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weekBar: {
    width: '100%',
    borderRadius: 1.5,
    backgroundColor: COLORS.accent,
  },
  weekBarTooltip: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 0.5,
  },
  weekBarLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
});
