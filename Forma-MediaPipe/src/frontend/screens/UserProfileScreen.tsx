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
  Award,
  Check,
  ChevronLeft,
  Flame,
  Medal,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trophy,
  Video,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useUser, useWorkouts, useAnalytics, useRewards } from '../../backend/hooks';
import type { RootStackParamList } from '../app/RootNavigator';

type UserProfileNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const XP_PER_LEVEL = 220;
const LEVEL_TARGET = 3000;

export const UserProfileScreen: React.FC = () => {
  const navigation = useNavigation<UserProfileNavigationProp>();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  const { user } = useUser();
  const { workouts } = useWorkouts();
  const { analytics } = useAnalytics('1 week', 4);
  const { rewards, userPoints, userStats } = useRewards();

  const workoutCount = workouts.length;
  const streakDays = analytics?.summary.streakDays ?? 0;
  const formValues = analytics?.formData.values ?? [];
  const avgFormScore = formValues.length > 0
    ? Math.round(formValues.reduce((a, b) => a + b, 0) / formValues.length)
    : 0;
  const displayName = user?.displayName || 'Forma Athlete';
  const handle = `@${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'forma'}`;
  const initial = displayName.charAt(0).toUpperCase();
  const level = Math.max(1, Math.floor(userPoints / XP_PER_LEVEL) + 1);
  const levelProgress = Math.min(userPoints / LEVEL_TARGET, 1);
  const earnedBadgeIds = userStats?.earnedBadgeIds ?? [];
  const earnedRewards = rewards.filter(reward => earnedBadgeIds.includes(reward.id));
  const hiddenBadgeCount = Math.max(0, earnedBadgeIds.length - 4);

  const achievements = useMemo(() => {
    const recentBadges = earnedRewards.slice(0, 2).map(reward => ({
      id: reward.id,
      title: reward.title,
      subtitle: reward.description,
      meta: `${reward.category} badge`,
      icon: 'badge' as const,
    }));

    return [
      ...(streakDays > 0 ? [{
        id: 'streak',
        title: 'Form Streak',
        subtitle: `${streakDays} ${streakDays === 1 ? 'day' : 'days'} in a row`,
        meta: 'Active now',
        icon: 'check' as const,
      }] : []),
      ...recentBadges,
      {
        id: 'score',
        title: 'Form Focus',
        subtitle: avgFormScore > 0 ? `${avgFormScore} average form score` : 'Keep training to unlock',
        meta: 'Weekly performance',
        icon: 'target' as const,
      },
    ].slice(0, 3);
  }, [avgFormScore, earnedRewards, streakDays]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleGoBack = useCallback(() => navigation.navigate('MainTabs', { screen: 'Home' }), [navigation]);
  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleRewards = useCallback(() => navigation.navigate('Rewards'), [navigation]);
  const handleVideoLibrary = useCallback(() => navigation.navigate('VideoLibrary'), [navigation]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleGoBack} activeOpacity={0.7} style={styles.headerIcon}>
          <ChevronLeft size={26} color={COLORS.textSecondary} strokeWidth={1.7} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSettings} activeOpacity={0.7} style={styles.headerIcon}>
          <Settings size={22} color={COLORS.textSecondary} strokeWidth={1.7} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 96 }]}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.profileRow}>
            <View style={styles.avatarRing}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
              ) : (
                <LinearGradient colors={['#F3F4F6', '#B8BCC5']} style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </LinearGradient>
              )}
            </View>

            <View style={styles.nameBlock}>
              <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.handle} numberOfLines={1}>{handle}</Text>
              <TouchableOpacity activeOpacity={0.75} onPress={() => navigation.navigate('Membership')}>
                <LinearGradient colors={['#8D67FF', '#5A38D6']} style={styles.proPill}>
                  <Shield size={12} color="#FFFFFF" fill="rgba(255,255,255,0.2)" />
                  <Text style={styles.proText}>Pro Member</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.statStrip}>
            <StatBlock value={workoutCount || 0} label="Total Workouts" />
            <View style={styles.statDivider} />
            <StatBlock value={streakDays || 0} label="Week Streak" prefix={<Flame size={13} color={COLORS.yellow} fill={COLORS.yellow} />} />
            <View style={styles.statDivider} />
            <StatBlock value={avgFormScore || 0} label="Avg Form Score" />
          </View>

          <View style={styles.actionGrid}>
            <ProfileActionButton
              label="Rewards"
              icon={<Trophy size={17} color={COLORS.yellow} strokeWidth={1.8} />}
              onPress={handleRewards}
            />
            <ProfileActionButton
              label="Video Library"
              icon={<Video size={17} color={COLORS.primary} strokeWidth={1.8} />}
              onPress={handleVideoLibrary}
            />
          </View>

          <ProfileCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Level & Rewards</Text>
              <TouchableOpacity onPress={handleRewards} activeOpacity={0.75}>
                <Text style={styles.viewAll}>View all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.levelRow}>
              <LinearGradient colors={['#8F6BFF', '#442087']} style={styles.levelBadge}>
                <Shield size={48} color="rgba(255,255,255,0.62)" strokeWidth={1.5} />
                <Text style={styles.levelNumber}>{level}</Text>
              </LinearGradient>
              <View style={styles.levelCopy}>
                <Text style={styles.levelTitle}>Level {level}</Text>
                <Text style={styles.levelSubtitle}>Strong Performer</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(8, levelProgress * 100)}%` }]} />
            </View>
            <Text style={styles.xpText}>{userPoints.toLocaleString()} / {LEVEL_TARGET.toLocaleString()} XP</Text>
          </ProfileCard>

          <ProfileCard>
            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={styles.badgeRow}>
              {(earnedRewards.length > 0 ? earnedRewards : rewards.slice(0, 4)).slice(0, 4).map((reward, index) => (
                <View key={reward.id || index} style={styles.badgeShell}>
                  <LinearGradient
                    colors={earnedBadgeIds.includes(reward.id) ? ['#3C4651', '#1A222C'] : ['#272D34', '#161A1F']}
                    style={styles.badgeHex}
                  >
                    {index % 4 === 0 ? <Trophy size={20} color={COLORS.yellow} /> : null}
                    {index % 4 === 1 ? <Medal size={20} color={COLORS.yellow} /> : null}
                    {index % 4 === 2 ? <Award size={20} color={COLORS.yellow} /> : null}
                    {index % 4 === 3 ? <Target size={20} color={COLORS.yellow} /> : null}
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
                <View key={item.id} style={[styles.achievementRow, index === achievements.length - 1 && styles.achievementRowLast]}>
                  <LinearGradient
                    colors={item.icon === 'check' ? ['#62E5A9', '#269A67'] : ['#8D67FF', '#4A2BB4']}
                    style={styles.achievementIcon}
                  >
                    {item.icon === 'check' ? <Check size={20} color="#FFFFFF" strokeWidth={2.5} /> : null}
                    {item.icon === 'badge' ? <Sparkles size={19} color="#FFFFFF" strokeWidth={2.1} /> : null}
                    {item.icon === 'target' ? <Target size={19} color="#FFFFFF" strokeWidth={2.1} /> : null}
                  </LinearGradient>
                  <View style={styles.achievementText}>
                    <Text style={styles.achievementTitle}>{item.title}</Text>
                    <Text style={styles.achievementSubtitle}>{item.subtitle}</Text>
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
};

const StatBlock = ({ value, label, prefix }: { value: number; label: string; prefix?: React.ReactNode }) => (
  <View style={styles.statBlock}>
    <View style={styles.statValueRow}>
      {prefix}
      <Text style={styles.statValue}>{value}</Text>
    </View>
    <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
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

const ProfileActionButton = ({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.actionButton} activeOpacity={0.8} onPress={onPress}>
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.actionButtonGradient}
    >
      <View style={styles.actionButtonInner}>
        <View style={styles.actionButtonIcon}>{icon}</View>
        <Text style={styles.actionButtonText} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
  proPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 3,
  },
  proText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
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
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonGradient: {
    borderRadius: 12,
  },
  actionButtonInner: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  actionButtonIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  actionButtonText: {
    flexShrink: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
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
