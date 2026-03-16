/**
 * HomeScreen — Streamlined central hub
 *
 * Sections:
 *   1. Welcome Header (greeting, logo, settings)
 *   2. Active Workout Banner (conditional — only when workout in progress)
 *   3. Start Workout CTA + Template Chips
 *   4. Weekly Snapshot (form score, streak, weekly goal progress)
 *   5. Last Workout Card (most recent session)
 *   6. Achievements Row (condensed points + next badge)
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
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
import { useNavigation, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Target,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Dumbbell,
  Menu,
  Flame,
  Play,
  Clock,
  Calendar,
  Layers,
  Zap,
  Check,
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
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useHomeData } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import type { RootStackParamList } from '../app/RootNavigator';

// ── Constants ────────────────────────────────────

// ── Helpers ────────────────────────────────────────

const formatElapsed = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ── Challenge progress color ──────────────────────
const getChallengeBarColors = (pct: number, done: boolean): [string, string] => {
  if (done) return ['#34D399BB', '#34D399'];       // green — complete
  if (pct >= 0.6) return [COLORS.accent + 'BB', COLORS.accent]; // purple — almost there
  return [COLORS.orange + 'BB', COLORS.orange];     // orange — early progress
};

// ── Main Screen ────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { homeData, isLoading, error, refetch } = useHomeData();
  const { workoutInProgress, workoutElapsedSeconds, workoutPaused, exercises, sets } = useCurrentWorkout();
  const [showAllChallenges, setShowAllChallenges] = useState(false);

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

  const handleStartWorkout = useCallback(() => {
    navigateToTab('Record');
  }, [navigateToTab]);


  // ── Loading ────────────────────────────────────

  if (isLoading || !homeData) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={60} style={{ marginBottom: SPACING.lg }} />
          <LoadingSkeleton variant="card" height={70} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={140} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={90} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={60} />
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
  const scoreColor = getScoreColor(homeData.formScore);
  const weeklyProgress = homeData.weeklyGoal.target > 0
    ? Math.min((homeData.weeklyGoal.current / homeData.weeklyGoal.target) * 100, 100)
    : 0;
  const weeklyComplete = homeData.weeklyGoal.current >= homeData.weeklyGoal.target;

  // Active workout stats
  const totalSetsInProgress = sets.length;
  const totalRepsInProgress = sets.reduce((acc, s) => acc + s.reps, 0);

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
              ACTIVE WORKOUT BANNER (conditional)
              ═══════════════════════════════════════════ */}
          {workoutInProgress && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleStartWorkout}
              style={styles.activeBannerOuter}
            >
              <LinearGradient
                colors={['rgba(139, 92, 246, 0.20)', 'rgba(139, 92, 246, 0.08)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.activeBannerGradient}
              >
                <View style={styles.activeBannerEdge}>
                  <View style={styles.activeBannerTopRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveLabel}>
                      {workoutPaused ? 'PAUSED' : 'LIVE'}
                    </Text>
                    <Text style={styles.activeBannerTitle}>Workout in Progress</Text>
                  </View>
                  <View style={styles.activeBannerStatsRow}>
                    <Text style={styles.activeBannerStat}>
                      {formatElapsed(workoutElapsedSeconds)}
                    </Text>
                    <View style={styles.activeBannerDivider} />
                    <Text style={styles.activeBannerStat}>
                      {totalSetsInProgress} {totalSetsInProgress === 1 ? 'set' : 'sets'}
                    </Text>
                    <View style={styles.activeBannerDivider} />
                    <Text style={styles.activeBannerStat}>
                      {totalRepsInProgress} {totalRepsInProgress === 1 ? 'rep' : 'reps'}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.resumeText}>Resume</Text>
                    <ChevronRight size={14} color={COLORS.accent} strokeWidth={2} />
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* ═══════════════════════════════════════════
              START WORKOUT CTA + TEMPLATE CHIPS
              ═══════════════════════════════════════════ */}
          {!workoutInProgress && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleStartWorkout}
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
          )}

          {/* Template Buttons */}
          {!workoutInProgress && (
            <View style={styles.templateRow}>
              <TouchableOpacity
                style={styles.templateBtn}
                activeOpacity={0.7}
                onPress={() => navigation.dispatch(CommonActions.navigate({ name: 'MainTabs', params: { screen: 'Record', params: { screen: 'WorkoutTemplates' } } }))}
              >
                <Layers size={12} color={COLORS.accent} strokeWidth={2} />
                <Text style={styles.templateBtnText}>Choose Template</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.templateBtn}
                activeOpacity={0.7}
                onPress={() => navigation.dispatch(CommonActions.navigate({ name: 'MainTabs', params: { screen: 'Record', params: { screen: 'CreateTemplate' } } }))}
              >
                <Text style={styles.templateBtnPlus}>+</Text>
                <Text style={styles.templateBtnText}>Create New</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ═══════════════════════════════════════════
              WEEKLY SNAPSHOT
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Calendar size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>THIS WEEK</Text>
            </View>
            <TouchableOpacity
              style={styles.seeAllBtn}
              activeOpacity={0.7}
              onPress={() => navigateToTab('Analytics')}
            >
              <Text style={styles.seeAllText}>Analytics</Text>
              <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Analytics')}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.weeklyCard}
            >
              <View style={styles.weeklyEdge}>
                {/* Stats row: Form Score + Streak */}
                <View style={styles.weeklyStatsRow}>
                  <View style={styles.weeklyStatCell}>
                    <View style={styles.weeklyStatLabelRow}>
                      <Target size={11} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.weeklyStatLabel}>FORM</Text>
                    </View>
                    <View style={styles.weeklyStatValueRow}>
                      <Text style={[styles.weeklyStatValue, { color: scoreColor }]}>
                        {homeData.formScore}
                      </Text>
                      <View style={[styles.trendChip, { backgroundColor: trendColor + '15' }]}>
                        <TrendIcon size={10} color={trendColor} strokeWidth={2} />
                        <Text style={[styles.trendChipText, { color: trendColor }]}>
                          {homeData.formTrendPercent > 0 ? '+' : ''}{homeData.formTrendPercent}%
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.weeklyStatDivider} />

                  <View style={styles.weeklyStatCell}>
                    <View style={styles.weeklyStatLabelRow}>
                      <Flame size={11} color={COLORS.yellow} strokeWidth={1.5} />
                      <Text style={styles.weeklyStatLabel}>STREAK</Text>
                    </View>
                    <Text style={styles.weeklyStatValue}>
                      {homeData.streakDays > 0 ? homeData.streakDays : '—'}
                      <Text style={styles.weeklyStatUnit}>
                        {homeData.streakDays > 0 ? ' days' : ''}
                      </Text>
                    </Text>
                  </View>
                </View>

                {/* Weekly goal progress */}
                <View style={styles.weeklyGoalRow}>
                  <Dumbbell size={11} color={COLORS.textSecondary} strokeWidth={1.5} />
                  <Text style={styles.weeklyGoalLabel}>Workouts</Text>
                  <View style={styles.progressTrack}>
                    {weeklyProgress > 0 && (
                      <LinearGradient
                        colors={weeklyComplete ? ['#34D399BB', '#34D399'] : [COLORS.accent + 'BB', COLORS.accent]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.progressFill, { width: `${weeklyProgress}%` }]}
                      />
                    )}
                  </View>
                  <Text style={[
                    styles.weeklyGoalCount,
                    weeklyComplete && styles.weeklyGoalComplete,
                  ]}>
                    {homeData.weeklyGoal.current}/{homeData.weeklyGoal.target}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              WEEKLY CHALLENGES
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Zap size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>WEEKLY CHALLENGES</Text>
            </View>
            <View style={styles.challengeCountChip}>
              <Text style={styles.challengeCountText}>
                {homeData.challenges.filter(c => c.completed).length}/{homeData.challenges.length}
              </Text>
            </View>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.challengesCard}
          >
            <View style={styles.challengesEdge}>
              {homeData.challenges.slice(0, showAllChallenges ? homeData.challenges.length : 2).map((challenge, idx, arr) => (
                <View
                  key={challenge.id}
                  style={[
                    styles.challengeRow,
                    idx < arr.length - 1 && styles.challengeRowBorder,
                  ]}
                >
                  <View style={[
                    styles.challengeIcon,
                    challenge.completed && styles.challengeIconDone,
                  ]}>
                    {challenge.completed
                      ? <Check size={10} color="#FFFFFF" strokeWidth={3} />
                      : <Zap size={10} color={COLORS.accent} strokeWidth={2} />}
                  </View>
                  <View style={styles.challengeInfo}>
                    <View style={styles.challengeTitleRow}>
                      <Text style={[
                        styles.challengeTitle,
                        challenge.completed && styles.challengeTitleDone,
                      ]} numberOfLines={1}>
                        {challenge.title}
                      </Text>
                      <Text style={[
                        styles.challengeProgress,
                        challenge.completed && styles.challengeProgressDone,
                      ]}>
                        {challenge.completed ? 'Done' : `${challenge.current}/${challenge.target}`}
                      </Text>
                    </View>
                    <View style={styles.challengeProgressTrack}>
                      {(challenge.current / challenge.target) > 0 && (
                        <LinearGradient
                          colors={getChallengeBarColors(challenge.current / challenge.target, challenge.completed)}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={[
                            styles.progressFill,
                            { width: `${Math.min((challenge.current / challenge.target) * 100, 100)}%` },
                          ]}
                        />
                      )}
                    </View>
                  </View>
                </View>
              ))}

              {/* See all / collapse toggle */}
              <TouchableOpacity
                style={styles.challengeSeeAllRow}
                activeOpacity={0.7}
                onPress={() => setShowAllChallenges(prev => !prev)}
              >
                <Text style={styles.challengeSeeAllText}>
                  {showAllChallenges ? 'Show less' : `See all ${homeData.challenges.length} challenges`}
                </Text>
                <ChevronRight
                  size={11}
                  color={COLORS.accent}
                  strokeWidth={2}
                  style={showAllChallenges ? { transform: [{ rotate: '-90deg' }] } : { transform: [{ rotate: '90deg' }] }}
                />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              LAST WORKOUT
              ═══════════════════════════════════════════ */}
          {homeData.lastWorkout ? (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>LAST WORKOUT</Text>
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

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('WorkoutDetails', { workoutId: homeData.lastWorkout!.id })}
              >
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.lastWorkoutCard}
                >
                  <View style={styles.lastWorkoutEdge}>
                    <View style={styles.lastWorkoutTopRow}>
                      <Text style={styles.lastWorkoutName} numberOfLines={1}>
                        {homeData.lastWorkout.name}
                      </Text>
                      <Text style={styles.lastWorkoutTimeAgo}>{homeData.lastWorkout.timeAgo}</Text>
                    </View>
                    <View style={styles.lastWorkoutStatsRow}>
                      <View style={styles.lastWorkoutStatItem}>
                        <Clock size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
                        <Text style={styles.lastWorkoutStatText}>{homeData.lastWorkout.duration}</Text>
                      </View>
                      <View style={styles.lastWorkoutStatItem}>
                        <Layers size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
                        <Text style={styles.lastWorkoutStatText}>{homeData.lastWorkout.totalSets} sets</Text>
                      </View>
                      <View style={styles.lastWorkoutStatItem}>
                        <Target size={11} color={getScoreColor(homeData.lastWorkout.formScore)} strokeWidth={1.5} />
                        <Text style={[styles.lastWorkoutStatText, { color: getScoreColor(homeData.lastWorkout.formScore) }]}>
                          {homeData.lastWorkout.formScore}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }} />
                      <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.emptyLastWorkout}>
              <Text style={styles.emptyLastWorkoutText}>
                Complete your first workout to see it here
              </Text>
            </View>
          )}

          {/* ═══════════════════════════════════════════
              ACHIEVEMENTS — Condensed row
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Rewards')}
          >
            <LinearGradient
              colors={['#1A1510', '#111008', '#0E0C07']}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.achieveCard}
            >
              <View style={styles.achieveEdge}>
                <View style={styles.achieveRow}>
                  <Trophy size={16} color={COLORS.yellow} strokeWidth={1.5} />
                  <Text style={styles.achievePts}>
                    {homeData.totalPoints.toLocaleString()}
                    <Text style={styles.achievePtsSuffix}> pts</Text>
                  </Text>
                  {homeData.nextBadge ? (
                    <>
                      <View style={styles.achieveDot} />
                      <Text style={styles.achieveNext} numberOfLines={1}>
                        Next: {homeData.nextBadge.name}
                      </Text>
                    </>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <ChevronRight size={14} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
                {homeData.nextBadge && (
                  <View style={styles.achieveProgressRow}>
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
    paddingBottom: 160,
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
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    width: 50,
    height: 50,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  greetingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  nameText: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Active Workout Banner ─────────────────── */
  activeBannerOuter: {
    marginTop: 18,
    marginBottom: 12,
  },
  activeBannerGradient: {
    borderRadius: 16,
  },
  activeBannerEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    padding: 14,
  },
  activeBannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  liveLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: '#34D399',
    letterSpacing: 1.5,
  },
  activeBannerTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
  },
  activeBannerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeBannerStat: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  activeBannerDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  resumeText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },

  /* ── Start Workout CTA ─────────────────────── */
  ctaGradient: {
    borderRadius: 16,
    marginTop: 18,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  ctaIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  ctaSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
  },

  /* ── Template Buttons ─────────────────────── */
  templateRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  templateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.20)',
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
  },
  templateBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  templateBtnPlus: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.accent,
    marginTop: -1,
  },

  /* ── Section Headers ───────────────────────── */
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

  /* ── Weekly Snapshot ───────────────────────── */
  weeklyCard: {
    borderRadius: 18,
  },
  weeklyEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  weeklyStatsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  weeklyStatCell: {
    flex: 1,
  },
  weeklyStatLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  weeklyStatLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 1.5,
  },
  weeklyStatValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weeklyStatValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 32,
  },
  weeklyStatUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  weeklyStatDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginHorizontal: 16,
  },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  trendChipText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    letterSpacing: -0.3,
  },
  weeklyGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  weeklyGoalLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  weeklyGoalCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  weeklyGoalComplete: {
    color: '#34D399',
  },

  /* ── Last Workout ──────────────────────────── */
  lastWorkoutCard: {
    borderRadius: 16,
  },
  lastWorkoutEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  lastWorkoutTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  lastWorkoutName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
    flex: 1,
    marginRight: 12,
  },
  lastWorkoutTimeAgo: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  lastWorkoutStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lastWorkoutStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lastWorkoutStatText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  emptyLastWorkout: {
    marginTop: 12,
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyLastWorkoutText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },

  /* ── Achievements Card ─────────────────────── */
  achieveCard: {
    borderRadius: 16,
  },
  achieveEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
    padding: 14,
  },
  achieveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  achievePts: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  achievePtsSuffix: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  achieveDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.textTertiary,
  },
  achieveNext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  achieveProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  achievePct: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    letterSpacing: -0.3,
  },

  /* ── Challenges ──────────────────────────────── */
  challengeCountChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  challengeCountText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.accent,
  },
  challengesCard: {
    borderRadius: 16,
  },
  challengesEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  challengeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  challengeRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  challengeIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeIconDone: {},
  challengeInfo: {
    flex: 1,
    gap: 6,
  },
  challengeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  challengeTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },
  challengeTitleDone: {
    color: COLORS.textTertiary,
    textDecorationLine: 'line-through',
  },
  challengeProgressTrack: {
    height: 3,
    backgroundColor: '#27272A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  challengeProgress: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    minWidth: 28,
    textAlign: 'right',
  },
  challengeProgressDone: {
    color: '#34D399',
    fontFamily: FONTS.display.semibold,
  },
  challengeSeeAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  challengeSeeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },

  /* ── Shared Progress Bar ───────────────────── */
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
