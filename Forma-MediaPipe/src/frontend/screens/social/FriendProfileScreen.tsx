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
  Award,
  Check,
  ChevronLeft,
  Flame,
  GitCompare,
  Medal,
  Shield,
  Sparkles,
  Target,
  Trophy,
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
} from '../../constants/theme';
import { useFollowing } from '../../../backend/hooks/useFollowing';
import { useFriendProfile } from '../../../backend/hooks/useFriendProfile';

const XP_PER_LEVEL = 220;
const LEVEL_TARGET = 3000;

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
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerIcon}
            activeOpacity={0.7}
          >
            <ChevronLeft
              size={26}
              color={COLORS.textSecondary}
              strokeWidth={1.7}
            />
          </TouchableOpacity>
          <View style={styles.headerIcon} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </View>
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
  const hiddenBadgeCount = Math.max(0, profile.earnedBadgeIds.length - 4);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerIcon}
          activeOpacity={0.7}
        >
          <ChevronLeft
            size={26}
            color={COLORS.textSecondary}
            strokeWidth={1.7}
          />
        </TouchableOpacity>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 96 },
        ]}
      >
        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          <View style={styles.profileRow}>
            <View style={styles.avatarRing}>
              {profile.avatarUrl ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
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
              <View style={styles.actionRow}>
                <TouchableOpacity activeOpacity={0.75} onPress={handleFollow}>
                  <LinearGradient
                    colors={
                      isCurrentlyFollowing
                        ? ['#252B31', '#171B20']
                        : ['#8D67FF', '#5A38D6']
                    }
                    style={styles.actionPill}
                  >
                    {isCurrentlyFollowing ? (
                      <UserMinus size={12} color={COLORS.textSecondary} />
                    ) : (
                      <UserPlus size={12} color="#FFFFFF" />
                    )}
                    <Text
                      style={[
                        styles.actionText,
                        isCurrentlyFollowing && styles.actionTextMuted,
                      ]}
                    >
                      {isCurrentlyFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.78}
            onPress={handleCompare}
            style={styles.compareCtaOuter}
          >
            <LinearGradient
              colors={['#8D67FF', '#5A38D6']}
              style={styles.compareCta}
            >
              <GitCompare size={17} color="#FFFFFF" strokeWidth={1.8} />
              <Text style={styles.compareCtaText}>Compare</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.statStrip}>
            <StatBlock
              value={profile.totalWorkouts || 0}
              label="Total Workouts"
            />
            <View style={styles.statDivider} />
            <StatBlock
              value={profile.streakDays || 0}
              label="Week Streak"
              prefix={
                <Flame size={13} color={COLORS.yellow} fill={COLORS.yellow} />
              }
            />
            <View style={styles.statDivider} />
            <StatBlock
              value={Math.round(profile.avgFormScore) || 0}
              label="Avg Form Score"
            />
          </View>

          <ProfileCard>
            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Level & Rewards
            </Text>
            <View style={styles.levelRow}>
              <LinearGradient
                colors={['#8F6BFF', '#442087']}
                style={styles.levelBadge}
              >
                <Shield
                  size={48}
                  color="rgba(255,255,255,0.62)"
                  strokeWidth={1.5}
                />
                <Text style={styles.levelNumber}>{level}</Text>
              </LinearGradient>
              <View style={styles.levelCopy}>
                <Text style={styles.levelTitle}>Level {level}</Text>
                <Text style={styles.levelSubtitle}>Strong Performer</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(8, levelProgress * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.xpText}>
              {estimatedXp.toLocaleString()} / {LEVEL_TARGET.toLocaleString()}{' '}
              XP
            </Text>

            <View style={styles.combinedCardDivider} />

            <View style={styles.badgeSectionHeader}>
              <Text style={styles.sectionTitle}>Badges</Text>
              <Text style={styles.badgeCountText}>{profile.earnedBadgeIds.length} earned</Text>
            </View>
            <View style={styles.badgeRow}>
              {(profile.earnedBadgeIds.length > 0
                ? profile.earnedBadgeIds
                : ['1', '2', '3', '4']
              )
                .slice(0, 4)
                .map((badgeId, index) => (
                  <View key={badgeId} style={styles.badgeShell}>
                    <LinearGradient
                      colors={
                        profile.earnedBadgeIds.includes(badgeId)
                          ? ['#3C4651', '#1A222C']
                          : ['#272D34', '#161A1F']
                      }
                      style={styles.badgeHex}
                    >
                      {index % 4 === 0 ? (
                        <Trophy size={20} color={COLORS.yellow} />
                      ) : null}
                      {index % 4 === 1 ? (
                        <Medal size={20} color={COLORS.yellow} />
                      ) : null}
                      {index % 4 === 2 ? (
                        <Award size={20} color={COLORS.yellow} />
                      ) : null}
                      {index % 4 === 3 ? (
                        <Target size={20} color={COLORS.yellow} />
                      ) : null}
                    </LinearGradient>
                  </View>
                ))}
              {hiddenBadgeCount > 0 && (
                <View style={styles.moreBadge}>
                  <Text style={styles.moreBadgeText}>+{hiddenBadgeCount}</Text>
                </View>
              )}
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
    </View>
  );
});

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
  header: {
    height: 50,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIcon: {
    width: 38,
    height: 38,
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
    paddingBottom: 12,
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  actionText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.text,
  },
  actionTextMuted: {
    color: COLORS.textSecondary,
  },
  compareCtaOuter: {
    marginBottom: 14,
  },
  compareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
  },
  compareCtaText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
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
    marginBottom: 14,
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
  card: {
    borderRadius: 12,
    marginBottom: 14,
  },
  cardInner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    padding: 14,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  sectionTitleSpaced: {
    marginBottom: 12,
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
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  combinedCardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 15,
    marginBottom: 13,
  },
  badgeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeCountText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  badgeShell: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    padding: 3,
  },
  badgeHex: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  moreBadgeText: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.textSecondary,
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
