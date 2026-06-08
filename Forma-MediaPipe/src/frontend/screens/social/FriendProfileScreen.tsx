/**
 * FriendProfileScreen — View a friend's public profile
 */

import React, { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  GitCompare,
  UserMinus,
  UserPlus,
} from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_VERTICAL_GAP,
} from '../../constants/theme';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { SettingsHeader } from '../../components/ui/SettingsHeader';
import { useFollowing } from '../../../backend/hooks/useFollowing';
import { useFriendProfile } from '../../../backend/hooks/useFriendProfile';
import { getBottomOverlayPadding } from '../../utils/safeAreaSpacing';

const XP_PER_LEVEL = 220;
const LEVEL_TARGET = 3000;

const FRIEND_PROFILE_ICONS = {
  level: require('../../assets/generated/friend-profile-icons/level.png'),
  streak: require('../../assets/generated/friend-profile-icons/streak.png'),
  workout: require('../../assets/generated/friend-profile-icons/workout.png'),
  badge: require('../../assets/generated/friend-profile-icons/badge.png'),
} as const;

const ACTIVITY_ICON_CONFIG = {
  check: {
    source: FRIEND_PROFILE_ICONS.streak,
    backgroundColor: 'rgba(52, 224, 166, 0.12)',
    borderColor: 'rgba(52, 224, 166, 0.28)',
  },
  target: {
    source: FRIEND_PROFILE_ICONS.workout,
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderColor: 'rgba(122, 85, 255, 0.28)',
  },
  badge: {
    source: FRIEND_PROFILE_ICONS.badge,
    backgroundColor: 'rgba(236, 161, 58, 0.12)',
    borderColor: 'rgba(236, 161, 58, 0.28)',
  },
} as const;

export const FriendProfileScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId } = route.params;
  const { profile, isLoading } = useFriendProfile(userId);
  const { followUser, unfollowUser, isFollowingUser } = useFollowing();
  const isCurrentlyFollowing = isFollowingUser(userId);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    if (profile) {
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
    }
  }, [profile, fadeAnim, slideAnim]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('MainTabs', { screen: 'Social' });
  }, [navigation]);

  const handleCompare = useCallback(() => {
    navigation.navigate('FriendComparison', { friendId: userId });
  }, [navigation, userId]);

  const handleFollow = useCallback(async () => {
    if (isCurrentlyFollowing) {
      await unfollowUser(userId);
      return;
    }
    await followUser(userId);
  }, [followUser, isCurrentlyFollowing, unfollowUser, userId]);

  const achievements = useMemo(() => {
    if (!profile) return [];

    const workouts = profile.recentWorkouts.slice(0, 2).map((workout) => ({
      id: workout.id,
      title: workout.name,
      subtitle: `${workout.duration} • ${workout.totalSets} sets`,
      meta: `${workout.formScore} form score`,
      icon: 'target' as const,
    }));

    return [
      ...(profile.streakDays > 0
        ? [
            {
              id: 'streak',
              title: 'Form Streak',
              subtitle: `${profile.streakDays} ${profile.streakDays === 1 ? 'day' : 'days'} in a row`,
              meta: 'Active recently',
              icon: 'check' as const,
            },
          ]
        : []),
      ...workouts,
      ...(profile.earnedBadgeIds.length > 0
        ? [
            {
              id: 'badge',
              title: 'Badge Collector',
              subtitle: `${profile.earnedBadgeIds.length} earned badges`,
              meta: 'Rewards progress',
              icon: 'badge' as const,
            },
          ]
        : []),
    ].slice(0, 3);
  }, [profile]);

  if (isLoading || !profile) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <SettingsHeader title="PROFILE" onBack={handleBack} />
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  const displayName = profile.displayName || 'Forma Athlete';
  const handle = `@${
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 18) || 'forma'
  }`;
  const initial = displayName.charAt(0).toUpperCase();
  const estimatedXp = Math.round(
    (profile.totalWorkouts * Math.max(profile.avgFormScore, 1)) / 1.5,
  );
  const level = Math.max(1, Math.floor(estimatedXp / XP_PER_LEVEL) + 1);
  const levelProgress = Math.min(estimatedXp / LEVEL_TARGET, 1);
  const progressPercent = Math.round(levelProgress * 100);
  const remainingXp = Math.max(0, LEVEL_TARGET - estimatedXp);
  const profileSummary =
    profile.streakDays > 0
      ? `${profile.streakDays} ${profile.streakDays === 1 ? 'day' : 'days'} form streak with ${profile.totalWorkouts || 0} workouts logged.`
      : `${profile.totalWorkouts || 0} workouts logged with a ${Math.round(profile.avgFormScore) || 0} avg form score.`;

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="PROFILE" onBack={handleBack} />

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
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              {profile.avatarUrl ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
                  style={styles.avatarImage}
                />
              ) : (
                <LinearGradient
                  colors={['#ECEFF3', '#B6BBC3']}
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
              <Text style={styles.profileMeta} numberOfLines={1}>
                Public training profile
              </Text>
            </View>
          </View>

          <View style={styles.actionBar}>
            <TouchableOpacity
              activeOpacity={0.76}
              onPress={handleFollow}
              style={[
                styles.actionButton,
                isCurrentlyFollowing
                  ? styles.actionButtonMuted
                  : styles.actionButtonPrimary,
              ]}
            >
              {isCurrentlyFollowing ? (
                <UserMinus
                  size={15}
                  color={COLORS.textSecondary}
                  strokeWidth={1.8}
                />
              ) : (
                <UserPlus size={15} color={COLORS.text} strokeWidth={1.8} />
              )}
              <Text
                style={[
                  styles.actionButtonText,
                  isCurrentlyFollowing && styles.actionButtonTextMuted,
                ]}
              >
                {isCurrentlyFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.76}
              onPress={handleCompare}
              style={[styles.actionButton, styles.actionButtonSecondary]}
            >
              <GitCompare
                size={15}
                color={COLORS.textSecondary}
                strokeWidth={1.8}
              />
              <Text style={[styles.actionButtonText, styles.actionButtonTextMuted]}>
                Compare
              </Text>
            </TouchableOpacity>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.statStrip}
          >
            <StatBlock
              value={profile.totalWorkouts || 0}
              label="Total Workouts"
            />
            <View style={styles.statDivider} />
            <StatBlock
              value={Math.round(profile.avgFormScore) || 0}
              label="Avg Form Score"
            />
          </LinearGradient>

          <ProfileCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Training Profile</Text>
              <Text style={styles.sectionMeta}>Level {level}</Text>
            </View>

            <View style={styles.levelRow}>
              <View style={styles.levelBadge}>
                <Image
                  source={FRIEND_PROFILE_ICONS.level}
                  style={styles.levelBadgeImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.levelCopy}>
                <Text style={styles.levelTitle}>Strong Performer</Text>
                <Text style={styles.levelSubtitle} numberOfLines={2}>
                  {profileSummary}
                </Text>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(6, levelProgress * 100)}%` },
                ]}
              />
            </View>

            <View style={styles.progressMetaRow}>
              <Text style={styles.xpText}>
                {estimatedXp.toLocaleString()} / {LEVEL_TARGET.toLocaleString()} XP
              </Text>
              <Text style={styles.xpText}>
                {remainingXp > 0
                  ? `${remainingXp.toLocaleString()} to goal`
                  : `${progressPercent}% complete`}
              </Text>
            </View>
          </ProfileCard>

          <ProfileCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              {achievements.length > 0 ? (
                <Text style={styles.sectionMeta}>{achievements.length} items</Text>
              ) : null}
            </View>

            <View style={styles.activityList}>
              {achievements.length > 0 ? (
                achievements.map((item, index) => {
                  const iconConfig = ACTIVITY_ICON_CONFIG[item.icon];

                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.activityRow,
                        index === achievements.length - 1 &&
                          styles.activityRowLast,
                      ]}
                    >
                      <View
                        style={[
                          styles.activityIcon,
                          {
                            backgroundColor: iconConfig.backgroundColor,
                            borderColor: iconConfig.borderColor,
                          },
                        ]}
                      >
                        <Image
                          source={iconConfig.source}
                          style={styles.activityIconImage}
                          resizeMode="contain"
                        />
                      </View>

                      <View style={styles.activityText}>
                        <Text style={styles.activityTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.activitySubtitle} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      </View>

                      <Text style={styles.activityMeta} numberOfLines={1}>
                        {item.meta}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyActivity}>
                  <Text style={styles.emptyActivityText}>
                    No recent public activity
                  </Text>
                </View>
              )}
            </View>
          </ProfileCard>
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
});

const StatBlock = ({ value, label }: { value: number; label: string }) => (
  <View style={styles.statBlock}>
    <Text style={styles.statValue}>{value}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 4,
    paddingBottom: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.semibold,
    fontSize: 28,
    color: '#101418',
  },
  nameBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  displayName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 25,
    lineHeight: 31,
    color: COLORS.text,
    letterSpacing: 0,
  },
  handle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  profileMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: CARD_VERTICAL_GAP,
  },
  actionButton: {
    flex: 1,
    height: 42,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  actionButtonPrimary: {
    backgroundColor: 'rgba(122, 85, 255, 0.18)',
    borderColor: 'rgba(122, 85, 255, 0.42)',
  },
  actionButtonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  actionButtonMuted: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  actionButtonText: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: COLORS.text,
  },
  actionButtonTextMuted: {
    color: COLORS.textSecondary,
  },
  statStrip: {
    minHeight: 76,
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
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
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  card: {
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
  },
  cardInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    padding: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 13,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: FONTS.display.medium,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  sectionMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  levelBadge: {
    width: 56,
    height: 56,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.34)',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeImage: {
    width: 38,
    height: 38,
  },
  levelCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  levelTitle: {
    fontFamily: FONTS.display.medium,
    fontSize: 16,
    color: COLORS.text,
  },
  levelSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  progressTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 9,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2.5,
    backgroundColor: COLORS.primary,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  xpText: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  activityList: {
    marginTop: -1,
  },
  activityRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIcon: {
    width: 38,
    height: 38,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityIconImage: {
    width: 24,
    height: 24,
  },
  activityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  activityTitle: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13.5,
    color: COLORS.text,
  },
  activitySubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textSecondary,
  },
  activityMeta: {
    maxWidth: 104,
    textAlign: 'right',
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textTertiary,
  },
  emptyActivity: {
    minHeight: 56,
    justifyContent: 'center',
  },
  emptyActivityText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
