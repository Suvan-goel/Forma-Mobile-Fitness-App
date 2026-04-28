/**
 * HomeScreen — Premium graphite hub
 *
 * Visual-only redesign based on the reference mockup. Data, navigation, and
 * actions stay wired to the existing app hooks/routes.
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
import {
  ChevronRight,
  Settings,
  Play,
  Plus,
  List,
  Trophy,
  Zap,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useHomeData } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import type { RootStackParamList } from '../app/RootNavigator';

const HOME_BACKGROUND_GRADIENT: readonly [string, string, string] = ['#273039', '#1B242A', '#10171C'];
const HOME_CARD_GRADIENT: readonly [string, string, string] = ['#263037', '#1C252B', '#141B20'];
const HOME_CARD_BORDER = 'rgba(255,255,255,0.075)';
const HOME_CARD_SHADOW = 'rgba(0,0,0,0.22)';

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const getReadinessStatus = (score: number) => {
  if (score >= 75) return 'Good to go';
  if (score >= 50) return 'Check form';
  return 'Warm up';
};

const getReadinessText = (score: number) => {
  if (score >= 90) return 'Your form looks excellent. Keep tempo and range.';
  if (score >= 75) return 'Your form looks solid. Focus on controlled reps and full range.';
  if (score >= 50) return 'Keep each rep controlled and review your technique.';
  return 'Prioritize movement quality before adding intensity.';
};

const ScoreRing = ({
  value,
  color,
  size = 84,
  valueSize = 30,
  showLabel = true,
}: {
  value: number;
  color: string;
  size?: number;
  valueSize?: number;
  showLabel?: boolean;
}) => {
  const strokeWidth = Math.max(5, Math.round(size * 0.065));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(value, 100));
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <View style={[styles.scoreRingWrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.scoreRingContent}>
        <Text style={[styles.scoreRingValue, { fontSize: valueSize, lineHeight: valueSize + 3 }]}>
          {value || '--'}
        </Text>
        {showLabel && <Text style={styles.scoreRingLabel}>/100</Text>}
      </View>
    </View>
  );
};

export const HomeScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { homeData, isLoading, error, refetch } = useHomeData();

  useEffect(() => {
    if (homeData) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]).start();
    }
  }, [homeData, fadeAnim, slideAnim]);

  const navigateToTab = useCallback((tab: string) => {
    navigation.navigate('MainTabs', { screen: tab });
  }, [navigation]);

  if (isLoading || !homeData) {
    return (
      <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={72} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={190} style={{ marginBottom: SPACING.sm }} />
          <View style={styles.loadingRow}>
            <LoadingSkeleton variant="card" height={48} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={48} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={96} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={94} />
        </View>
      </LinearGradient>
    );
  }

  if (error) {
    return (
      <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </LinearGradient>
    );
  }

  const scoreColor = getScoreColor(homeData.formScore);
  const hasWorkouts = homeData.formScore > 0;
  const weeklyProgress = homeData.weeklyGoal.target > 0
    ? Math.min((homeData.weeklyGoal.current / homeData.weeklyGoal.target) * 100, 100)
    : 0;
  const workoutsLeft = Math.max(homeData.weeklyGoal.target - homeData.weeklyGoal.current, 0);
  const lastScoreColor = getScoreColor(homeData.lastWorkout?.formScore ?? 0);

  return (
    <LinearGradient colors={[...HOME_BACKGROUND_GRADIENT]} style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.header}>
            <View style={styles.headerMain}>
              <Text style={styles.brandText}>FORMA</Text>
              <View style={styles.identityRow}>
                <View style={styles.avatarWrap}>
                  <Image
                    source={require('../assets/forma_purple_logo.png')}
                    style={styles.avatarImage}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.headerTextWrap}>
                  <Text style={styles.greetingText}>{getGreeting()},</Text>
                  <Text style={styles.nameText}>{homeData.displayName}</Text>
                  <Text style={styles.taglineText}>Let's train smarter today.</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Settings size={18} color={COLORS.textSecondary} strokeWidth={1.7} />
            </TouchableOpacity>
          </View>

          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...HOME_CARD_GRADIENT]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.readinessCard}
            >
              <View style={styles.readinessEdge}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>FORM READINESS</Text>
                  <Text style={styles.infoDot}>i</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigateToTab('Analytics')}
                  style={styles.readinessBody}
                >
                  <ScoreRing value={homeData.formScore} color={scoreColor} />
                  <View style={styles.readinessCopy}>
                    <Text style={[styles.readinessStatus, { color: hasWorkouts ? scoreColor : COLORS.textSecondary }]}>
                      {hasWorkouts ? getReadinessStatus(homeData.formScore) : 'Ready when you are'}
                    </Text>
                    <Text style={styles.readinessText}>
                      {hasWorkouts ? getReadinessText(homeData.formScore) : 'Complete a workout to see your first form score.'}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={COLORS.textSecondary} strokeWidth={1.5} />
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigateToTab('Record')}
                  style={styles.ctaOuter}
                >
                  <LinearGradient
                    colors={['#7C5CFF', '#6846E8']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ctaGradient}
                  >
                    <View style={styles.ctaInner}>
                      <Play size={14} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                      <Text style={styles.ctaTitle}>Start Workout</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToTab('Record')}
            >
              <List size={17} color={COLORS.text} strokeWidth={1.5} />
              <Text style={styles.actionBtnText}>Choose Template</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => navigateToTab('Record')}
            >
              <Plus size={18} color={COLORS.text} strokeWidth={1.8} />
              <Text style={styles.actionBtnText}>Create New</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Analytics')}
            style={styles.cardOuter}
          >
            <LinearGradient
              colors={[...HOME_CARD_GRADIENT]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.weeklyCard}
            >
              <View style={styles.weeklyEdge}>
                <View style={styles.weeklyHeaderRow}>
                  <Text style={styles.cardTitle}>WEEKLY TARGET</Text>
                  <Text style={styles.weeklyPercent}>{Math.round(weeklyProgress)}%</Text>
                </View>
                <Text style={styles.weeklyCount}>{homeData.weeklyGoal.current} of {homeData.weeklyGoal.target} workouts</Text>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={[COLORS.accent, COLORS.primaryDark]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={[styles.progressFill, { width: `${weeklyProgress}%` }]}
                  />
                </View>
                <Text style={styles.weeklySubtext}>
                  {workoutsLeft === 0 ? 'Target complete this week' : `${workoutsLeft} ${workoutsLeft === 1 ? 'workout' : 'workouts'} left this week`}
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {homeData.lastWorkout ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('WorkoutDetails', { workoutId: homeData.lastWorkout!.id })}
              style={styles.cardOuter}
            >
              <LinearGradient
                colors={[...HOME_CARD_GRADIENT]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.sessionCard}
              >
                <View style={styles.sessionEdge}>
                  <Text style={styles.cardTitle}>LAST SESSION</Text>
                  <View style={styles.sessionRow}>
                    <Image
                      source={require('../assets/exercises/barbell_squat.png')}
                      style={styles.sessionThumb}
                      resizeMode="cover"
                    />
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionName} numberOfLines={1}>{homeData.lastWorkout.name}</Text>
                      <Text style={styles.sessionTime}>{homeData.lastWorkout.date} · {homeData.lastWorkout.duration}</Text>
                      <Text style={styles.sessionMeta} numberOfLines={1}>
                        {homeData.lastWorkout.totalSets} sets, {homeData.lastWorkout.totalReps} reps
                      </Text>
                    </View>
                    <View style={styles.sessionScoreWrap}>
                      <ScoreRing
                        value={homeData.lastWorkout.formScore}
                        color={lastScoreColor}
                        size={50}
                        valueSize={18}
                        showLabel={false}
                      />
                    </View>
                    <ChevronRight size={17} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <LinearGradient
              colors={[...HOME_CARD_GRADIENT]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.sessionCard, styles.cardOuter]}
            >
              <View style={styles.sessionEdge}>
                <Text style={styles.cardTitle}>LAST SESSION</Text>
                <Text style={styles.emptyText}>No workouts yet. Start your first one.</Text>
              </View>
            </LinearGradient>
          )}

          <View style={styles.statsStrip}>
            <TouchableOpacity
              style={styles.stripStat}
              activeOpacity={0.75}
              onPress={() => navigateToTab('Analytics')}
            >
              <Text style={styles.stripLabel}>STREAK</Text>
              <Text style={styles.stripValue}>{homeData.streakDays}</Text>
              <Text style={styles.stripUnit}>days</Text>
            </TouchableOpacity>
            <View style={styles.stripDivider} />
            <TouchableOpacity
              style={styles.stripStat}
              activeOpacity={0.75}
              onPress={() => navigateToTab('Logbook')}
            >
              <Text style={styles.stripLabel}>THIS WEEK</Text>
              <Text style={styles.stripValue}>{homeData.weeklyGoal.current}</Text>
              <Text style={styles.stripUnit}>workouts</Text>
            </TouchableOpacity>
            <View style={styles.stripDivider} />
            <TouchableOpacity
              style={styles.stripStat}
              activeOpacity={0.75}
              onPress={() => navigateToTab('Logbook')}
            >
              <Text style={styles.stripLabel}>TOTAL REPS</Text>
              <Text style={styles.stripValueSmall}>{homeData.lastWorkout?.totalReps ?? '--'}</Text>
            </TouchableOpacity>
            <View style={styles.stripDivider} />
            <TouchableOpacity
              style={styles.stripStat}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Rewards')}
            >
              <Text style={styles.stripLabel}>POINTS</Text>
              <Text style={styles.stripValueSmall}>{homeData.totalPoints.toLocaleString()}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.belowFoldSpacer} />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Rewards')}
            style={styles.cardOuter}
          >
            <LinearGradient
              colors={[...HOME_CARD_GRADIENT]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.rewardCard}
            >
              <View style={styles.rewardEdge}>
                <View style={styles.rewardRow}>
                  <Trophy size={18} color={COLORS.yellow} strokeWidth={1.6} />
                  <View style={styles.rewardCopy}>
                    <Text style={styles.cardTitle}>ACHIEVEMENTS</Text>
                    <Text style={styles.rewardText} numberOfLines={1}>
                      {homeData.nextBadge ? `Next: ${homeData.nextBadge.name}` : 'All badges unlocked'}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textSecondary} strokeWidth={1.5} />
                </View>
                {homeData.nextBadge && (
                  <View style={styles.rewardProgressRow}>
                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={[homeData.nextBadge.color + 'BB', homeData.nextBadge.color]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.progressFill, { width: `${Math.min((homeData.nextBadge.current / homeData.nextBadge.required) * 100, 100)}%` }]}
                      />
                    </View>
                    <Text style={[styles.rewardPct, { color: homeData.nextBadge.color }]}>
                      {Math.round((homeData.nextBadge.current / homeData.nextBadge.required) * 100)}%
                    </Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {homeData.challenges.length > 0 && (
            <LinearGradient
              colors={[...HOME_CARD_GRADIENT]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.challengeCard, styles.cardOuter]}
            >
              <View style={styles.challengeEdge}>
                <View style={styles.challengeHeader}>
                  <View style={styles.challengeTitleRow}>
                    <Zap size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.cardTitle}>CHALLENGES</Text>
                  </View>
                  <Text style={styles.challengeCounter}>
                    {homeData.challenges.filter(c => c.completed).length}/{homeData.challenges.length}
                  </Text>
                </View>

                {homeData.challenges.map((challenge, idx) => {
                  const progress = challenge.target > 0
                    ? Math.min((challenge.current / challenge.target) * 100, 100)
                    : 0;
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
                        <Text style={styles.challengeTitleText} numberOfLines={1}>{challenge.title}</Text>
                        <Text style={styles.challengeCount}>
                          {challenge.completed ? 'DONE' : `${challenge.current}/${challenge.target}`}
                        </Text>
                      </View>
                      <View style={styles.progressTrack}>
                        {progress > 0 && (
                          <LinearGradient
                            colors={challenge.completed ? ['#45D483BB', '#45D483'] : [COLORS.accent + 'BB', COLORS.accent]}
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
    </LinearGradient>
  );
};

const CARD_RADIUS = 8;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xl,
  },
  loadingRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.sm,
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
    paddingHorizontal: 15,
    paddingTop: 5,
    paddingBottom: 128,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerMain: {
    flex: 1,
    gap: 10,
  },
  brandText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 3.8,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  avatarWrap: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B242A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  avatarImage: {
    width: 42,
    height: 42,
  },
  headerTextWrap: {
    flex: 1,
  },
  greetingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 15,
  },
  nameText: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
    lineHeight: 21,
  },
  taglineText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    lineHeight: 14,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 19,
  },

  cardOuter: {
    marginBottom: 7,
    shadowColor: HOME_CARD_SHADOW,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 2,
  },
  readinessCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  readinessEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    padding: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.45,
  },
  infoDot: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 1,
    borderColor: COLORS.textTertiary,
    color: COLORS.textTertiary,
    fontFamily: FONTS.ui.bold,
    fontSize: 9,
    lineHeight: 11,
    textAlign: 'center',
  },
  readinessBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginTop: 11,
  },
  readinessCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  readinessStatus: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    letterSpacing: -0.2,
  },
  readinessText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.text,
    lineHeight: 18,
  },

  scoreRingWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingContent: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingValue: {
    fontFamily: FONTS.display.bold,
    color: COLORS.text,
    letterSpacing: -1,
  },
  scoreRingLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: -2,
  },

  ctaOuter: {
    marginTop: 11,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  ctaGradient: {
    borderRadius: CARD_RADIUS,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 39,
    paddingHorizontal: 16,
  },
  ctaTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 7,
  },
  actionBtn: {
    flex: 1,
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.032)',
  },
  actionBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.text,
  },

  weeklyCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  weeklyEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    padding: 10,
  },
  weeklyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  weeklyPercent: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.accent,
    letterSpacing: -0.8,
    lineHeight: 25,
  },
  weeklyCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.text,
    marginTop: 7,
    marginBottom: 7,
  },
  weeklySubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 7,
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
    flex: 1,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  sessionCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  sessionEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    padding: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
  },
  sessionThumb: {
    width: 54,
    height: 54,
    borderRadius: 6,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  sessionInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sessionName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  sessionTime: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
  },
  sessionMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textTertiary,
  },
  sessionScoreWrap: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 8,
  },

  statsStrip: {
    marginBottom: 0,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: HOME_CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.026)',
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  stripStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 3,
  },
  stripDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  stripLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 7.5,
    color: COLORS.textTertiary,
    letterSpacing: 0.45,
    marginBottom: 3,
  },
  stripValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.5,
    lineHeight: 18,
  },
  stripValueSmall: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 16,
  },
  stripUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 8.5,
    color: COLORS.textSecondary,
  },

  rewardCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  rewardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.12)',
    padding: 12,
  },
  belowFoldSpacer: {
    height: 72,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rewardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rewardText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  rewardProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  rewardPct: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    letterSpacing: -0.2,
  },

  challengeCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  challengeEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 12,
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  challengeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeCounter: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
  },
  challengeItem: {
    paddingTop: 11,
    paddingBottom: 10,
  },
  challengeItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  challengeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  challengeTitleText: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  challengeCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
