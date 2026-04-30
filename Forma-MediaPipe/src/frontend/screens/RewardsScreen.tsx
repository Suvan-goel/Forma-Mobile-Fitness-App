import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Activity,
  Award,
  CheckCircle,
  ChevronRight,
  Crown,
  Flame,
  Lock,
  LucideIcon,
  Shield,
  Star,
  Target,
  Trophy,
  Zap,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_END,
  CARD_GRADIENT_START,
  COLORS,
  FONTS,
  SPACING,
} from '../constants/theme';
import { useRewards } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState, SettingsHeader } from '../components/ui';
import { useAlert } from '../contexts/AlertContext';
import { Reward } from '../../backend/services/api';
import type { RootStackParamList } from '../app/RootNavigator';

const iconMap: Record<string, LucideIcon> = {
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
};

const getIconComponent = (iconName: string): LucideIcon => iconMap[iconName] || Star;

interface BadgeCardProps {
  reward: Reward;
  userPoints: number;
  isUnlocked: boolean;
  isRedeemed: boolean;
  isRedeeming: boolean;
  onRedeem?: () => void;
}

const BadgeCard = memo(({
  reward,
  userPoints,
  isUnlocked,
  isRedeemed,
  isRedeeming,
  onRedeem,
}: BadgeCardProps) => {
  const progress = reward.pointsRequired > 0
    ? Math.min((userPoints / reward.pointsRequired) * 100, 100)
    : 100;
  const remaining = Math.max(0, reward.pointsRequired - userPoints);
  const Icon = getIconComponent(reward.iconName);
  const accent = reward.color;

  return (
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.badgeCard}
    >
      <View style={[styles.badgeCardInner, !isUnlocked && styles.badgeCardLocked]}>
        <View style={[styles.badgeIconWrap, { borderColor: isUnlocked ? `${accent}55` : 'rgba(255,255,255,0.07)' }]}>
          <LinearGradient
            colors={isUnlocked ? [`${accent}33`, 'rgba(255,255,255,0.025)'] : ['rgba(255,255,255,0.045)', 'rgba(255,255,255,0.02)']}
            style={styles.badgeIconGradient}
          >
            {isUnlocked ? (
              <Icon size={21} color={accent} strokeWidth={1.8} />
            ) : (
              <Lock size={20} color={COLORS.textTertiary} strokeWidth={1.8} />
            )}
          </LinearGradient>
        </View>

        <View style={styles.badgeContent}>
          <View style={styles.badgeTopRow}>
            <Text style={[styles.badgeTitle, !isUnlocked && styles.badgeTitleLocked]} numberOfLines={1}>
              {reward.title}
            </Text>
            <View style={[styles.categoryPill, { backgroundColor: `${accent}1F`, borderColor: `${accent}33` }]}>
              <Text style={[styles.categoryText, { color: isUnlocked ? accent : COLORS.textTertiary }]}>
                {reward.category}
              </Text>
            </View>
          </View>

          <Text style={styles.badgeDescription} numberOfLines={2}>
            {reward.description}
          </Text>

          <View style={styles.progressMetaRow}>
            <Text style={styles.progressMeta}>
              {isUnlocked ? 'Unlocked' : `${remaining.toLocaleString()} pts to unlock`}
            </Text>
            <Text style={styles.progressMeta}>{reward.pointsRequired.toLocaleString()} pts</Text>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(4, progress)}%`,
                  backgroundColor: isUnlocked ? accent : COLORS.primary,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.badgeAction}>
          {isUnlocked ? (
            isRedeemed ? (
              <View style={[styles.statusPill, { borderColor: `${accent}44`, backgroundColor: `${accent}1A` }]}>
                <CheckCircle size={12} color={accent} strokeWidth={2.4} />
              </View>
            ) : (
              <TouchableOpacity
                onPress={onRedeem}
                disabled={isRedeeming}
                activeOpacity={0.75}
                style={[styles.redeemButton, { backgroundColor: accent }]}
              >
                {isRedeeming ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.redeemText}>Redeem</Text>
                )}
              </TouchableOpacity>
            )
          ) : (
            <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.7} />
          )}
        </View>
      </View>
    </LinearGradient>
  );
});

export const RewardsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { rewards, userStats, userPoints, redeemedBadgeIds, isLoading, error, refetch, redeemReward } = useRewards();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const earnedBadgeIds = userStats?.earnedBadgeIds ?? [];

  const sortedRewards = useMemo(
    () => [...rewards].sort((a, b) => a.pointsRequired - b.pointsRequired),
    [rewards],
  );
  const nextReward = sortedRewards.find(reward => !earnedBadgeIds.includes(reward.id));
  const earnedBadges = sortedRewards.filter(reward => earnedBadgeIds.includes(reward.id));
  const lockedBadges = sortedRewards.filter(reward => !earnedBadgeIds.includes(reward.id));
  const nextProgress = nextReward
    ? Math.min((userPoints / nextReward.pointsRequired) * 100, 100)
    : 100;

  const handleRedeem = useCallback(async (rewardId: string) => {
    setRedeemingId(rewardId);
    const result = await redeemReward(rewardId);
    setRedeemingId(null);
    showAlert(result.success ? 'Badge Redeemed' : 'Redeem Failed', result.message, [{ text: 'OK' }]);
  }, [redeemReward, showAlert]);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SettingsHeader title="REWARDS" onBack={() => navigation.goBack()} />
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={150} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={84} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={84} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={84} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SettingsHeader title="REWARDS" onBack={() => navigation.goBack()} />
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="REWARDS" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[...CARD_GRADIENT_ELEVATED]}
          start={CARD_GRADIENT_START}
          end={CARD_GRADIENT_END}
          style={styles.heroCard}
        >
          <View style={styles.heroCardInner}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.heroLabel}>TOTAL POINTS</Text>
                <Text style={styles.heroValue}>{userPoints.toLocaleString()}</Text>
              </View>
              <View style={styles.heroBadge}>
                <Award size={22} color={COLORS.primary} strokeWidth={1.8} />
              </View>
            </View>

            <View style={styles.statStrip}>
              <SummaryStat value={`+${userStats?.formScore ?? 0}`} label="Form" />
              <View style={styles.statDivider} />
              <SummaryStat value={`+${userStats?.consistencyScore ?? 0}`} label="Consistency" />
              <View style={styles.statDivider} />
              <SummaryStat value={`${earnedBadges.length}/${sortedRewards.length}`} label="Badges" />
            </View>

            <View style={styles.nextRewardBlock}>
              <View style={styles.nextRewardHeader}>
                <Text style={styles.nextRewardLabel}>Next Reward</Text>
                <Text style={styles.nextRewardTitle}>
                  {nextReward ? nextReward.title : 'All badges unlocked'}
                </Text>
              </View>
              <View style={styles.heroProgressTrack}>
                <View style={[styles.heroProgressFill, { width: `${Math.max(6, nextProgress)}%` }]} />
              </View>
              <Text style={styles.nextRewardMeta}>
                {nextReward
                  ? `${Math.max(0, nextReward.pointsRequired - userPoints).toLocaleString()} points remaining`
                  : 'You have completed the current rewards track.'}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {earnedBadges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Earned Badges</Text>
            {earnedBadges.map(reward => (
              <BadgeCard
                key={reward.id}
                reward={reward}
                userPoints={userPoints}
                isUnlocked
                isRedeemed={redeemedBadgeIds.includes(reward.id)}
                isRedeeming={redeemingId === reward.id}
                onRedeem={() => handleRedeem(reward.id)}
              />
            ))}
          </View>
        )}

        {lockedBadges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {earnedBadges.length > 0 ? 'Locked Badges' : 'Badge Track'}
            </Text>
            {lockedBadges.map(reward => (
              <BadgeCard
                key={reward.id}
                reward={reward}
                userPoints={userPoints}
                isUnlocked={false}
                isRedeemed={false}
                isRedeeming={false}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const SummaryStat = ({ value, label }: { value: string; label: string }) => (
  <View style={styles.summaryStat}>
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </View>
);

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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
  },
  heroCard: {
    borderRadius: 14,
    marginBottom: 18,
  },
  heroCardInner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1.6,
  },
  heroValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 42,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  heroBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,85,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122,85,255,0.20)',
  },
  statStrip: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  summaryValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 17,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  nextRewardBlock: {
    gap: 8,
  },
  nextRewardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  nextRewardLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  nextRewardTitle: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
  },
  heroProgressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  nextRewardMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
    marginBottom: 10,
  },
  badgeCard: {
    borderRadius: 12,
    marginBottom: 10,
  },
  badgeCardInner: {
    minHeight: 94,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  badgeCardLocked: {
    opacity: 0.72,
  },
  badgeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    padding: 1,
  },
  badgeIconGradient: {
    flex: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeContent: {
    flex: 1,
    minWidth: 0,
  },
  badgeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  badgeTitle: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
  },
  badgeTitleLocked: {
    color: COLORS.textSecondary,
  },
  categoryPill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  categoryText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
  },
  badgeDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textTertiary,
  },
  progressMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  progressMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 5,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  badgeAction: {
    width: 66,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statusPill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemButton: {
    minWidth: 66,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  redeemText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: '#FFFFFF',
  },
});
