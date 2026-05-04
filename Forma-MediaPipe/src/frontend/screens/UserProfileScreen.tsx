/**
 * UserProfileScreen — Your own public-facing profile page.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  Activity,
  ChevronRight,
  Crown,
  Flame,
  Lock,
  Pencil,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  Video,
  Zap,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_VERTICAL_GAP,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { useAnalytics } from '../../backend/hooks/useAnalytics';
import { useRewards } from '../../backend/hooks/useRewards';
import { useUser } from '../../backend/hooks/useUser';
import { useVideoLibrary } from '../../backend/hooks/useVideoLibrary';
import { useWorkouts } from '../../backend/hooks/useWorkouts';
import type { RootStackParamList } from '../app/RootNavigator';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type UserProfileNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const UserProfileScreen: React.FC = () => {
  const navigation = useNavigation<UserProfileNavigationProp>();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  const { user } = useUser();
  const { workouts } = useWorkouts();
  const { analytics } = useAnalytics('1 week', 4);
  const { rewards, userPoints, userStats } = useRewards();
  const { recordings, storageInfo } = useVideoLibrary();

  const workoutCount = workouts.length;
  const streakDays = analytics?.summary.streakDays ?? 0;
  const formValues = analytics?.formData.values ?? [];
  const avgFormScore =
    formValues.length > 0
      ? Math.round(formValues.reduce((a, b) => a + b, 0) / formValues.length)
      : 0;
  const displayName = user?.displayName || 'Forma Athlete';
  const handle = `@${
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 18) || 'forma'
  }`;
  const initial = displayName.charAt(0).toUpperCase();
  const earnedBadgeIds = userStats?.earnedBadgeIds ?? [];
  const sortedRewards = useMemo(
    () => [...rewards].sort((a, b) => a.pointsRequired - b.pointsRequired),
    [rewards],
  );
  const earnedRewards = useMemo(
    () => sortedRewards.filter((reward) => earnedBadgeIds.includes(reward.id)),
    [earnedBadgeIds, sortedRewards],
  );
  const nextReward = sortedRewards.find(
    (reward) => !earnedBadgeIds.includes(reward.id),
  );
  const currentReward = earnedRewards[earnedRewards.length - 1];
  const badgeProgress = nextReward
    ? Math.min(userPoints / nextReward.pointsRequired, 1)
    : 1;
  const level = Math.max(1, earnedRewards.length + 1);
  const nextRewardIconName =
    nextReward?.iconName ?? currentReward?.iconName ?? 'Trophy';
  const nextRewardColor =
    nextReward?.color ?? currentReward?.color ?? COLORS.primary;
  const latestRecording = recordings[0];
  const videoCount = storageInfo.count || recordings.length;
  const videoCountLabel = `${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`;
  const storageLabel =
    storageInfo.totalSizeMB > 0
      ? `${storageInfo.totalSizeMB >= 10 ? Math.round(storageInfo.totalSizeMB) : storageInfo.totalSizeMB.toFixed(1)} MB saved`
      : 'Ready to record';
  const videoDetailLabel = latestRecording
    ? `Latest: ${latestRecording.exerciseName} · Set ${latestRecording.setNumber}`
    : 'Review saved form recordings';

  const achievements = useMemo(() => {
    const recentBadges = earnedRewards.slice(0, 2).map((reward) => ({
      id: reward.id,
      title: reward.title,
      subtitle: reward.description,
      meta: `${reward.category} badge`,
      icon: 'badge' as const,
    }));

    return [
      ...(streakDays > 0
        ? [
            {
              id: 'streak',
              title: 'Form Streak',
              subtitle: `${streakDays} ${streakDays === 1 ? 'day' : 'days'} in a row`,
              meta: 'Active now',
              icon: 'check' as const,
            },
          ]
        : []),
      ...recentBadges,
      {
        id: 'score',
        title: 'Form Focus',
        subtitle:
          avgFormScore > 0
            ? `${avgFormScore} average form score`
            : 'Keep training to unlock',
        meta: 'Weekly performance',
        icon: 'target' as const,
      },
    ].slice(0, 3);
  }, [avgFormScore, earnedRewards, streakDays]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleGoBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('MainTabs', { screen: 'Home' });
  }, [navigation]);
  const handleEditProfile = useCallback(
    () => navigation.navigate('ProfileSettings'),
    [navigation],
  );
  const handleRewards = useCallback(
    () => navigation.navigate('Rewards'),
    [navigation],
  );
  const handleVideoLibrary = useCallback(
    () => navigation.navigate('VideoLibrary'),
    [navigation],
  );

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader
        title="PROFILE"
        onBack={handleGoBack}
        rightSlot={
          <TouchableOpacity
            onPress={handleEditProfile}
            activeOpacity={0.7}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
          >
            <Pencil size={20} color={COLORS.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 96) },
        ]}
      >
        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          <View style={styles.profileRow}>
            <View style={styles.avatarRing}>
              {user?.avatarUrl ? (
                <Image
                  source={{ uri: user.avatarUrl }}
                  style={styles.avatarImage}
                />
              ) : (
                <LinearGradient
                  colors={['#F3F4F6', '#B8BCC5']}
                  style={styles.avatarFallback}
                >
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </LinearGradient>
              )}
            </View>

            <View style={styles.nameBlock}>
              <Text style={styles.displayName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.handle} numberOfLines={1}>
                {handle}
              </Text>
            </View>
          </View>

          <View style={styles.statStrip}>
            <StatBlock value={workoutCount || 0} label="Total Workouts" />
            <View style={styles.statDivider} />
            <StatBlock value={avgFormScore || 0} label="Avg Form Score" />
          </View>

          <VideoLibraryCard
            countLabel={videoCountLabel}
            detailLabel={videoDetailLabel}
            storageLabel={storageLabel}
            thumbnailUri={latestRecording?.thumbnailPath}
            onPress={handleVideoLibrary}
          />

          <ProfileCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Level & Rewards</Text>
              <TouchableOpacity onPress={handleRewards} activeOpacity={0.75}>
                <Text style={styles.viewAll}>View all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.levelRow}>
              <LinearGradient
                colors={[`${nextRewardColor}33`, 'rgba(255,255,255,0.025)']}
                style={[
                  styles.levelBadge,
                  { borderColor: `${nextRewardColor}44` },
                ]}
              >
                <RewardIcon
                  iconName={nextRewardIconName}
                  size={27}
                  color={nextRewardColor}
                />
              </LinearGradient>
              <View style={styles.levelCopy}>
                <Text style={styles.levelTitle}>Level {level}</Text>
                <Text style={styles.levelSubtitle} numberOfLines={1}>
                  {nextReward
                    ? `Next badge: ${nextReward.title}`
                    : 'All badges unlocked'}
                </Text>
                <Text style={styles.levelMeta} numberOfLines={1}>
                  {earnedRewards.length}/{sortedRewards.length} badges earned
                </Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={[nextRewardColor, COLORS.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${Math.max(6, badgeProgress * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.rewardProgressRow}>
              <Text style={styles.xpText}>
                {nextReward
                  ? `${userPoints.toLocaleString()} / ${nextReward.pointsRequired.toLocaleString()} pts`
                  : `${userPoints.toLocaleString()} pts`}
              </Text>
              <Text style={styles.xpText}>
                {nextReward
                  ? `${Math.max(0, nextReward.pointsRequired - userPoints).toLocaleString()} to go`
                  : 'Complete'}
              </Text>
            </View>
          </ProfileCard>

          <ProfileCard>
            <Text style={styles.sectionTitle}>Recent Achievements</Text>
            <View style={styles.achievementList}>
              {achievements.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.achievementRow,
                    index === achievements.length - 1 &&
                      styles.achievementRowLast,
                  ]}
                >
                  <LinearGradient
                    colors={
                      item.icon === 'check'
                        ? ['#62E5A9', '#269A67']
                        : ['#8D67FF', '#4A2BB4']
                    }
                    style={styles.achievementIcon}
                  >
                    {item.icon === 'check' ? (
                      <Check size={20} color="#FFFFFF" strokeWidth={2.5} />
                    ) : null}
                    {item.icon === 'badge' ? (
                      <Sparkles size={19} color="#FFFFFF" strokeWidth={2.1} />
                    ) : null}
                    {item.icon === 'target' ? (
                      <Target size={19} color="#FFFFFF" strokeWidth={2.1} />
                    ) : null}
                  </LinearGradient>
                  <View style={styles.achievementText}>
                    <Text style={styles.achievementTitle}>{item.title}</Text>
                    <Text style={styles.achievementSubtitle}>
                      {item.subtitle}
                    </Text>
                    <Text style={styles.achievementMeta}>{item.meta}</Text>
                  </View>
                  <View style={styles.statusDot}>
                    <Check size={12} color={COLORS.green} strokeWidth={3} />
                  </View>
                </View>
              ))}
            </View>
          </ProfileCard>
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
};

const StatBlock = ({
  value,
  label,
  prefix,
}: {
  value: number;
  label: string;
  prefix?: React.ReactNode;
}) => (
  <View style={styles.statBlock}>
    <View style={styles.statValueRow}>
      {prefix}
      <Text style={styles.statValue}>{value}</Text>
    </View>
    <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>
      {label}
    </Text>
  </View>
);

const ProfileCard = ({ children }: { children: React.ReactNode }) => (
  <LinearGradient
    colors={[...CARD_GRADIENT_COLORS]}
    start={CARD_GRADIENT_START}
    end={CARD_GRADIENT_END}
    style={styles.card}
  >
    <View style={styles.cardInner}>{children}</View>
  </LinearGradient>
);

const VideoLibraryCard = ({
  countLabel,
  detailLabel,
  storageLabel,
  thumbnailUri,
  onPress,
}: {
  countLabel: string;
  detailLabel: string;
  storageLabel: string;
  thumbnailUri?: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    style={styles.videoLibraryCard}
    activeOpacity={0.82}
    onPress={onPress}
  >
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.videoLibraryGradient}
    >
      <View style={styles.videoLibraryInner}>
        <View style={styles.videoPreviewShell}>
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={styles.videoPreviewImage}
            />
          ) : (
            <LinearGradient
              colors={['rgba(122,85,255,0.24)', 'rgba(255,255,255,0.035)']}
              style={styles.videoPreviewFallback}
            >
              <Video size={24} color={COLORS.primary} strokeWidth={1.7} />
            </LinearGradient>
          )}
          <View style={styles.playBadge}>
            <Video size={12} color={COLORS.text} strokeWidth={2} />
          </View>
        </View>

        <View style={styles.videoLibraryCopy}>
          <View style={styles.videoLibraryTitleRow}>
            <Text style={styles.videoLibraryTitle} numberOfLines={1}>
              Video Library
            </Text>
            <ChevronRight
              size={18}
              color={COLORS.textTertiary}
              strokeWidth={1.8}
            />
          </View>
          <Text style={styles.videoLibrarySubtitle} numberOfLines={1}>
            {detailLabel}
          </Text>
          <View style={styles.videoMetaRow}>
            <View style={styles.videoMetaPill}>
              <Text
                style={styles.videoMetaText}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {countLabel}
              </Text>
            </View>
            <View style={styles.videoMetaPill}>
              <Text
                style={styles.videoMetaText}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {storageLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

const RewardIcon = ({
  iconName,
  size,
  color,
}: {
  iconName: string;
  size: number;
  color: string;
}) => {
  switch (iconName) {
    case 'Zap':
      return <Zap size={size} color={color} strokeWidth={1.5} />;
    case 'Target':
      return <Target size={size} color={color} strokeWidth={1.5} />;
    case 'Activity':
      return <Activity size={size} color={color} strokeWidth={1.5} />;
    case 'Shield':
      return <Shield size={size} color={color} strokeWidth={1.5} />;
    case 'Star':
      return <Star size={size} color={color} strokeWidth={1.5} />;
    case 'Flame':
      return <Flame size={size} color={color} strokeWidth={1.5} />;
    case 'Crown':
      return <Crown size={size} color={color} strokeWidth={1.5} />;
    case 'Lock':
      return <Lock size={size} color={color} strokeWidth={1.5} />;
    case 'Trophy':
    default:
      return <Trophy size={size} color={color} strokeWidth={1.5} />;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerAction: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 6,
    paddingBottom: 18,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 1,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 34,
    color: '#101418',
  },
  nameBlock: {
    flex: 1,
    gap: 4,
  },
  displayName: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
    color: COLORS.text,
    letterSpacing: 0,
  },
  handle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  statStrip: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.045)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: CARD_VERTICAL_GAP,
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 42,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  videoLibraryCard: {
    marginBottom: CARD_VERTICAL_GAP,
  },
  videoLibraryGradient: {
    borderRadius: 14,
  },
  videoLibraryInner: {
    minHeight: 112,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
  },
  videoPreviewShell: {
    width: 88,
    height: 88,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
  },
  videoPreviewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoPreviewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,85,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  videoLibraryCopy: {
    flex: 1,
    minWidth: 0,
  },
  videoLibraryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  videoLibraryTitle: {
    flex: 1,
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  videoLibrarySubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  videoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  videoMetaPill: {
    minHeight: 26,
    maxWidth: '52%',
    borderRadius: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
  },
  videoMetaText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    maxWidth: '100%',
  },
  card: {
    borderRadius: 12,
    marginBottom: CARD_VERTICAL_GAP,
  },
  cardInner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    padding: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  viewAll: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.primary,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  levelBadge: {
    width: 54,
    height: 62,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  levelNumber: {
    position: 'absolute',
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 20,
    color: COLORS.text,
  },
  levelCopy: {
    flex: 1,
    gap: 4,
  },
  levelTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
  },
  levelSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  levelMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  xpText: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  rewardProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  achievementList: {
    marginTop: 10,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.035)',
  },
  achievementRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.035)',
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  achievementRowLast: {
    borderBottomWidth: 0,
  },
  achievementIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementText: {
    flex: 1,
    gap: 1,
  },
  achievementTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
  },
  achievementSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  achievementMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  statusDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(52,224,166,0.12)',
  },
});
