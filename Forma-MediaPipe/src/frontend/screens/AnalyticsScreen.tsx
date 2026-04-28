/**
 * AnalyticsScreen — Home-style progress dashboard
 *
 * Layout:
 *   1. Header: Title "Progress" + quick actions
 *   2. Overview segment + time range selector
 *   3. Overview cards: Form score trend, summary, activity, and history
 *   4. Summary strip: Workouts | Streak | Total Reps
 *   5. Activity section: Volume + Workout Time cards
 *   6. Trends section: Form Score, Volume, Consistency charts
 *   7. Personal Best card
 *   8. Weekly duration bars
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, Animated, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarDays, Timer, Trophy, Target, Activity, TrendingUp, BarChart3, Flame, Dumbbell, Zap, Settings, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics, useWorkoutPreferences } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { TimeRangeSelector, TIME_RANGE_OPTIONS } from '../components/ui/TimeRangeSelector';
import { TrendChart } from '../components/ui/TrendChart';
import type { RootStackParamList } from '../app/RootNavigator';

const HOME_BACKGROUND_GRADIENT: readonly [string, string, string] = ['#353B40', '#252B30', '#11181D'];
const HOME_CARD_GRADIENT: readonly [string, string, string] = ['#2A3136', '#222A30', '#192126'];
const HOME_CARD_BORDER = 'rgba(255,255,255,0.085)';
const HOME_CARD_SHADOW = 'rgba(0,0,0,0.22)';
const HOME_VIOLET = '#7C5CFF';
const HOME_GREEN = '#34D399';

type ProgressTab = 'Overview' | 'Workouts' | 'Exercises';

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
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const { prefs } = useWorkoutPreferences();
  const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;

  const [selectedTimeRange, setSelectedTimeRange] = useState('1 week');
  const [selectedProgressTab, setSelectedProgressTab] = useState<ProgressTab>('Overview');
  const [selectedBarIndex, setSelectedBarIndex] = useState<number | null>(null);
  const { analytics, isLoading, error, refetch } = useAnalytics('1 week', weeklyTarget);

  const handleTimeRangeChange = useCallback((range: string) => {
    setSelectedTimeRange(range);
    refetch(range);
  }, [refetch]);

  useEffect(() => {
    if (analytics) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [analytics, fadeAnim, slideAnim]);

  if (isLoading || !analytics) {
    return (
      <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
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
      </LinearGradient>
    );
  }

  if (error) {
    return (
      <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={() => refetch()} />
        </View>
      </LinearGradient>
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
  const completedWorkoutDays = analytics.weeklyBarData.filter(day => day.value > 0).length;
  const consistencyGoalLabel = `${completedWorkoutDays} of ${weeklyTarget} workouts`;

  const periodLabel = TIME_RANGE_LABELS[selectedTimeRange] || 'THIS WEEK';

  return (
    <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 18 }]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerName}>Progress</Text>
              <Text style={styles.headerSubtitle}>{formatHeaderDate()}</Text>
            </View>
            <View style={styles.headerActions}>
              <View style={styles.headerIconBtn}>
                <CalendarDays size={18} color={COLORS.textSecondary} strokeWidth={1.7} />
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.headerIconBtn}
                onPress={() => navigation.navigate('Settings')}
              >
                <Settings size={18} color={COLORS.textSecondary} strokeWidth={1.7} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.segmentedControl}>
            {(['Overview', 'Workouts', 'Exercises'] as const).map((tab, index) => (
              <React.Fragment key={tab}>
                {index > 0 && <View style={styles.segmentDivider} />}
                <TouchableOpacity
                  style={[styles.segment, selectedProgressTab === tab && styles.segmentActive]}
                  activeOpacity={0.75}
                  onPress={() => setSelectedProgressTab(tab)}
                >
                  <Text style={[
                    styles.segmentText,
                    selectedProgressTab === tab && styles.segmentTextActive,
                  ]}>
                    {tab}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>

          {selectedProgressTab === 'Overview' && (
            <>
              <TrendChart
                title="FORM SCORE TREND"
                icon={Activity}
                data={analytics.formData}
                unit=""
                timeRange={selectedTimeRange}
                headerValue={formScore}
                accentColor={HOME_GREEN}
                headerLabel="Average"
                height={118}
                compact
              />

              <TimeRangeSelector
                options={TIME_RANGE_OPTIONS}
                selected={selectedTimeRange}
                onSelect={handleTimeRangeChange}
              />

              <LinearGradient
                colors={[...HOME_CARD_GRADIENT]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.cardGradient}
              >
                <View style={styles.cardEdge}>
                  <View style={styles.compactHeaderRow}>
                    <View style={styles.sectionLabelRow}>
                      <Target size={13} color={HOME_GREEN} strokeWidth={1.6} />
                      <Text style={styles.sectionLabel}>CONSISTENCY</Text>
                    </View>
                    <Text style={styles.headerMetric}>{consistencyGoalLabel}</Text>
                  </View>
                  <View style={styles.consistencyRow}>
                    {analytics.weeklyBarData.map((day) => {
                      const completed = day.value > 0;
                      return (
                        <View key={day.day} style={styles.consistencyDay}>
                          <Text style={styles.consistencyLabel}>{day.day.slice(0, 1)}</Text>
                          <View style={[
                            styles.consistencyDot,
                            completed ? styles.consistencyDotDone : styles.consistencyDotOpen,
                          ]}>
                            {completed && <Check size={9} color="#102019" strokeWidth={2.5} />}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </LinearGradient>

              {summary.personalBest && (
                <LinearGradient
                  colors={[...HOME_CARD_GRADIENT]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardEdge}>
                    <View style={styles.compactHeaderRow}>
                      <View style={styles.sectionLabelRow}>
                        <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
                        <Text style={styles.sectionLabel}>RECENT PERSONAL BESTS</Text>
                      </View>
                      <Text style={styles.headerLink}>View all</Text>
                    </View>
                    <View style={styles.pbListRow}>
                      <View style={styles.pbIconBox}>
                        <Trophy size={16} color={COLORS.yellow} strokeWidth={1.5} />
                      </View>
                      <View style={styles.pbInfo}>
                        <Text style={styles.pbExerciseName}>{summary.personalBest.exercise}</Text>
                        <Text style={styles.pbMostTrained}>1RM</Text>
                      </View>
                      <View style={styles.pbValueWrap}>
                        <Text style={styles.pbValueSmall}>{summary.personalBest.weight} kg</Text>
                        <Text style={styles.pbMostTrained}>Best lift</Text>
                      </View>
                    </View>
                    {summary.mostTrainedExercise && (
                      <View style={styles.pbListRow}>
                        <View style={styles.pbIconBox}>
                          <Dumbbell size={16} color={HOME_VIOLET} strokeWidth={1.5} />
                        </View>
                        <View style={styles.pbInfo}>
                          <Text style={styles.pbExerciseName}>{summary.mostTrainedExercise}</Text>
                          <Text style={styles.pbMostTrained}>Most trained</Text>
                        </View>
                        <Text style={styles.pbValueSmall}>{summary.workoutCount} workouts</Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>
              )}

              <View style={styles.statsStrip}>
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>WORKOUTS</Text>
                  <Text style={styles.stripValue}>{summary.workoutCount}</Text>
                </View>
                <View style={styles.stripDivider} />
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>STREAK</Text>
                  <Text style={styles.stripValue}>{summary.streakDays || '--'}</Text>
                </View>
                <View style={styles.stripDivider} />
                <View style={styles.stripStat}>
                  <Text style={styles.stripLabel}>REPS</Text>
                  <Text style={styles.stripValue}>{summary.totalReps}</Text>
                </View>
              </View>
            </>
          )}

          {selectedProgressTab === 'Workouts' && (
            <>
              <TimeRangeSelector
                options={TIME_RANGE_OPTIONS}
                selected={selectedTimeRange}
                onSelect={handleTimeRangeChange}
              />
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.statGradient}>
                    <View style={styles.statEdge}>
                      <Dumbbell size={14} color={HOME_VIOLET} strokeWidth={1.5} />
                      <Text style={styles.statValue}>{summary.workoutCount}</Text>
                      <Text style={styles.statLabel}>workouts</Text>
                    </View>
                  </LinearGradient>
                </View>
                <View style={styles.statCell}>
                  <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.statGradient}>
                    <View style={styles.statEdge}>
                      <Timer size={14} color={HOME_VIOLET} strokeWidth={1.5} />
                      <Text style={styles.statValue}>{workoutHours > 0 ? `${workoutHours}h` : `${workoutMins}m`}</Text>
                      <Text style={styles.statLabel}>training time</Text>
                    </View>
                  </LinearGradient>
                </View>
                <View style={styles.statCell}>
                  <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.statGradient}>
                    <View style={styles.statEdge}>
                      <Zap size={14} color={HOME_GREEN} strokeWidth={1.5} />
                      <Text style={styles.statValue}>{summary.totalReps}</Text>
                      <Text style={styles.statLabel}>total reps</Text>
                    </View>
                  </LinearGradient>
                </View>
              </View>
              <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.cardGradient}>
                <View style={styles.cardEdge}>
                  <View style={styles.compactHeaderRow}>
                    <View style={styles.sectionLabelRow}>
                      <BarChart3 size={13} color={HOME_VIOLET} strokeWidth={1.5} />
                      <Text style={styles.sectionLabel}>DURATION</Text>
                    </View>
                    {selectedBarIndex !== null && analytics.weeklyBarData[selectedBarIndex].value > 0 && (
                      <Text style={styles.weekBarTooltip}>
                        {analytics.weeklyBarData[selectedBarIndex].day} · {analytics.weeklyBarData[selectedBarIndex].value}m
                      </Text>
                    )}
                  </View>
                  <View style={styles.weekBarsRow}>
                    {analytics.weeklyBarData.map((d, i) => {
                      const maxVal = Math.max(...analytics.weeklyBarData.map(b => b.value), 1);
                      const h = Math.max(3, (d.value / maxVal) * 64);
                      const isSelected = selectedBarIndex === i;
                      return (
                        <TouchableOpacity
                          key={d.day}
                          style={styles.weekBarCol}
                          activeOpacity={0.7}
                          onPress={() => setSelectedBarIndex(isSelected ? null : i)}
                        >
                          <View style={styles.weekBarTrack}>
                            <View style={[
                              styles.weekBar,
                              {
                                height: h,
                                opacity: d.value > 0 ? 0.5 + (d.value / maxVal) * 0.5 : 0.08,
                                backgroundColor: isSelected ? '#A78BFA' : HOME_VIOLET,
                              },
                            ]} />
                          </View>
                          <Text style={[styles.weekBarLabel, isSelected && { color: COLORS.text }]}>{d.day.slice(0, 1)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </LinearGradient>
            </>
          )}

          {selectedProgressTab === 'Exercises' && (
            <>
              <TimeRangeSelector options={TIME_RANGE_OPTIONS} selected={selectedTimeRange} onSelect={handleTimeRangeChange} />
              <TrendChart
                title="VOLUME"
                icon={TrendingUp}
                data={analytics.strengthData}
                unit="KG"
                formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v))}
                timeRange={selectedTimeRange}
                accentColor={HOME_VIOLET}
                height={126}
                compact
              />
              <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.cardGradient}>
                <View style={styles.cardEdge}>
                  <View style={styles.compactHeaderRow}>
                    <View style={styles.sectionLabelRow}>
                      <Activity size={13} color={HOME_VIOLET} strokeWidth={1.5} />
                      <Text style={styles.sectionLabel}>ACTIVITY</Text>
                    </View>
                  </View>
                  <View style={styles.activityInnerRow}>
                    <View style={styles.activityInnerCell}>
                      <Trophy size={14} color={COLORS.yellow} strokeWidth={1.5} />
                      <Text style={styles.activityCardValue}>{hasData ? formattedVolume : '--'}</Text>
                      <Text style={styles.activityCardUnit}>KG volume</Text>
                    </View>
                    <View style={styles.activityDivider} />
                    <View style={styles.activityInnerCell}>
                      <Dumbbell size={14} color={HOME_GREEN} strokeWidth={1.5} />
                      <Text style={styles.activityCardValue}>{summary.avgRepsPerWorkout}</Text>
                      <Text style={styles.activityCardUnit}>avg reps/workout</Text>
                    </View>
                  </View>
                </View>
              </LinearGradient>
              {summary.personalBest && (
                <LinearGradient colors={[...HOME_CARD_GRADIENT]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.cardGradient}>
                  <View style={styles.cardEdge}>
                    <View style={styles.pbListRow}>
                      <View style={styles.pbIconBox}>
                        <Trophy size={16} color={COLORS.yellow} strokeWidth={1.5} />
                      </View>
                      <View style={styles.pbInfo}>
                        <Text style={styles.pbExerciseName}>{summary.personalBest.exercise}</Text>
                        <Text style={styles.pbMostTrained}>Personal best</Text>
                      </View>
                      <Text style={styles.pbValueSmall}>{summary.personalBest.weight} kg</Text>
                    </View>
                  </View>
                </LinearGradient>
              )}
            </>
          )}

        </Animated.View>
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    paddingHorizontal: 18,
    paddingBottom: 160,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.35,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 15.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 39,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    backgroundColor: 'rgba(9, 14, 18, 0.32)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  segment: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: 'rgba(255,255,255,0.065)',
  },
  segmentText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11.5,
    color: COLORS.textSecondary,
    letterSpacing: -0.05,
  },
  segmentTextActive: {
    color: HOME_VIOLET,
  },
  segmentDivider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCell: {
    flex: 1,
  },
  statGradient: {
    borderRadius: 8,
    shadowColor: HOME_CARD_SHADOW,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 2,
  },
  statEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  statIconRow: {
    marginBottom: 8,
  },
  statValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 28,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11.75,
    color: COLORS.textSecondary,
    letterSpacing: 0.45,
  },
  headerMetric: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
  },
  headerLink: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: HOME_VIOLET,
  },
  consistencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 3,
    paddingTop: 2,
  },
  consistencyDay: {
    alignItems: 'center',
    gap: 7,
  },
  consistencyLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  consistencyDot: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consistencyDotDone: {
    backgroundColor: HOME_GREEN,
  },
  consistencyDotOpen: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },

  /* ── Activity Card (Volume + Time) ─────────── */
  activityInnerRow: {
    flexDirection: 'row',
  },
  activityInnerCell: {
    flex: 1,
    paddingHorizontal: 4,
  },
  activityDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 4,
  },
  activityIconRow: {
    marginBottom: 12,
  },
  activityCardValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 34,
  },
  activityCardUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  /* ── Shared Gradient Card ────────────────── */
  cardGradient: {
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: HOME_CARD_SHADOW,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 2,
  },
  cardEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    padding: 16,
  },

  pbEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    padding: 16,
  },
  pbTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pbInfo: {
    flex: 1,
    gap: 2,
  },
  pbListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  pbIconBox: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  pbExerciseName: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  pbMostTrained: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  pbValueWrap: {
    alignItems: 'flex-end',
  },
  pbValueSmall: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  pbValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 32,
  },
  pbUnit: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },
  statsStrip: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.026)',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  stripStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 3,
  },
  stripDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  stripLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8.5,
    color: COLORS.textTertiary,
    letterSpacing: 0.45,
    marginBottom: 3,
  },
  stripValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.4,
    lineHeight: 20,
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
    backgroundColor: HOME_VIOLET,
  },
  weekBarTooltip: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: HOME_VIOLET,
    letterSpacing: 0.5,
  },
  weekBarLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
});
