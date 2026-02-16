/**
 * AnalyticsScreen — Cyber-minimalist fitness dashboard
 *
 * Layout:
 *   1. Header: Grotesk title "Current State" + date + avatar
 *   2. Hero: NeonArc gauge showing Activity Score (electric violet)
 *   3. Bento Grid: StatCards (Move, Exercise)
 *   4. Activity Card + Challenge Card
 *   5. Week Bars
 *
 * Data: wired to existing useAnalytics hook — no API changes.
 */

import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Text, Animated, Dimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Timer, Trophy, Target } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAnalytics } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { NeonArc } from '../components/ui/NeonArc';
import { StatCard } from '../components/ui/StatCard';

const { width: SCREEN_W } = Dimensions.get('window');

const formatHeaderDate = (): string => {
  const d = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};

const generateMicroBars = (count: number, seed: number): number[] => {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = ((seed * (i + 1) * 7 + 13) % 100);
    bars.push(Math.max(10, val));
  }
  return bars;
};

export const AnalyticsScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const { analytics, isLoading, error, refetch } = useAnalytics('1 week');

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
          <LoadingSkeleton variant="card" height={200} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <LoadingSkeleton variant="card" height={150} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={150} style={{ flex: 1 }} />
          </View>
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

  const formScore = analytics.formData.values[analytics.formData.values.length - 1] || 0;
  const consistencyScore = analytics.consistencyData.values[analytics.consistencyData.values.length - 1] || 0;
  const strengthScore = analytics.strengthData.values[analytics.strengthData.values.length - 1] || 0;

  const totalMinutes = analytics.weeklyBarData.reduce((sum, d) => sum + d.value, 0);
  const workoutHours = Math.floor(totalMinutes / 60);
  const workoutMins = totalMinutes % 60;

  const moveBars = generateMicroBars(18, formScore);
  const exerciseBars = generateMicroBars(20, strengthScore);

  return (
    <View style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {/* ── HEADER ─────────────────────────────── */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Current State</Text>
              <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>A</Text>
            </View>
          </View>

          {/* ── HERO ARC GAUGE ─────────────────────── */}
          <NeonArc
            value={formScore}
            label="Form score"
            size={SCREEN_W - SPACING.screenHorizontal * 2}
          />

          {/* ── BENTO GRID ─────────────────────────── */}
          <View style={styles.bentoRow}>
            <StatCard
              label="Move"
              value="220"
              suffix="/ 750 Kcal"
              iconName="move"
              barData={moveBars}
            />
            <StatCard
              label="Exercise"
              value="40"
              suffix="/ 60 Min"
              iconName="exercise"
              barData={exerciseBars}
            />
          </View>

          {/* ── ACTIVITY CARD ──────────────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={['#1A1A1A', '#0C0C0C', '#000000']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
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
                    <Text style={styles.activityValue}>10,580</Text>
                    <Text style={styles.activitySuffix}>KG</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── ACTIVE CHALLENGE CARD ──────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={['#1A1A1A', '#0C0C0C', '#000000']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
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
                      {workoutHours > 0 ? `${workoutHours}h ` : ''}{workoutMins}m
                    </Text>
                    <Text style={styles.activitySuffix}>this week</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── WORKOUT DURATION BARS ─────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={['#1A1A1A', '#0C0C0C', '#000000']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <Text style={styles.weekTitle}>THIS WEEK</Text>
                <View style={styles.weekBarsRow}>
                  {analytics.weeklyBarData.map((d, i) => {
                    const maxVal = Math.max(...analytics.weeklyBarData.map(b => b.value), 1);
                    const h = Math.max(3, (d.value / maxVal) * 56);
                    return (
                      <View key={i} style={styles.weekBarCol}>
                        <View style={styles.weekBarTrack}>
                          <View
                            style={[
                              styles.weekBar,
                              {
                                height: h,
                                opacity: d.value > 0 ? 0.5 + (d.value / maxVal) * 0.5 : 0.08,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.weekBarLabel}>{d.day.slice(0, 1)}</Text>
                      </View>
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
    paddingTop: 2,
    paddingBottom: 130,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
    paddingTop: 0,
  },
  headerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 26,
    color: COLORS.text,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  headerDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.display.medium,
    fontSize: 15,
    color: COLORS.accent,
  },

  /* ── Bento Grid ──────────────────────────── */
  bentoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  /* ── Shared Gradient Card ────────────────── */
  cardOuter: {
    borderRadius: 22,
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
    borderRadius: 22,
  },
  cardGlassEdge: {
    borderRadius: 22,
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

  /* ── Week Bars Card ──────────────────────── */
  weekTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    marginBottom: 14,
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
  weekBarLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
});
