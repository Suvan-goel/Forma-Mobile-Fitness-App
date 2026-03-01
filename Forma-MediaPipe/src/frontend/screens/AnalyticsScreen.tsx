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
import { Timer, Trophy, Target, Activity, TrendingUp } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics, useUser, useWorkoutPreferences } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { NeonArc } from '../components/ui/NeonArc';
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

  const { prefs } = useWorkoutPreferences();
  const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;

  const [selectedTimeRange, setSelectedTimeRange] = useState('1 week');
  const [selectedBarIndex, setSelectedBarIndex] = useState<number | null>(null);
  const { analytics, isLoading, error, refetch } = useAnalytics('1 week', weeklyTarget);

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

  const periodLabel = TIME_RANGE_LABELS[selectedTimeRange] || 'THIS WEEK';

  return (
    <View style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* ── HEADER ─────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Analytics</Text>
            <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('UserProfile')}
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
            trendDirection={hasData ? summary.formTrendDirection : undefined}
            trendPercent={hasData ? summary.formTrendPercent : undefined}
          />

          {/* ── SUMMARY STRIP ──────────────────────── */}
          <SummaryStrip
            workoutCount={summary.workoutCount}
            streakDays={summary.streakDays}
            totalReps={summary.totalReps}
          />

          {/* ── SECTION: ACTIVITY ─────────────────── */}
          <Text style={styles.sectionLabel}>ACTIVITY</Text>

          {/* ── VOLUME + TIME SIDE-BY-SIDE ─────────── */}
          <View style={styles.activityRow}>
            <View style={styles.activityCardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activityCardGradient}
              >
                <View style={styles.activityCardGlass}>
                  <View style={styles.activityCardIcon}>
                    <Trophy size={16} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <Text style={styles.activityCardValue}>{hasData ? formattedVolume : '--'}</Text>
                  <Text style={styles.activityCardUnit}>KG volume</Text>
                </View>
              </LinearGradient>
            </View>
            <View style={styles.activityCardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activityCardGradient}
              >
                <View style={styles.activityCardGlass}>
                  <View style={styles.activityCardIcon}>
                    <Timer size={16} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <Text style={styles.activityCardValue}>
                    {hasData ? (workoutHours > 0 ? `${workoutHours}h ${workoutMins}m` : `${workoutMins}m`) : '--'}
                  </Text>
                  <Text style={styles.activityCardUnit}>{periodLabel.toLowerCase()}</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* ── SECTION: TRENDS ──────────────────── */}
          <Text style={styles.sectionLabel}>TRENDS</Text>

          {/* ── FORM SCORE TREND CHART ─────────────── */}
          <TrendChart
            title="FORM SCORE"
            icon={Activity}
            data={analytics.formData}
            unit="pts"
            timeRange={selectedTimeRange}
          />

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
          {(() => {
            const vals = analytics.consistencyData.values;
            const avgConsistency = vals.length > 0
              ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
              : 0;
            return (
              <TrendChart
                title="CONSISTENCY"
                icon={Target}
                data={analytics.consistencyData}
                unit="%"
                timeRange={selectedTimeRange}
                headerValue={avgConsistency}
              />
            );
          })()}

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
    paddingTop: 4,
    paddingBottom: 130,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    paddingTop: 6,
    paddingBottom: 12,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
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
    backgroundColor: '#1A1A1A',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    lineHeight: 34,
  },
  headerDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 2,
    marginTop: 2,
  },

  /* ── Section Label ─────────────────────────── */
  sectionLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 3,
    marginTop: 20,
    marginBottom: 12,
  },

  /* ── Activity Row (Volume + Time side-by-side) ── */
  activityRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  activityCardOuter: {
    flex: 1,
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  activityCardGradient: {
    flex: 1,
    borderRadius: 19,
  },
  activityCardGlass: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
    minHeight: 120,
    justifyContent: 'space-between',
  },
  activityCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  activityCardValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 28,
    color: COLORS.text,
    lineHeight: 34,
    letterSpacing: -1,
  },
  activityCardUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
  },

  /* ── Shared Gradient Card ────────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
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

  /* ── Personal Best Card ────────────────────── */
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
  pbExerciseWrap: {
    flex: 1,
  },
  pbExerciseName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },
  activityValueWrap: {
    alignItems: 'flex-end',
  },
  activityValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 34,
    color: COLORS.text,
    lineHeight: 40,
    letterSpacing: -1.5,
  },
  activitySuffix: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 1,
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
