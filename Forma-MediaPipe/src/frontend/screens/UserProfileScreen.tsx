/**
 * UserProfileScreen — Your own public-facing profile page.
 * Redesigned to match HomeScreen design language.
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Menu,
  Edit2,
  Gift,
  BarChart2,
  Video,
  BookOpen,
  ChevronRight,
  Flame,
  TrendingUp,
  TrendingDown,
  Activity,
  Dumbbell,
  Trophy,
  User,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useUser, useWorkouts, useFriends, useAnalytics, useFollowing } from '../../backend/hooks';
import type { RootStackParamList } from '../app/RootNavigator';
import type { WorkoutBarData } from '../../backend/services/api';

type UserProfileNavigationProp = NativeStackNavigationProp<RootStackParamList>;

/* ── Mini Bar Chart ──────────────────────────────── */

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MiniBarChart: React.FC<{
  data: WorkoutBarData[];
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
}> = ({ data, selectedIndex, onSelect }) => {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const hasSelection = selectedIndex !== null;
  return (
    <View style={chartStyles.container}>
      {data.map((d, i) => {
        const heightPct = d.value > 0 ? Math.max(14, Math.round((d.value / maxVal) * 100)) : 4;
        const isSelected = selectedIndex === i;
        const isDimmed = hasSelection && !isSelected;
        return (
          <TouchableOpacity
            key={i}
            style={chartStyles.barWrap}
            onPress={() => onSelect(isSelected ? null : i)}
            activeOpacity={0.7}
          >
            <View style={[chartStyles.barTrack, isSelected && chartStyles.barTrackSelected]}>
              <View
                style={[
                  chartStyles.barFill,
                  { height: `${heightPct}%` as any },
                  d.value === 0 && chartStyles.barEmpty,
                  isDimmed && chartStyles.barDimmed,
                  isSelected && chartStyles.barSelected,
                ]}
              />
            </View>
            <Text style={[chartStyles.dayLabel, isSelected && chartStyles.dayLabelSelected]}>
              {DAY_LABELS[i % 7]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const chartStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 120,
    marginTop: 14,
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  barTrack: {
    flex: 1,
    width: '62%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
    opacity: 0.9,
  },
  barEmpty: {
    opacity: 0.2,
    backgroundColor: COLORS.textTertiary,
  },
  barDimmed: {
    opacity: 0.3,
  },
  barSelected: {
    opacity: 1,
  },
  barTrackSelected: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  dayLabel: {
    fontFamily: FONTS.mono.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    marginTop: 5,
    letterSpacing: 0.5,
  },
  dayLabelSelected: {
    color: COLORS.primary,
    fontFamily: FONTS.mono.bold,
  },
});

/* ── Main Screen ─────────────────────────────────── */

export const UserProfileScreen: React.FC = () => {
  const navigation = useNavigation<UserProfileNavigationProp>();
  const insets = useSafeAreaInsets();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const { user } = useUser();
  const { workouts } = useWorkouts();
  const { friends } = useFriends();
  const { counts: followCounts } = useFollowing();
  const { analytics } = useAnalytics('1 week', 4);

  const workoutCount = workouts.length;
  const friendsCount = friends.length;
  const weeklyBarData = analytics?.weeklyBarData ?? [];
  const totalMinutes = analytics?.summary.totalDurationMinutes ?? 0;
  const streakDays = analytics?.summary.streakDays ?? 0;
  const totalReps = analytics?.summary.totalReps ?? 0;
  const mostTrained = analytics?.summary.mostTrainedExercise ?? null;
  const formTrendDirection = analytics?.summary.formTrendDirection ?? 'flat';
  const formTrendPercent = analytics?.summary.formTrendPercent ?? 0;
  const formValues = analytics?.formData.values ?? [];
  const avgFormScore = formValues.length > 0
    ? Math.round(formValues.reduce((a, b) => a + b, 0) / formValues.length)
    : 0;

  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const selectedDayData = selectedDayIndex !== null ? weeklyBarData[selectedDayIndex] : null;

  useEffect(() => {
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
  }, [fadeAnim, slideAnim]);

  const handleGoBack = useCallback(() => navigation.navigate('MainTabs', { screen: 'Home' }), [navigation]);
  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleEditProfile = useCallback(() => navigation.navigate('ProfileSettings'), [navigation]);
  const handleRewards = useCallback(() => navigation.navigate('Rewards'), [navigation]);
  const handleTutorials = useCallback(() => navigation.navigate('Tutorials'), [navigation]);

  const initial = user?.displayName ? user.displayName[0].toUpperCase() : '?';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header (Social-style) ──────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={handleGoBack} activeOpacity={0.7} style={styles.backBtn}>
            <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>{user?.displayName?.toUpperCase() ?? ''}</Text>
            <Text style={styles.headerSubtitle}>YOUR PROFILE</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={handleSettings}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Menu size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              HERO: PROFILE CARD
              ═══════════════════════════════════════════ */}
          <TouchableOpacity activeOpacity={0.85} onPress={handleEditProfile}>
            <LinearGradient
              colors={SCREEN_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroEdge}>
                {/* Top label row */}
                <View style={styles.heroTopRow}>
                  <View style={styles.heroLabelRow}>
                    <User size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.heroLabel}>PROFILE</Text>
                  </View>
                  <View style={styles.editChip}>
                    <Edit2 size={10} color={COLORS.accent} strokeWidth={2} />
                    <Text style={styles.editChipText}>Edit</Text>
                  </View>
                </View>

                {/* Avatar + name row */}
                <View style={styles.heroProfileRow}>
                  <View style={styles.avatarRing}>
                    {user?.avatarUrl ? (
                      <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                    ) : (
                      <LinearGradient
                        colors={['#9F75FF', '#7C3AED']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.avatarGradient}
                      >
                        <Text style={styles.avatarInitial}>{initial}</Text>
                      </LinearGradient>
                    )}
                  </View>
                  <View style={styles.heroNameWrap}>
                    <Text style={styles.heroDisplayName}>{user?.displayName ?? ''}</Text>
                    {user?.bio ? (
                      <Text style={styles.heroBio} numberOfLines={2}>{user.bio}</Text>
                    ) : null}
                  </View>
                </View>

                {/* Inline stats row */}
                <View style={styles.heroStatsRow}>
                  <View style={styles.heroStatItem}>
                    <Text style={styles.heroStatValue}>{workoutCount}</Text>
                    <Text style={styles.heroStatLabel}>workouts</Text>
                  </View>
                  <View style={styles.heroStatDivider} />
                  <TouchableOpacity
                    style={styles.heroStatItem}
                    onPress={() => navigation.navigate('FollowList', { mode: 'followers' })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.heroStatValue}>{followCounts.followerCount}</Text>
                    <Text style={styles.heroStatLabel}>followers</Text>
                  </TouchableOpacity>
                  <View style={styles.heroStatDivider} />
                  <TouchableOpacity
                    style={styles.heroStatItem}
                    onPress={() => navigation.navigate('FollowList', { mode: 'following' })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.heroStatValue}>{followCounts.followingCount}</Text>
                    <Text style={styles.heroStatLabel}>following</Text>
                  </TouchableOpacity>
                  <View style={styles.heroStatDivider} />
                  <View style={styles.heroStatItem}>
                    <Text style={styles.heroStatValue}>{friendsCount}</Text>
                    <Text style={styles.heroStatLabel}>friends</Text>
                  </View>
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              EDIT PROFILE CTA (Quick Start style)
              ═══════════════════════════════════════════ */}
          <TouchableOpacity activeOpacity={0.85} onPress={handleEditProfile}>
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <View style={styles.ctaInner}>
                <View style={styles.ctaIconWrap}>
                  <Edit2 size={16} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View style={styles.ctaTextWrap}>
                  <Text style={styles.ctaTitle}>Edit Profile</Text>
                  <Text style={styles.ctaSub}>Customize your public profile</Text>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              REWARDS — Section header + card
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>REWARDS</Text>
            </View>
            <TouchableOpacity style={styles.seeAllBtn} activeOpacity={0.7} onPress={handleRewards}>
              <Text style={styles.seeAllText}>View All</Text>
              <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity activeOpacity={0.85} onPress={handleRewards}>
            <LinearGradient
              colors={['#1A1510', '#111008', '#0E0C07']}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.rewardsCard}
            >
              <View style={styles.rewardsEdge}>
                <View style={styles.rewardsRow}>
                  <View style={styles.rewardsIconWrap}>
                    <Gift size={20} color={COLORS.yellow} strokeWidth={1.5} />
                  </View>
                  <View style={styles.rewardsTextWrap}>
                    <Text style={styles.rewardsTitle}>Badges & Points</Text>
                    <Text style={styles.rewardsSubtitle}>View your badges & points</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              PROGRESS — Weekly activity
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <BarChart2 size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>PROGRESS</Text>
            </View>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.progressCard}
          >
            <View style={styles.progressEdge}>
              <View style={styles.progressTopRow}>
                <View style={styles.progressTextWrap}>
                  <Text style={styles.progressTitle}>
                    {selectedDayData
                      ? `${DAY_LABELS[selectedDayIndex!]} · ${selectedDayData.value} min`
                      : 'Minutes active this week'}
                  </Text>
                </View>
                <View style={styles.minutesBadge}>
                  <Text style={styles.minutesValue}>
                    {selectedDayData ? selectedDayData.value : totalMinutes}
                  </Text>
                  <Text style={styles.minutesUnit}>min</Text>
                </View>
              </View>
              {weeklyBarData.length > 0 && (
                <MiniBarChart
                  data={weeklyBarData}
                  selectedIndex={selectedDayIndex}
                  onSelect={setSelectedDayIndex}
                />
              )}
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              EXPLORE — Link cards
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <BookOpen size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>EXPLORE</Text>
            </View>
          </View>

          <TouchableOpacity activeOpacity={0.85} onPress={handleTutorials}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.linkCard}
            >
              <View style={styles.linkEdge}>
                <View style={styles.linkRow}>
                  <View style={styles.linkIconWrap}>
                    <BookOpen size={18} color={COLORS.accent} strokeWidth={1.5} />
                  </View>
                  <View style={styles.linkTextWrap}>
                    <Text style={styles.linkTitle}>Exercise Tutorials</Text>
                    <Text style={styles.linkSubtitle}>Browse exercise guides</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 8 }} />

          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('VideoLibrary')}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.linkCard}
            >
              <View style={styles.linkEdge}>
                <View style={styles.linkRow}>
                  <View style={styles.linkIconWrap}>
                    <Video size={18} color={COLORS.accent} strokeWidth={1.5} />
                  </View>
                  <View style={styles.linkTextWrap}>
                    <Text style={styles.linkTitle}>Video Library</Text>
                    <Text style={styles.linkSubtitle}>Your recorded workouts</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              PERFORMANCE — 2×2 Bento grid
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Activity size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>PERFORMANCE</Text>
            </View>
          </View>

          <View style={styles.perfRow}>
            <View style={styles.perfCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.perfGradient}
              >
                <View style={styles.perfEdge}>
                  <View style={styles.perfIconRow}>
                    <View style={[styles.perfIconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                      <Flame size={14} color={COLORS.yellow} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.perfValue}>{streakDays > 0 ? String(streakDays) : '—'}</Text>
                  <Text style={styles.perfUnit}>days</Text>
                  <Text style={styles.perfLabel}>Day Streak</Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.perfCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.perfGradient}
              >
                <View style={styles.perfEdge}>
                  <View style={styles.perfIconRow}>
                    <View style={[styles.perfIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <TrendingUp size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                    {formTrendDirection !== 'flat' && formTrendPercent > 0 && (
                      <View style={[
                        styles.trendBadge,
                        { backgroundColor: formTrendDirection === 'up' ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)' },
                      ]}>
                        {formTrendDirection === 'up'
                          ? <TrendingUp size={9} color="#34D399" strokeWidth={2} />
                          : <TrendingDown size={9} color="#F87171" strokeWidth={2} />}
                        <Text style={[
                          styles.trendBadgeText,
                          { color: formTrendDirection === 'up' ? '#34D399' : '#F87171' },
                        ]}>
                          {formTrendPercent}%
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.perfValue}>{avgFormScore > 0 ? String(avgFormScore) : '—'}</Text>
                  <Text style={styles.perfUnit}>{avgFormScore > 0 ? '%' : ''}</Text>
                  <Text style={styles.perfLabel}>Avg Form</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          <View style={styles.perfRow}>
            <View style={styles.perfCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.perfGradient}
              >
                <View style={styles.perfEdge}>
                  <View style={styles.perfIconRow}>
                    <View style={[styles.perfIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <Activity size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.perfValue}>{totalReps > 0 ? String(totalReps) : '—'}</Text>
                  <Text style={styles.perfUnit}>{totalReps > 0 ? 'reps' : ''}</Text>
                  <Text style={styles.perfLabel}>Total Reps</Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.perfCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.perfGradient}
              >
                <View style={styles.perfEdge}>
                  <View style={styles.perfIconRow}>
                    <View style={[styles.perfIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.perfValue} numberOfLines={1} adjustsFontSizeToFit>
                    {mostTrained ?? '—'}
                  </Text>
                  <Text style={styles.perfUnit}> </Text>
                  <Text style={styles.perfLabel}>Top Exercise</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header — Home-style */
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
  backBtn: {
    width: 10,
    height: 0,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -5,
  },
  logoWrap: {
    width: 50,
    height: 55,
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
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Scroll */
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* ── Hero Profile Card ─────────────────────────── */
  heroCard: {
    borderRadius: 22,
    marginBottom: 12,
    marginTop: 18,
  },
  heroEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  editChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  editChipText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.accent,
    letterSpacing: -0.3,
  },
  heroProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    borderColor: 'rgba(139, 92, 246, 0.55)',
    padding: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
  },
  avatarGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
  },
  heroNameWrap: {
    flex: 1,
    gap: 4,
  },
  heroDisplayName: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  heroBio: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.10)',
  },
  heroStatItem: {
    alignItems: 'center',
    gap: 2,
  },
  heroStatValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  heroStatValueDim: {
    color: COLORS.textTertiary,
  },
  heroStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },

  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 20,
  },
  trendBadgeText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 9,
  },

  /* ── CTA Button (Quick Start style) ────────────── */
  ctaGradient: {
    borderRadius: 16,
    marginBottom: 4,
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

  /* ── Section Headers (Home-style) ──────────────── */
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

  /* ── Rewards Card (Gold-tinted like Achievements) ─ */
  rewardsCard: {
    borderRadius: 18,
  },
  rewardsEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
    padding: 16,
  },
  rewardsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rewardsIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 166, 35, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsTextWrap: {
    flex: 1,
    gap: 2,
  },
  rewardsTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  rewardsSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  /* ── Progress Card ─────────────────────────────── */
  progressCard: {
    borderRadius: 18,
  },
  progressEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTextWrap: {
    flex: 1,
  },
  progressTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  minutesBadge: {
    alignItems: 'center',
  },
  minutesValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.primary,
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  minutesUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* ── Link Cards ────────────────────────────────── */
  linkCard: {
    borderRadius: 16,
  },
  linkEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkIconWrapDim: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  linkTextWrap: {
    flex: 1,
    gap: 2,
  },
  linkTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  linkTitleDim: {
    color: COLORS.textSecondary,
  },
  linkSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Performance Grid ──────────────────────────── */
  perfRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  perfCell: {
    flex: 1,
    height: 150,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  perfGradient: {
    borderRadius: 18,
    flex: 1,
  },
  perfEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    flex: 1,
  },
  perfIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  perfIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perfValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  perfUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  perfLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
});
