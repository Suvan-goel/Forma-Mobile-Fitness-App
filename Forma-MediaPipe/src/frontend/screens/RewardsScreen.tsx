import React, { memo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Zap,
  Target,
  Activity,
  Shield,
  Star,
  Flame,
  Trophy,
  Crown,
  Lock,
  CheckCircle,
  ChevronLeft,
  LucideIcon,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END ,
  CARD_SHADOW
} from '../constants/theme';
import { useRewards, useUser } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { useAlert } from '../contexts/AlertContext';
import { Reward } from '../../backend/services/api';
import type { RootStackParamList } from '../app/RootNavigator';

const iconMap: { [key: string]: LucideIcon } = {
  Zap, Target, Activity, Shield, Star, Flame, Trophy, Crown, Lock, CheckCircle,
};

const getIconComponent = (iconName: string): LucideIcon => iconMap[iconName] || Star;

/* ── Badge Card ──────────────────────────── */

interface BadgeCardProps {
  reward: Reward;
  userPoints: number;
  earnedBadgeIds: string[];
  isRedeemed: boolean;
  isRedeeming: boolean;
  onRedeem?: () => void;
}

const BadgeCard = memo(({ reward, userPoints, earnedBadgeIds, isRedeemed, isRedeeming, onRedeem }: BadgeCardProps) => {
  const isUnlocked = earnedBadgeIds.includes(reward.id);
  const progress = Math.min((userPoints / reward.pointsRequired) * 100, 100);
  const Icon = getIconComponent(reward.iconName);
  const accent = reward.color;

  return (
    <TouchableOpacity
      activeOpacity={isUnlocked ? 0.82 : 1}
      style={styles.cardOuter}
    >
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={[styles.cardGlassEdge, !isUnlocked && styles.cardLocked]}>
          {/* Icon */}
          {isUnlocked ? (
            <Icon size={20} color={accent} strokeWidth={1.5} />
          ) : (
            <Lock size={20} color={COLORS.textTertiary} strokeWidth={1.5} />
          )}

          {/* Info */}
          <View style={styles.cardInfo}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, !isUnlocked && styles.cardTitleLocked]}>
                {reward.title}
              </Text>
              <View style={[styles.tierPill, { backgroundColor: accent + '1A' }]}>
                <Text style={[styles.tierText, { color: accent }]}>{reward.category.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{reward.description}</Text>

            {/* Progress bar */}
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                {progress > 0 && (
                  <LinearGradient
                    colors={[accent + 'BB', accent] as [string, string]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={[styles.progressFill, { width: `${progress}%` }]}
                  />
                )}
              </View>
              <Text style={styles.pointsLabel}>{reward.pointsRequired} pts</Text>
            </View>
          </View>

          {/* Status indicator */}
          {isUnlocked && (
            <View style={styles.statusColumn}>
              {isRedeemed ? (
                <View style={[styles.earnedBadge, { backgroundColor: accent + '1A', borderColor: accent + '44' }]}>
                  <CheckCircle size={10} color={accent} strokeWidth={2.5} />
                  <Text style={[styles.earnedText, { color: accent }]}>REDEEMED</Text>
                </View>
              ) : (
                <>
                  <View style={[styles.earnedBadge, { backgroundColor: accent + '1A', borderColor: accent + '44' }]}>
                    <CheckCircle size={10} color={accent} strokeWidth={2.5} />
                    <Text style={[styles.earnedText, { color: accent }]}>EARNED</Text>
                  </View>
                  <TouchableOpacity
                    onPress={onRedeem}
                    disabled={isRedeeming}
                    activeOpacity={0.7}
                    style={[styles.redeemBtn, { backgroundColor: accent }]}
                  >
                    {isRedeeming ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.redeemBtnText}>Redeem</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

/* ── Main Screen ──────────────────────────── */

export const RewardsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { user: profileUser } = useUser();
  const { rewards, userStats, userPoints, redeemedBadgeIds, isLoading, error, refetch, redeemReward } = useRewards();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const handleRedeem = useCallback(async (rewardId: string) => {
    setRedeemingId(rewardId);
    const result = await redeemReward(rewardId);
    setRedeemingId(null);
    if (result.success) {
      showAlert('Badge Redeemed', result.message, [{ text: 'OK' }]);
    } else {
      showAlert('Redeem Failed', result.message, [{ text: 'OK' }]);
    }
  }, [redeemReward, showAlert]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={160} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="text" width="40%" height={20} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={80} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={80} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={80} />
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

  const earnedBadgeIds = userStats?.earnedBadgeIds ?? [];
  const earnedBadges = rewards.filter(r => earnedBadgeIds.includes(r.id));
  const lockedBadges = rewards.filter(r => !earnedBadgeIds.includes(r.id));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── HEADER (Social-style) ────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
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
            <Text style={styles.headerName}>REWARDS</Text>
            <Text style={styles.headerSubtitle}>EARN BADGES</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.profileBtn}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.profileImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#7C5CFF', '#6746E8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <Text style={styles.profileInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.profilePlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        {/* ── HERO SCORE ─────────────────────────── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroValue}>{userPoints}</Text>
          <Text style={styles.heroLabel}>TOTAL POINTS</Text>

          {/* Sub-stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>+{userStats?.formScore || 0}</Text>
              <Text style={styles.statLabel}>FORM</Text>
              <Text style={styles.statHint}>quality · 25 max/session</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>+{userStats?.consistencyScore || 0}</Text>
              <Text style={styles.statLabel}>CONSISTENCY</Text>
              <Text style={styles.statHint}>weekly target · 35 max/week</Text>
            </View>
          </View>
        </View>

        {/* ── EARNED BADGES ──────────────────────── */}
        {earnedBadges.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>EARNED BADGES</Text>
            {earnedBadges.map(reward => (
              <BadgeCard
                key={reward.id}
                reward={reward}
                userPoints={userPoints}
                earnedBadgeIds={earnedBadgeIds}
                isRedeemed={redeemedBadgeIds.includes(reward.id)}
                isRedeeming={redeemingId === reward.id}
                onRedeem={() => handleRedeem(reward.id)}
              />
            ))}
          </>
        )}

        {/* ── LOCKED BADGES ──────────────────────── */}
        {lockedBadges.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              {earnedBadges.length > 0 ? 'LOCKED BADGES' : 'BADGES'}
            </Text>
            {lockedBadges.map(reward => (
              <BadgeCard
                key={reward.id}
                reward={reward}
                userPoints={userPoints}
                earnedBadgeIds={earnedBadgeIds}
                isRedeemed={false}
                isRedeeming={false}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
    paddingTop: 0,
    paddingBottom: 150,
  },

  /* ── Header (Social-style) ───────────────────── */
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
    gap: 6,
  },
  backBtn: {
    width: 24,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
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
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
  },
  profileInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },

  /* ── Hero Score ────────────────────────────── */
  heroSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 28,
  },
  heroValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 80,
    color: '#7C5CFF',
    letterSpacing: -2,
    lineHeight: 88,
    ...Platform.select({
      ios: {
        textShadowColor: 'rgba(139, 92, 246, 0.5)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 24,
      },
      android: {},
    }),
  },
  heroLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 3,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 20,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: '#52525B',
    letterSpacing: 2,
  },
  statHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: '#3F3F46',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* ── Section Title ─────────────────────────── */
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 14,
  },

  /* ── Badge Card ───────────────────────────── */
  cardOuter: {
    borderRadius: 19,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#7C5CFF',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  cardLocked: {
    opacity: 0.55,
  },


  /* ── Card Info ─────────────────────────────── */
  cardInfo: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  cardTitleLocked: {
    color: COLORS.textSecondary,
  },
  tierPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tierText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 8,
    letterSpacing: 1,
  },
  cardDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 3,
  },

  /* ── Progress Bar ──────────────────────────── */
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
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
  pointsLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },

  /* ── Earned Badge ──────────────────────────── */
  earnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  earnedText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    letterSpacing: 1,
  },

  /* ── Redeem Button ──────────────────────────── */
  statusColumn: {
    alignItems: 'center',
    gap: 8,
  },
  redeemBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  redeemBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
