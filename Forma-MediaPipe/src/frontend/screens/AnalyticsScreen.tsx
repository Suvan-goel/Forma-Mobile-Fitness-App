/**
 * AnalyticsScreen — Cyber-minimalist fitness dashboard
 *
 * Layout:
 *   1. Header: Title "Analytics" + date + avatar (matches HomeScreen style)
 *   2. Time range selector (1W / 1M / 3M / 1Y / ALL)
 *   3. Hero: NeonArc gauge showing Form Score + trend arrow
 *   4. Summary strip: Workouts | Streak | Total Reps
 *   5. Activity section: Volume + Workout Time cards
 *   6. Trends section: Form Score, Volume, Consistency charts
 *   7. Personal Best card
 *   8. Weekly duration bars
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, Animated, Dimensions, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Timer, Trophy, Target, Activity, TrendingUp, BarChart3, Flame, Dumbbell, Zap } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics, useUser, useWorkoutPreferences } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { NeonArc } from '../components/ui/NeonArc';
import { TimeRangeSelector, TIME_RANGE_OPTIONS } from '../components/ui/TimeRangeSelector';
import { TrendChart } from '../components/ui/TrendChart';
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
  const slideAnim = useRef(new Animated.Value(20)).current;
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
      {/* ── HEADER (HomeScreen style) ────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>ANALYTICS</Text>
            <Text style={styles.headerSubtitle}>{formatHeaderDate()}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.profileBtn}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.profileImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <Text style={styles.profileInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.profilePlaceholder} />
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
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
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

          {/* ── SUMMARY STATS ROW (bento grid) ─────── */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.statValue}>{summary.workoutCount}</Text>
                  <Text style={styles.statLabel}>workouts</Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <Flame size={14} color={COLORS.yellow} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.statValue}>
                    {summary.streakDays > 0 ? summary.streakDays : '\u2014'}
                  </Text>
                  <Text style={styles.statLabel}>
                    {summary.streakDays > 0 ? 'day streak' : 'no streak'}
                  </Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <Zap size={14} color="#34D399" strokeWidth={1.5} />
                  </View>
                  <Text style={styles.statValue}>
                    {summary.totalReps >= 1000
                      ? `${(summary.totalReps / 1000).toFixed(1).replace(/\.0$/, '')}k`
                      : summary.totalReps}
                  </Text>
                  <Text style={styles.statLabel}>total reps</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* ═══════════════════════════════════════════
              SECTION: ACTIVITY
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Activity size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ACTIVITY</Text>
            </View>
          </View>

          {/* ── VOLUME + TIME SIDE-BY-SIDE ─────────── */}
          <View style={styles.activityRow}>
            <View style={styles.activityCardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activityCardGradient}
              >
                <View style={styles.activityCardEdge}>
                  <View style={styles.activityIconRow}>
                    <Trophy size={14} color={COLORS.yellow} strokeWidth={1.5} />
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
                <View style={styles.activityCardEdge}>
                  <View style={styles.activityIconRow}>
                    <Timer size={14} color={COLORS.accent} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.activityCardValue}>
                    {hasData ? (workoutHours > 0 ? `${workoutHours}h ${workoutMins}m` : `${workoutMins}m`) : '--'}
                  </Text>
                  <Text style={styles.activityCardUnit}>{periodLabel.toLowerCase()}</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* ═══════════════════════════════════════════
              SECTION: TRENDS
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <TrendingUp size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>TRENDS</Text>
            </View>
          </View>

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

          {/* ═══════════════════════════════════════════
              PERSONAL BEST CARD
              ═══════════════════════════════════════════ */}
          {summary.personalBest && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>PERSONAL BEST</Text>
                </View>
              </View>

              <LinearGradient
                colors={['#1A1510', '#111008', '#0E0C07']}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.cardGradient}
              >
                <View style={styles.pbEdge}>
                  <View style={styles.pbTopRow}>
                    <Trophy size={20} color={COLORS.yellow} strokeWidth={1.5} />
                    <View style={styles.pbInfo}>
                      <Text style={styles.pbExerciseName}>{summary.personalBest.exercise}</Text>
                      {summary.mostTrainedExercise && (
                        <Text style={styles.pbMostTrained}>Most trained: {summary.mostTrainedExercise}</Text>
                      )}
                    </View>
                    <View style={styles.pbValueWrap}>
                      <Text style={styles.pbValue}>{summary.personalBest.weight}</Text>
                      <Text style={styles.pbUnit}>KG</Text>
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </>
          )}

          {/* ═══════════════════════════════════════════
              WORKOUT DURATION BARS
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <BarChart3 size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DURATION</Text>
            </View>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
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

        </Animated.View>
      </ScrollView>
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
    paddingBottom: 160,
  },

  /* ── Header (HomeScreen style) ────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 50,
    height: 50,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
  },
  profileInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },

  /* ── Stats Row (bento grid) ─────────────── */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
  },
  statGradient: {
    borderRadius: 18,
  },
  statEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  statIconRow: {
    marginBottom: 10,
  },
  statValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 28,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  /* ── Section Headers (matches HomeScreen) ─── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
  },

  /* ── Activity Row (Volume + Time) ────────── */
  activityRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  activityCardOuter: {
    flex: 1,
  },
  activityCardGradient: {
    borderRadius: 18,
  },
  activityCardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
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
    borderRadius: 18,
  },
  cardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },

  /* ── Personal Best Card ────────────────────── */
  pbEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
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
  pbExerciseName: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
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
