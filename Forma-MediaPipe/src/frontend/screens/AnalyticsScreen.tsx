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
import { View, StyleSheet, ScrollView, Text, Animated, TouchableOpacity, Image, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Settings as SettingsIcon,
  Info,
  Check,
  Trophy,
  Activity,
  Dumbbell,
  TrendingUp,
  Clock,
  ChevronRight,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics } from '../../backend/hooks/useAnalytics';
import { useExercises } from '../../backend/hooks/useExercises';
import { useWorkoutPreferences } from '../../backend/hooks/useWorkoutPreferences';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { TimeRangeSelector, TIME_RANGE_OPTIONS } from '../components/ui/TimeRangeSelector';
import { TrendChart } from '../components/ui/TrendChart';
import { LeaderboardView } from './social/LeaderboardView';
import type { RootStackParamList } from '../app/RootNavigator';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const PROGRESS_CHART_GREEN = '#5FCE7A';
type ProgressTab = 'overview' | 'personalBests' | 'leaderboard';

const PB_THUMBS = [
  require('../assets/exercises/barbell_squat.png'),
  require('../assets/exercises/barbell_curl.png'),
  require('../assets/exercises/cable_row.png'),
];
const EXERCISE_THUMBS: Record<string, any> = {
  'Barbell Squat': require('../assets/exercises/barbell_squat.png'),
  'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
  'Cable Row': require('../assets/exercises/cable_row.png'),
  'Push-Up': require('../assets/exercises/push_up.png'),
  'Cable Pushdowns': require('../assets/exercises/cable_pushdowns.png'),
  'Machine Ab Crunches': require('../assets/exercises/machine_ab_crunches.png'),
  'Leg Extensions': require('../assets/exercises/leg_extensions.png'),
  'Lying Leg Curl': require('../assets/exercises/lying_leg_curl.png'),
  'Cable Lat Pulldowns': require('../assets/exercises/cable_lat_pulldowns.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises.png'),
};

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
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { prefs } = useWorkoutPreferences();
  const WEEKLY_TARGET_MAP: Record<string, number> = { '1-2': 2, '3-4': 4, '5+': 6 };
  const weeklyTarget = WEEKLY_TARGET_MAP[prefs.weeklyTrainingTarget] ?? 4;

  const [selectedTimeRange, setSelectedTimeRange] = useState('1 week');
  const [activeProgressTab, setActiveProgressTab] = useState<ProgressTab>('overview');
  const { analytics, isLoading, error, refetch } = useAnalytics('1 week', weeklyTarget);
  const { exercises: allExercises } = useExercises();

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
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
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
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
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
  const personalBestEntries: { exercise: string; weight: number; date?: string | null }[] = summary.personalBests?.length
    ? summary.personalBests
    : summary.personalBest
      ? [summary.personalBest]
      : [];
  const personalBestMap = new Map(personalBestEntries.map((best) => [best.exercise, best]));
  const exerciseNames = Array.from(new Set([
    ...allExercises.map((exercise) => exercise.name),
    ...personalBestEntries.map((best) => best.exercise),
  ])).sort((a, b) => {
    const aHasBest = personalBestMap.has(a);
    const bHasBest = personalBestMap.has(b);
    if (aHasBest !== bHasBest) return aHasBest ? -1 : 1;
    return a.localeCompare(b);
  });
  const personalBestRows = exerciseNames.map((name, index) => {
    const exercise = allExercises.find((item) => item.name === name);
    return {
      name,
      category: exercise?.muscleGroup ?? exercise?.category ?? 'Exercise',
      best: personalBestMap.get(name),
      thumb: EXERCISE_THUMBS[name] ?? PB_THUMBS[index % PB_THUMBS.length],
    };
  });
  const tabs: { key: ProgressTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'personalBests', label: 'Personal Bests' },
    { key: 'leaderboard', label: 'Leaderboard' },
  ];

  return (
    <View style={styles.container}>
      {/* ── HEADER ──────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.headerTitle}>PROGRESS</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => navigation.navigate('Settings')}
          >
            <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabsWrap}>
        <View style={styles.topTabs}>
          {tabs.map((tab, index) => {
            const isActive = activeProgressTab === tab.key;
            return (
              <React.Fragment key={tab.key}>
                {index > 0 && <View style={styles.topTabDivider} />}
                <TouchableOpacity
                  style={styles.topTab}
                  activeOpacity={0.75}
                  onPress={() => setActiveProgressTab(tab.key)}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={['rgba(255,255,255,0.06)', 'rgba(255, 255, 255, 0.04)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.topTabActive}
                    >
                      <Text style={[styles.topTabText, styles.topTabTextActive]}>
                        {tab.label}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <Text style={styles.topTabText}>
                      {tab.label}
                    </Text>
                  )}
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </View>
      </View>

      {activeProgressTab === 'leaderboard' ? (
        <Animated.View style={[styles.leaderboardPane, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <LeaderboardView />
        </Animated.View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            {activeProgressTab === 'overview' ? (
              <>

          {/* ── FORM SCORE TREND ────────────────────── */}
          <TrendChart
            title="FORM SCORE TREND"
            icon={Info}
            data={analytics.formData}
            unit=""
            timeRange={selectedTimeRange}
            headerValue={avgFormScore}
            lineColor={PROGRESS_CHART_GREEN}
            averageLabel="Average"
            height={210}
          />

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
                      <Image source={PB_THUMBS[0]} style={styles.pbThumbImage} resizeMode="cover" />
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
                        <Image source={PB_THUMBS[1]} style={styles.pbThumbImage} resizeMode="cover" />
                      </View>
                      <View style={styles.pbInfo}>
                        <Text style={styles.pbName}>Most Trained</Text>
                        <Text style={styles.pbSub}>{summary.mostTrainedExercise}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.pbWeight}>{summary.workoutCount}</Text>
                        <Text style={styles.pbSub}>workouts</Text>
                      </View>
                    </View>
                  )}

                  <View style={[styles.pbRow, styles.pbRowBordered]}>
                    <View style={styles.pbThumb}>
                      <Image source={PB_THUMBS[2]} style={styles.pbThumbImage} resizeMode="cover" />
                    </View>
                    <View style={styles.pbInfo}>
                      <Text style={styles.pbName}>Training Volume</Text>
                      <Text style={styles.pbSub}>{selectedTimeRange}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.pbWeight}>{formatVolume(totalVolume)} kg</Text>
                      <Text style={styles.pbSub}>total</Text>
                    </View>
                  </View>
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
            lineColor={PROGRESS_CHART_GREEN}
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
            lineColor={PROGRESS_CHART_GREEN}
            averageLabel="Average"
          />

              </>
            ) : (
              <View style={styles.personalBestsPane}>
                <View style={styles.cardOuter}>
                  <LinearGradient
                    colors={[...CARD_GRADIENT_COLORS]}
                    start={CARD_GRADIENT_START}
                    end={CARD_GRADIENT_END}
                    style={styles.cardGradient}
                  >
                    <View style={styles.cardEdge}>
                      <View style={styles.cardLabelRow}>
                        <Text style={styles.cardLabel}>PERSONAL BESTS</Text>
                        <Text style={styles.consistencyCount}>
                          {personalBestEntries.length} recorded
                        </Text>
                      </View>

                      {personalBestRows.length === 0 ? (
                        <View style={styles.emptyBestState}>
                          <Trophy size={22} color={COLORS.accent} strokeWidth={1.6} />
                          <Text style={styles.emptyBestTitle}>No personal bests yet</Text>
                          <Text style={styles.emptyBestText}>
                            Save a workout with weighted sets to start tracking exercise records.
                          </Text>
                        </View>
                      ) : (
                        personalBestRows.map((row, index) => (
                          <View
                            key={row.name}
                            style={[styles.bestListRow, index > 0 && styles.pbRowBordered]}
                          >
                            <View style={styles.bestThumb}>
                              <Image source={row.thumb} style={styles.pbThumbImage} resizeMode="contain" />
                            </View>
                            <View style={styles.pbInfo}>
                              <Text style={styles.bestName} numberOfLines={1}>{row.name}</Text>
                              <Text style={styles.pbSub}>
                                {row.best?.date ? `Recorded ${row.best.date}` : row.category}
                              </Text>
                            </View>
                            <View style={styles.bestValueWrap}>
                              <Text style={[styles.bestValue, !row.best && styles.bestValueEmpty]}>
                                {row.best ? `${row.best.weight} kg` : '—'}
                              </Text>
                              <Text style={styles.pbSub}>{row.best ? 'Best set' : 'No PB'}</Text>
                            </View>
                            <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.7} />
                          </View>
                        ))
                      )}
                    </View>
                  </LinearGradient>
                </View>
              </View>
            )}

        </Animated.View>
        </ScrollView>
      )}
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
    paddingBottom: 8,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
  },
  headerActions: { flexDirection: 'row', gap: 5 },
  iconBtn: {
    width: 36,
    height: 36,
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
  tabsWrap: {
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: 10,
  },
  leaderboardPane: {
    flex: 1,
  },
  topTabs: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
    backgroundColor: 'rgba(24, 26, 28, 0.78)',
    padding: 3,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.24,
        shadowRadius: 14,
      },
      android: { elevation: 5 },
    }),
  },
  topTab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTabActive: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  topTabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  topTabTextActive: {
    color: COLORS.accent,
  },
  topTabDivider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginHorizontal: 2,
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
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.1,
  },
  viewAllLink: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },

  /* Generic card */
  cardOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,

    ...CARD_SHADOW,
},
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 13,
  },

  /* Consistency */
  consistencyCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textTertiary,
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  weekdayCell: {
    alignItems: 'center',
    gap: 7,
  },
  weekdayLetter: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
  weekdayCircle: {
    width: 21,
    height: 21,
    borderRadius: 10.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayCircleCompleted: {
    backgroundColor: COLORS.green,
  },
  weekdayCircleEmpty: {
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },

  /* Personal Bests */
  pbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
  },
  pbRowBordered: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  pbThumb: {
    width: 33,
    height: 33,
    borderRadius: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    overflow: 'hidden',
  },
  pbThumbImage: {
    width: '100%',
    height: '100%',
  },
  pbInfo: { flex: 1, gap: 2 },
  pbName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  pbSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textTertiary,
  },
  pbWeight: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  personalBestsPane: {
    paddingTop: 2,
  },
  bestListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  bestThumb: {
    width: 42,
    height: 42,
    borderRadius: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    overflow: 'hidden',
  },
  bestName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  bestValueWrap: {
    alignItems: 'flex-end',
    minWidth: 58,
  },
  bestValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  bestValueEmpty: {
    color: COLORS.textTertiary,
  },
  emptyBestState: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  emptyBestTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
  },
  emptyBestText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
    textAlign: 'center',
    maxWidth: 240,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 2,
  },
  rankBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: FONTS.display.bold,
    fontSize: 10.5,
    color: '#1C1510',
  },
  leaderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  leaderInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
  },
  leaderScore: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.3,
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
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  consistencyHint: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
  },
  consistencyHintText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
});
