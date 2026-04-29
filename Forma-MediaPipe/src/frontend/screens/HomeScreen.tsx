/**
 * HomeScreen — Clean, minimalistic central hub
 *
 * Sections:
 *   1. Welcome Header (logo, name, greeting, settings)
 *   2. Start Workout CTA (gradient accent)
 *   3. Action Buttons (Choose Template, Create New)
 *   4. Form Score Card
 *   5. Stats Row (Streak + This Week)
 *   6. Last Session
 *   7. Challenges
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  Animated,
  TouchableOpacity,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Target,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Menu,
  Flame,
  Zap,
  Play,
  Clock,
  Layers,
  Activity,
  Calendar,
  BookOpen,
  Plus,
  Trophy,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useHomeData } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import type { RootStackParamList } from '../app/RootNavigator';

// ── Main Screen ────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { homeData, isLoading, error, refetch } = useHomeData();

  useEffect(() => {
    if (homeData) {
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
  }, [homeData, fadeAnim, slideAnim]);

  const navigateToTab = useCallback((tab: string) => {
    navigation.navigate('MainTabs', { screen: tab });
  }, [navigation]);

  // ── Loading ────────────────────────────────────

  if (isLoading || !homeData) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={60} style={{ marginBottom: SPACING.lg }} />
          <LoadingSkeleton variant="card" height={72} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}>
            <LoadingSkeleton variant="card" height={44} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={44} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={150} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}>
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={120} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  // ── Derived values ──────────────────────────────

  const TrendIcon = homeData.formTrendDirection === 'up' ? TrendingUp
    : homeData.formTrendDirection === 'down' ? TrendingDown : Minus;
  const trendColor = homeData.formTrendDirection === 'up' ? '#34D399'
    : homeData.formTrendDirection === 'down' ? COLORS.orange : COLORS.textSecondary;
  const trendSign = homeData.formTrendPercent > 0 ? '+' : homeData.formTrendPercent === 0 ? '' : '';
  const scoreColor = getScoreColor(homeData.formScore);
  const hasWorkouts = homeData.formScore > 0;

  return (
    <View style={styles.container}>
      {/* ── WELCOME HEADER ──────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.avatarImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.nameText}>{homeData.displayName.toUpperCase()}</Text>
            <Text style={styles.greetingText}>WELCOME BACK</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Menu size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
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

          {/* ═══════════════════════════════════════════
              START WORKOUT — Primary CTA
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Record')}
          >
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <View style={styles.ctaInner}>
                <View style={styles.ctaIconWrap}>
                  <Play size={16} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                </View>
                <View style={styles.ctaTextWrap}>
                  <Text style={styles.ctaTitle}>Start Workout</Text>
                  <Text style={styles.ctaSub}>AI-powered form tracking</Text>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              ACTION BUTTONS — Template + Create New
              ═══════════════════════════════════════════ */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToTab('Record')}
            >
              <BookOpen size={14} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.actionBtnText}>Choose Template</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToTab('Record')}
            >
              <Plus size={14} color={COLORS.accent} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Create New</Text>
            </TouchableOpacity>
          </View>

          {/* ═══════════════════════════════════════════
              FORM SCORE CARD
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Analytics')}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.scoreCard}
            >
              <View style={[styles.scoreTopBorder, { backgroundColor: scoreColor, opacity: 0.5 }]} />
              <View style={styles.scoreEdge}>
                {/* Top label row */}
                <View style={styles.scoreHeaderBanner}>
                  <View style={styles.scoreLabelRow}>
                    <Target size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.scoreLabel}>FORM SCORE</Text>
                  </View>
                  <View style={styles.analyticsLink}>
                    <Text style={styles.analyticsLinkText}>Analytics</Text>
                    <ChevronRight size={12} color={COLORS.accent} strokeWidth={2} />
                  </View>
                </View>

                {/* Score row */}
                <View style={styles.scoreValueRow}>
                  <Text style={[styles.scoreValue, { color: scoreColor }]}>
                    {homeData.formScore}
                  </Text>
                  <View style={[styles.trendPill, { backgroundColor: trendColor + '18' }]}>
                    <TrendIcon size={10} color={trendColor} strokeWidth={2} />
                    <Text style={[styles.trendPillText, { color: trendColor }]}>
                      {trendSign}{homeData.formTrendPercent}%
                    </Text>
                  </View>
                </View>

                <Text style={styles.scoreSubtext}>
                  {hasWorkouts ? '7-day average' : 'Complete a workout to see your score'}
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              STATS ROW: STREAK + THIS WEEK
              ═══════════════════════════════════════════ */}
          <View style={styles.statsRow}>
            {/* Streak */}
            <TouchableOpacity
              style={styles.statCell}
              activeOpacity={0.8}
              onPress={() => navigateToTab('Analytics')}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statHeader}>
                    <Flame size={13} color={COLORS.yellow} strokeWidth={1.5} />
                    <Text style={styles.statHeaderLabel}>STREAK</Text>
                  </View>
                  <Text style={styles.statBigValue}>{homeData.streakDays}</Text>
                  <Text style={styles.statUnit}>days</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* This Week */}
            <TouchableOpacity
              style={styles.statCell}
              activeOpacity={0.8}
              onPress={() => navigateToTab('Logbook')}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statHeader}>
                    <Calendar size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.statHeaderLabel}>THIS WEEK</Text>
                  </View>
                  <View style={styles.weekValueRow}>
                    <Text style={styles.statBigValue}>{homeData.weeklyGoal.current}</Text>
                    <Text style={styles.weekTarget}>/{homeData.weeklyGoal.target}</Text>
                  </View>
                  <Text style={styles.statUnit}>workouts</Text>
                  {/* Progress dots */}
                  <View style={styles.dotsRow}>
                    {Array.from({ length: homeData.weeklyGoal.target }).map((_, i) => (
                      <View
                        key={i}
                        style={[
                          styles.dot,
                          i < homeData.weeklyGoal.current
                            ? styles.dotFilled
                            : styles.dotEmpty,
                        ]}
                      />
                    ))}
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* ═══════════════════════════════════════════
              LAST SESSION
              ═══════════════════════════════════════════ */}
          {homeData.lastWorkout ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('WorkoutDetails', { workoutId: homeData.lastWorkout!.id })}
              style={styles.sectionOuter}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.sessionCard}
              >
                <View style={styles.sessionEdge}>
                  {/* Section header inside card */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.sectionLabelRow}>
                      <Zap size={13} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.sectionLabel}>LAST SESSION</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.seeAllBtn}
                      activeOpacity={0.7}
                      onPress={() => navigateToTab('Logbook')}
                    >
                      <Text style={styles.seeAllText}>Logbook</Text>
                      <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>

                  {/* Session info */}
                  <View style={styles.sessionTopRow}>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionName}>{homeData.lastWorkout.name}</Text>
                      <Text style={styles.sessionTime}>{homeData.lastWorkout.timeAgo}</Text>
                    </View>
                    <View style={[styles.sessionScoreBadge, { backgroundColor: getScoreColor(homeData.lastWorkout.formScore) + '20' }]}>
                      <Text style={[styles.sessionScoreText, { color: getScoreColor(homeData.lastWorkout.formScore) }]}>
                        {homeData.lastWorkout.formScore}
                      </Text>
                    </View>
                  </View>

                  {/* Session stats */}
                  <View style={styles.sessionDivider} />
                  <View style={styles.sessionStatsRow}>
                    <View style={styles.sessionStat}>
                      <Clock size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                      <View style={styles.sessionStatTextWrap}>
                        <Text style={styles.sessionStatValue}>{homeData.lastWorkout.duration}</Text>
                        <Text style={styles.sessionStatLabel}>duration</Text>
                      </View>
                    </View>
                    <View style={styles.sessionStatDivider} />
                    <View style={styles.sessionStat}>
                      <Layers size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                      <View style={styles.sessionStatTextWrap}>
                        <Text style={styles.sessionStatValue}>{homeData.lastWorkout.totalSets}</Text>
                        <Text style={styles.sessionStatLabel}>sets</Text>
                      </View>
                    </View>
                    <View style={styles.sessionStatDivider} />
                    <View style={styles.sessionStat}>
                      <Activity size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                      <View style={styles.sessionStatTextWrap}>
                        <Text style={styles.sessionStatValue}>{homeData.lastWorkout.totalReps}</Text>
                        <Text style={styles.sessionStatLabel}>reps</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.sessionCard, styles.sectionOuter]}
            >
              <View style={styles.sessionEdge}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.sectionLabelRow}>
                    <Zap size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>LAST SESSION</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.seeAllBtn}
                    activeOpacity={0.7}
                    onPress={() => navigateToTab('Logbook')}
                  >
                    <Text style={styles.seeAllText}>Logbook</Text>
                    <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.emptyText}>No workouts yet. Start your first one!</Text>
              </View>
            </LinearGradient>
          )}

          {/* ═══════════════════════════════════════════
              ACHIEVEMENTS — Next badge progress
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Rewards')}
            style={styles.sectionOuter}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.achieveCard}
            >
              <View style={styles.achieveEdge}>
                {/* Section header inside card */}
                <View style={styles.cardHeaderRow}>
                  <View style={styles.sectionLabelRow}>
                    <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
                  </View>
                  <View style={styles.seeAllBtn}>
                    <Text style={styles.seeAllText}>Rewards</Text>
                    <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
                  </View>
                </View>

                <View style={styles.achieveTopRow}>
                  <Trophy size={20} color={COLORS.yellow} strokeWidth={1.5} />
                  <View style={styles.achieveInfo}>
                    <Text style={styles.achievePts}>
                      {homeData.totalPoints.toLocaleString()}
                      <Text style={styles.achievePtsSuffix}> pts</Text>
                    </Text>
                    {homeData.nextBadge ? (
                      <Text style={styles.achieveNext} numberOfLines={1}>
                        Next: {homeData.nextBadge.name}
                      </Text>
                    ) : (
                      <Text style={styles.achieveNext}>All badges unlocked</Text>
                    )}
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>

                {homeData.nextBadge && (
                  <View style={styles.achieveProgressWrap}>
                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={[homeData.nextBadge.color + 'BB', homeData.nextBadge.color]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.progressFill, { width: `${Math.min((homeData.nextBadge.current / homeData.nextBadge.required) * 100, 100)}%` }]}
                      />
                    </View>
                    <Text style={[styles.achievePct, { color: homeData.nextBadge.color }]}>
                      {Math.round((homeData.nextBadge.current / homeData.nextBadge.required) * 100)}%
                    </Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              CHALLENGES
              ═══════════════════════════════════════════ */}
          {homeData.challenges.length > 0 && (
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.challengeCard, styles.sectionOuter]}
            >
              <View style={styles.challengeCardEdge}>
                {/* Section header inside card */}
                <View style={styles.cardHeaderRow}>
                  <View style={styles.sectionLabelRow}>
                    <Zap size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>CHALLENGES</Text>
                  </View>
                  <Text style={styles.challengeCounter}>
                    {homeData.challenges.filter(c => c.completed).length}/{homeData.challenges.length}
                  </Text>
                </View>

                {homeData.challenges.map((challenge, idx) => {
                  const progress = challenge.target > 0
                    ? Math.min((challenge.current / challenge.target) * 100, 100)
                    : 0;
                  const isComplete = challenge.completed;

                  return (
                    <TouchableOpacity
                      key={challenge.id}
                      activeOpacity={0.8}
                      onPress={() => navigateToTab('Analytics')}
                      style={[
                        styles.challengeItem,
                        idx < homeData.challenges.length - 1 && styles.challengeItemBorder,
                      ]}
                    >
                      <View style={styles.challengeTopRow}>
                        <View style={styles.challengeTextWrap}>
                          <Text style={styles.challengeTitle}>{challenge.title}</Text>
                        </View>
                        {isComplete ? (
                          <View style={styles.donePill}>
                            <Text style={styles.doneText}>DONE</Text>
                          </View>
                        ) : (
                          <Text style={styles.challengeCount}>
                            {challenge.current}/{challenge.target}
                          </Text>
                        )}
                      </View>
                      <View style={styles.progressTrack}>
                        {progress > 0 && (
                          <LinearGradient
                            colors={isComplete ? ['#34D399BB', '#34D399'] : [COLORS.accent + 'BB', COLORS.accent]}
                            start={{ x: 0, y: 0.5 }}
                            end={{ x: 1, y: 0.5 }}
                            style={[styles.progressFill, { width: `${progress}%` }]}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </LinearGradient>
          )}

        </Animated.View>
      </ScrollView>
    </View>
  );
};

// ── Styles ─────────────────────────────────────────

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
    paddingBottom: 140,
  },

  /* ── Header ──────────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 48,
    height: 48,
  },
  headerTextWrap: {
    gap: 1,
  },
  nameText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  greetingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Start Workout CTA ─────────────────────────── */
  ctaGradient: {
    borderRadius: 18,
    marginTop: 18,
    marginBottom: 10,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  ctaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTextWrap: {
    flex: 1,
    gap: 2,
  },
  ctaTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  ctaSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  /* ── Action Buttons ────────────────────────────── */
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  actionBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  /* ── Form Score Card ───────────────────────────── */
  scoreCard: {
    borderRadius: 20,
    marginBottom: 10,
    overflow: 'hidden',
  },
  scoreTopBorder: {
    height: 3,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  scoreEdge: {
    borderRadius: 20,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 20,
  },
  scoreHeaderBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  scoreLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scoreLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  analyticsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  analyticsLinkText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },
  scoreValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scoreValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 52,
    letterSpacing: -2,
    lineHeight: 56,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  trendPillText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    letterSpacing: -0.3,
  },
  scoreSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 6,
  },

  /* ── Stats Row ───────────────────────────────── */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 0,
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
    padding: 16,
    minHeight: 140,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  statHeaderLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 1.5,
  },
  statBigValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 32,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 36,
  },
  statUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  weekValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  weekTarget: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.textTertiary,
    letterSpacing: -0.5,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotFilled: {
    backgroundColor: COLORS.accent,
  },
  dotEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },

  /* ── Section / Card Shared ───────────────────── */
  sectionOuter: {
    marginTop: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
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
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },

  /* ── Last Session Card ─────────────────────────── */
  sessionCard: {
    borderRadius: 18,
  },
  sessionEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  sessionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  sessionTime: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  sessionScoreBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionScoreText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    letterSpacing: -0.5,
  },
  sessionDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 14,
  },
  sessionStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sessionStatTextWrap: {
    gap: 1,
  },
  sessionStatValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  sessionStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  sessionStatDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginHorizontal: 4,
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: 8,
  },

  /* ── Achievements Card ───────────────────────── */
  achieveCard: {
    borderRadius: 18,
  },
  achieveEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
    padding: 16,
  },
  achieveTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  achieveInfo: {
    flex: 1,
    gap: 2,
  },
  achievePts: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  achievePtsSuffix: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  achieveNext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  achieveProgressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  achievePct: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    letterSpacing: -0.3,
  },

  /* ── Challenges ──────────────────────────────── */
  challengeCard: {
    borderRadius: 18,
  },
  challengeCardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  challengeCounter: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: -0.3,
  },
  challengeItem: {
    paddingVertical: 12,
  },
  challengeItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  challengeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  challengeTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  challengeTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  challengeDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  challengeCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  donePill: {
    backgroundColor: '#34D3991A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  doneText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    color: '#34D399',
    letterSpacing: 1,
  },

  /* ── Progress Bar ──────────────────────────────── */
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#27272A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
