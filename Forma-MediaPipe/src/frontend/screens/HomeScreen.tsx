/**
 * HomeScreen — Today
 *
 * Sections (matches design reference):
 *   1. FORMA wordmark + Settings
 *   2. Greeting row with profile avatar
 *   3. Form Readiness card with circular score ring + Start Workout
 *   4. Quick actions: Choose Template / Create New
 *   5. Weekly Target card with progress bar
 *   6. Last Session card
 *   7. Stats strip
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
import Svg, { Circle } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Settings as SettingsIcon,
  Flame,
  Play,
  Activity,
  Calendar,
  BookOpen,
  Plus,
  Info,
  Trophy,
  Zap,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_SHADOW,
  getScoreColor,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useHomeData } from '../../backend/hooks/useHomeData';
import { useUser } from '../../backend/hooks/useUser';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import type { RootStackParamList } from '../app/RootNavigator';

const RING_SIZE = 78;
const RING_STROKE = 7;

const ScoreRing: React.FC<{
  score: number;
  size?: number;
  stroke?: number;
  small?: boolean;
}> = ({ score, size = RING_SIZE, stroke = RING_STROKE, small }) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const color = getScoreColor(score);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.055)"
          strokeWidth={stroke}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFillObject as any} pointerEvents="none">
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text
            style={[
              ringValue,
              { color: COLORS.text, fontSize: small ? 18 : 22 },
            ]}
          >
            {score}
          </Text>
          <Text style={ringSub}>/100</Text>
        </View>
      </View>
    </View>
  );
};

const SessionScoreBadge: React.FC<{ score: number }> = ({ score }) => (
  <View
    style={[styles.sessionScoreBadge, { borderColor: getScoreColor(score) }]}
  >
    <Text style={[styles.sessionScoreValue, { color: getScoreColor(score) }]}>
      {score}
    </Text>
  </View>
);

export const HomeScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { homeData, isLoading, error, refetch } = useHomeData();
  const { user: profileUser } = useUser();

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

  const navigateToTab = useCallback(
    (tab: string) => {
      if (tab === 'Record') {
        navigation.navigate('MainTabs', {
          screen: 'Record',
          params: { screen: 'RecordLanding' },
        });
        return;
      }
      navigation.navigate('MainTabs', { screen: tab });
    },
    [navigation],
  );

  const navigateToRecordScreen = useCallback(
    (screen: 'RecordLanding' | 'WorkoutTemplates' | 'CreateTemplate') => {
      navigation.navigate('MainTabs', {
        screen: 'Record',
        params: { screen },
      });
    },
    [navigation],
  );

  if (isLoading || !homeData) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton
            variant="card"
            height={60}
            style={{ marginBottom: SPACING.lg }}
          />
          <LoadingSkeleton
            variant="card"
            height={180}
            style={{ marginBottom: SPACING.md }}
          />
          <View
            style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}
          >
            <LoadingSkeleton variant="card" height={48} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={48} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton
            variant="card"
            height={110}
            style={{ marginBottom: SPACING.md }}
          />
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

  const score = homeData.formScore;
  const scoreColor = getScoreColor(score);
  const hasWorkouts = score > 0;

  // Status text & guidance for the readiness card
  const statusText = !hasWorkouts
    ? 'Ready to start'
    : score >= 90
      ? 'Peak form'
      : score >= 75
        ? 'Good to go'
        : score >= 50
          ? 'Keep working'
          : 'Focus up';
  const guidanceText = !hasWorkouts
    ? 'Complete your first workout to see your form readiness.'
    : score >= 90
      ? 'Your form is dialed in. Push for a new personal best today.'
      : score >= 75
        ? 'Your form looks solid. Focus on controlled reps and full range.'
        : score >= 50
          ? 'Slow down on the eccentric and keep your form tight.'
          : 'Focus on technique today — quality reps over heavy weight.';

  const weeklyPct =
    homeData.weeklyGoal.target > 0
      ? Math.min(
          100,
          Math.round(
            (homeData.weeklyGoal.current / homeData.weeklyGoal.target) * 100,
          ),
        )
      : 0;
  const weeklyRemaining = Math.max(
    0,
    homeData.weeklyGoal.target - homeData.weeklyGoal.current,
  );
  const nextBadgePct = homeData.nextBadge
    ? Math.min(
        100,
        Math.round(
          (homeData.nextBadge.current / homeData.nextBadge.required) * 100,
        ),
      )
    : 100;
  const nextBadgeRemaining = homeData.nextBadge
    ? Math.max(0, homeData.nextBadge.required - homeData.nextBadge.current)
    : 0;

  // Compute week day index 0=Sun..6=Sat. Use Mon..Sun layout for "days left this week".
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0..6
  const daysLeftInWeek = 7 - (dayOfWeek === 0 ? 7 : dayOfWeek); // crude: days after today through Sun

  return (
    <View style={styles.container}>
      {/* ── HEADER: FORMA wordmark + settings ─────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.brand}>FORMA</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <SettingsIcon
            size={20}
            color={COLORS.textSecondary}
            strokeWidth={1.6}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          {/* ── GREETING ROW with avatar ──────────────── */}
          <TouchableOpacity
            style={styles.greetingRow}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('UserProfile')}
          >
            <View style={styles.avatarWrap}>
              {profileUser?.avatarUrl ? (
                <Image
                  source={{ uri: profileUser.avatarUrl }}
                  style={styles.avatarImage}
                />
              ) : (
                <LinearGradient
                  colors={['#7A55FF', '#633FE5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatarFallback}
                >
                  <Text style={styles.avatarInitial}>
                    {homeData.displayName.charAt(0).toUpperCase()}
                  </Text>
                </LinearGradient>
              )}
            </View>
            <View style={styles.greetingTextWrap}>
              <Text style={styles.greetingHello}>Good day,</Text>
              <Text style={styles.greetingName} numberOfLines={1}>
                {homeData.displayName}
              </Text>
              <Text style={styles.greetingSubtitle}>
                Let's train smarter today.
              </Text>
            </View>
          </TouchableOpacity>

          {/* ── FORM READINESS CARD ──────────────────── */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigateToTab('Analytics')}
            style={styles.readinessOuter}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.readinessGradient}
            >
              <View style={styles.readinessEdge}>
                <View style={styles.cardLabelRow}>
                  <Text style={styles.cardLabel}>FORM READINESS</Text>
                  <Info
                    size={12}
                    color={COLORS.textTertiary}
                    strokeWidth={1.5}
                  />
                </View>

                <View style={styles.readinessBody}>
                  <ScoreRing score={hasWorkouts ? score : 0} />
                  <View style={styles.readinessTextWrap}>
                    <Text
                      style={[styles.readinessStatus, { color: scoreColor }]}
                    >
                      {statusText}
                    </Text>
                    <Text style={styles.readinessGuidance}>{guidanceText}</Text>
                  </View>
                  <ChevronRight
                    size={16}
                    color={COLORS.textTertiary}
                    strokeWidth={1.6}
                  />
                </View>

                {/* Start Workout button inside card */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigateToTab('Record')}
                  style={styles.startBtnOuter}
                >
                  <LinearGradient
                    colors={['#7A55FF', '#633FE5']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.startBtn}
                  >
                    <Play
                      size={14}
                      color="#FFFFFF"
                      strokeWidth={2.5}
                      fill="#FFFFFF"
                    />
                    <Text style={styles.startBtnText}>Start Workout</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── QUICK ACTIONS ────────────────────────── */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToRecordScreen('WorkoutTemplates')}
            >
              <BookOpen
                size={15}
                color={COLORS.textSecondary}
                strokeWidth={1.6}
              />
              <Text style={styles.actionBtnText}>Choose Template</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToRecordScreen('CreateTemplate')}
            >
              <Plus size={15} color={COLORS.textSecondary} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Create New</Text>
            </TouchableOpacity>
          </View>

          {/* ── WEEKLY TARGET ────────────────────────── */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigateToTab('Analytics')}
            style={styles.weeklyOuter}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.weeklyGradient}
            >
              <View style={styles.weeklyEdge}>
                <View style={styles.weeklyHeader}>
                  <View>
                    <Text style={styles.cardLabel}>WEEKLY TARGET</Text>
                    <Text style={styles.weeklyValue}>
                      {homeData.weeklyGoal.current} of{' '}
                      {homeData.weeklyGoal.target} workouts
                    </Text>
                  </View>
                  <Text style={styles.weeklyPct}>{weeklyPct}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={['#7A55FF', '#633FE5']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: `${weeklyPct}%` }]}
                  />
                </View>
                <Text style={styles.weeklyRemaining}>
                  {weeklyRemaining === 0
                    ? 'Target hit — nice work'
                    : `${daysLeftInWeek} day${daysLeftInWeek === 1 ? '' : 's'} left this week`}
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── NEXT BADGE ─────────────────────────── */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Rewards')}
            style={styles.rewardsOuter}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.rewardsGradient}
            >
              <View style={styles.rewardsEdge}>
                <View style={styles.rewardsHeader}>
                  <View style={styles.rewardTitleBlock}>
                    <Text style={styles.cardLabel}>NEXT BADGE</Text>
                    <Text style={styles.rewardTitle} numberOfLines={1}>
                      {homeData.nextBadge?.name ?? 'All badges unlocked'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.rewardIcon,
                      {
                        borderColor: `${homeData.nextBadge?.color ?? COLORS.primary}33`,
                      },
                    ]}
                  >
                    <Trophy
                      size={18}
                      color={homeData.nextBadge?.color ?? COLORS.primary}
                      strokeWidth={1.7}
                    />
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={[
                      homeData.nextBadge?.color ?? COLORS.primary,
                      COLORS.primaryDark,
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.progressFill,
                      { width: `${Math.max(6, nextBadgePct)}%` },
                    ]}
                  />
                </View>

                <View style={styles.rewardMetaRow}>
                  <Text style={styles.rewardMeta}>
                    {homeData.nextBadge
                      ? `${nextBadgeRemaining.toLocaleString()} pts remaining`
                      : 'Current rewards track complete'}
                  </Text>
                  <Text style={styles.rewardMetaStrong}>
                    {homeData.nextBadge
                      ? `${homeData.nextBadge.current.toLocaleString()} / ${homeData.nextBadge.required.toLocaleString()}`
                      : `${homeData.totalPoints.toLocaleString()} pts`}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── LAST SESSION ─────────────────────────── */}
          {homeData.lastWorkout ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() =>
                navigation.navigate('WorkoutDetails', {
                  workoutId: homeData.lastWorkout!.id,
                })
              }
              style={styles.sessionOuter}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.sessionGradient}
              >
                <View style={styles.sessionEdge}>
                  <View style={styles.cardLabelRow}>
                    <Text style={styles.cardLabel}>LAST SESSION</Text>
                  </View>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionThumb}>
                      <LinearGradient
                        colors={[
                          'rgba(122, 85, 255, 0.22)',
                          'rgba(122, 85, 255, 0.08)',
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Activity size={21} color="#FFFFFF" strokeWidth={1.5} />
                    </View>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionName} numberOfLines={1}>
                        {homeData.lastWorkout.name}
                      </Text>
                      <Text style={styles.sessionMeta}>
                        {homeData.lastWorkout.timeAgo} ·{' '}
                        {homeData.lastWorkout.duration}
                      </Text>
                      <Text style={styles.sessionStatsLine}>
                        {homeData.lastWorkout.totalSets} sets ·{' '}
                        {homeData.lastWorkout.totalReps} reps
                      </Text>
                    </View>
                    <SessionScoreBadge score={homeData.lastWorkout.formScore} />
                    <ChevronRight
                      size={14}
                      color={COLORS.textTertiary}
                      strokeWidth={1.5}
                      style={{ marginLeft: 2 }}
                    />
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.sessionGradient, styles.sessionOuter]}
            >
              <View style={styles.sessionEdge}>
                <View style={styles.cardLabelRow}>
                  <Text style={styles.cardLabel}>LAST SESSION</Text>
                </View>
                <Text style={styles.emptyText}>
                  No workouts yet — tap Start to begin.
                </Text>
              </View>
            </LinearGradient>
          )}

          {/* ── STATS STRIP ──────────────────────────── */}
          <View style={styles.statsStripOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.statsStrip}
            >
              <View style={styles.statCell}>
                <Flame size={14} color={COLORS.yellow} strokeWidth={1.6} />
                <View style={styles.statValueRow}>
                  <Text style={styles.statValue}>{homeData.streakDays}</Text>
                  <Text style={styles.statUnit}>days</Text>
                </View>
                <Text style={styles.statLabel}>STREAK</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Calendar size={14} color={COLORS.accent} strokeWidth={1.6} />
                <View style={styles.statValueRow}>
                  <Text style={styles.statValue}>
                    {homeData.weeklyGoal.current}
                  </Text>
                  <Text style={styles.statUnit}>workouts</Text>
                </View>
                <Text style={styles.statLabel}>THIS WEEK</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Trophy size={14} color={COLORS.green} strokeWidth={1.6} />
                <View style={styles.statValueRow}>
                  <Text style={styles.statValue}>
                    {homeData.totalPoints.toLocaleString()}
                  </Text>
                  <Text style={styles.statUnit}>pts</Text>
                </View>
                <Text style={styles.statLabel}>POINTS</Text>
              </View>
            </LinearGradient>
          </View>

          {/* ── CHALLENGES (preserved) ───────────────── */}
          {homeData.challenges.length > 0 && (
            <View style={styles.challengesOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.challengesGradient}
              >
                <View style={styles.challengesEdge}>
                  <View style={styles.cardLabelRow}>
                    <Text style={styles.cardLabel}>CHALLENGES</Text>
                    <Text style={styles.challengeCount}>
                      {homeData.challenges.filter((c) => c.completed).length}/
                      {homeData.challenges.length}
                    </Text>
                  </View>
                  {homeData.challenges.map((challenge, idx) => {
                    const progress =
                      challenge.target > 0
                        ? Math.min(
                            (challenge.current / challenge.target) * 100,
                            100,
                          )
                        : 0;
                    const isComplete = challenge.completed;
                    return (
                      <TouchableOpacity
                        key={challenge.id}
                        activeOpacity={0.8}
                        onPress={() => navigateToTab('Analytics')}
                        style={[
                          styles.challengeItem,
                          idx < homeData.challenges.length - 1 &&
                            styles.challengeItemBorder,
                        ]}
                      >
                        <View style={styles.challengeTop}>
                          <Zap
                            size={12}
                            color={isComplete ? COLORS.green : COLORS.accent}
                            strokeWidth={1.6}
                          />
                          <Text style={styles.challengeTitle} numberOfLines={1}>
                            {challenge.title}
                          </Text>
                          <Text style={styles.challengeCounter}>
                            {challenge.current}/{challenge.target}
                          </Text>
                        </View>
                        <View style={styles.progressTrackThin}>
                          {progress > 0 && (
                            <View
                              style={[
                                styles.progressFillThin,
                                {
                                  width: `${progress}%`,
                                  backgroundColor: isComplete
                                    ? COLORS.green
                                    : COLORS.accent,
                                },
                              ]}
                            />
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </LinearGradient>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
};

// ── Inline text styles for ScoreRing ───────────────
const ringValue = {
  fontFamily: FONTS.display.bold,
  letterSpacing: -0.5,
};
const ringSub = {
  fontFamily: FONTS.ui.regular,
  fontSize: 10,
  color: COLORS.textTertiary,
  marginTop: -2,
};

// ── Styles ─────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 140,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 12,
  },
  brand: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Greeting */
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 6,
    paddingBottom: 18,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
    color: '#FFFFFF',
  },
  greetingTextWrap: { flex: 1, gap: 0 },
  greetingHello: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 15,
    color: COLORS.textTertiary,
  },
  greetingName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  greetingSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 0,
  },

  /* Card label */
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },

  /* Form Readiness card */
  readinessOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  readinessGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  readinessEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 16,
  },
  readinessBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
    marginBottom: 14,
  },
  readinessTextWrap: { flex: 1, gap: 4 },
  readinessStatus: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  readinessGuidance: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },

  startBtnOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#7A55FF',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 4,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
  },
  startBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  /* Quick actions */
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  actionBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
  },

  /* Weekly Target */
  weeklyOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  weeklyGradient: { borderRadius: CARD_RADIUS, overflow: 'hidden' },
  weeklyEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 16,
    gap: 10,
  },
  weeklyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  weeklyValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    marginTop: 4,
    letterSpacing: -0.2,
  },
  weeklyPct: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.accent,
    letterSpacing: -0.3,
  },
  weeklyRemaining: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
  },

  /* Next Badge */
  rewardsOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  rewardsGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  rewardsEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 16,
    gap: 10,
  },
  rewardsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rewardTitleBlock: {
    flex: 1,
    gap: 4,
  },
  rewardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  rewardIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  rewardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rewardMeta: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
  },
  rewardMetaStrong: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11.5,
    color: COLORS.textSecondary,
    fontVariant: ['tabular-nums'],
  },

  /* Last Session */
  sessionOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  sessionGradient: { borderRadius: CARD_RADIUS, overflow: 'hidden' },
  sessionEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 14,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  sessionThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  sessionInfo: { flex: 1, gap: 2, minWidth: 0 },
  sessionName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  sessionMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
  },
  sessionStatsLine: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  sessionScoreBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3.5,
    borderColor: COLORS.green,
    backgroundColor: 'rgba(16,23,28,0.45)',
  },
  sessionScoreValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: 16,
  },

  /* Stats Strip */
  statsStripOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: CARD_RADIUS,
    paddingVertical: 13,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 0,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: 0,
  },
  statUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textTertiary,
  },
  statLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    color: COLORS.textSecondary,
    letterSpacing: 1.1,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },

  /* Progress bar */
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressTrackThin: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFillThin: {
    height: '100%',
    borderRadius: 2,
  },

  /* Challenges */
  challengesOuter: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  challengesGradient: { borderRadius: CARD_RADIUS, overflow: 'hidden' },
  challengesEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 14,
  },
  challengeCount: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
  },
  challengeItem: {
    paddingVertical: 10,
  },
  challengeItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  challengeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  challengeTitle: {
    flex: 1,
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  challengeCounter: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
