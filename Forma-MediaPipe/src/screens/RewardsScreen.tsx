import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gift, Utensils, Dumbbell, ShoppingBag, Pill, Star, Lock, LucideIcon } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useRewards } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { Reward } from '../services/api';

// Icon resolver map for dynamic icon rendering
const iconMap: { [key: string]: LucideIcon } = {
  Gift,
  Utensils,
  Dumbbell,
  ShoppingBag,
  Pill,
  Star,
  Lock,
};

const getIconComponent = (iconName: string): LucideIcon => {
  return iconMap[iconName] || Gift;
};

const RewardCard = ({ reward, userPoints }: { reward: Reward; userPoints: number }) => {
  const isUnlocked = userPoints >= reward.pointsRequired;
  const progress = Math.min((userPoints / reward.pointsRequired) * 100, 100);
  const Icon = getIconComponent(reward.iconName);

  return (
    <TouchableOpacity 
      style={[styles.rewardCard, !isUnlocked && styles.rewardCardLocked]}
      activeOpacity={isUnlocked ? 0.7 : 1}
    >
      <View style={[styles.rewardIconContainer, { backgroundColor: isUnlocked ? reward.color : COLORS.cardBackgroundLight }]}>
        {isUnlocked ? (
          <Icon size={24} color={COLORS.text} />
        ) : (
          <Lock size={24} color={COLORS.textSecondary} />
        )}
      </View>
      <View style={styles.rewardInfo}>
        <Text style={[styles.rewardTitle, !isUnlocked && styles.rewardTitleLocked]}>{reward.title}</Text>
        <Text style={styles.rewardDescription}>{reward.description}</Text>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: COLORS.primary }]} />
          </View>
          <Text style={styles.pointsText}>{reward.pointsRequired} pts</Text>
        </View>
      </View>
      {isUnlocked && (
        <View style={[styles.redeemBadge, { backgroundColor: reward.color }]}>
          <Text style={styles.redeemText}>Redeem</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

export const RewardsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { onScroll } = useScroll();

  // Fetch rewards from API service
  const { rewards, userStats, userPoints, isLoading, error, refetch } = useRewards();

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSkeleton variant="card" height={160} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="text" width="40%" height={20} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={80} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={80} style={{ marginBottom: SPACING.sm }} />
          <LoadingSkeleton variant="card" height={80} />
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 200 }]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* Points Summary Card */}
        <View style={styles.pointsCard}>
          <View style={styles.pointsHeader}>
            <View style={styles.pointsIconContainer}>
              <Star size={28} color={COLORS.primary} fill={COLORS.primary} />
            </View>
            <View style={styles.pointsInfo}>
              <Text style={styles.pointsLabel}>Your Points</Text>
              <Text style={styles.pointsValue}>{userPoints}</Text>
            </View>
          </View>
          <View style={styles.pointsBreakdown}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Form</Text>
              <Text style={styles.breakdownValue}>+{userStats?.formScore || 0}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Consistency</Text>
              <Text style={styles.breakdownValue}>+{userStats?.consistencyScore || 0}</Text>
            </View>
          </View>
        </View>

        {/* Available Rewards */}
        <Text style={styles.sectionTitle}>Available Rewards</Text>
        {rewards
          .filter(r => userPoints >= r.pointsRequired)
          .map(reward => (
            <RewardCard key={reward.id} reward={reward} userPoints={userPoints} />
          ))}

        {/* Locked Rewards */}
        <Text style={styles.sectionTitle}>Keep Going!</Text>
        {rewards
          .filter(r => userPoints < r.pointsRequired)
          .map(reward => (
            <RewardCard key={reward.id} reward={reward} userPoints={userPoints} />
          ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xs,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xs,
  },
  pointsCard: {
    ...CARD_STYLE,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  pointsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: SPACING.lg,
  },
  pointsIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsInfo: {
    flex: 1,
  },
  pointsLabel: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  pointsValue: {
    fontSize: 36,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  pointsBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  breakdownItem: {
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  breakdownValue: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  breakdownDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
  },
  rewardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    ...CARD_STYLE,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    gap: 12,
  },
  rewardCardLocked: {
    opacity: 0.7,
  },
  rewardIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardInfo: {
    flex: 1,
  },
  rewardTitle: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  rewardTitleLocked: {
    color: COLORS.textSecondary,
  },
  rewardDescription: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  pointsText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  redeemBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  redeemText: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});

