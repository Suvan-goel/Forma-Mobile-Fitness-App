import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gift, Utensils, Dumbbell, ShoppingBag, Pill, Star, Lock } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';

// Mock user stats (would come from analytics in real app)
const userStats = {
  formScore: 87,
  consistencyScore: 79,
};

// Calculate points based on metrics
// Points are calculated as the sum of form and consistency scores
const calculatePoints = () => {
  const formPoints = userStats.formScore;
  const consistencyPoints = userStats.consistencyScore;
  return formPoints + consistencyPoints;
};

interface Reward {
  id: string;
  title: string;
  description: string;
  pointsRequired: number;
  icon: any;
  color: string;
  category: string;
}

const rewards: Reward[] = [
  {
    id: '1',
    title: 'Free Protein Shake',
    description: 'Redeem at any partner gym',
    pointsRequired: 200,
    icon: Pill,
    color: COLORS.primary,
    category: 'Supplements',
  },
  {
    id: '2',
    title: 'Healthy Meal Voucher',
    description: '$15 off at partner restaurants',
    pointsRequired: 350,
    icon: Utensils,
    color: '#F59E0B',
    category: 'Meals',
  },
  {
    id: '3',
    title: 'Gym Day Pass',
    description: 'Free day pass at partner gyms',
    pointsRequired: 500,
    icon: Dumbbell,
    color: COLORS.primary,
    category: 'Gym',
  },
  {
    id: '4',
    title: 'Resistance Bands Set',
    description: 'Premium exercise bands',
    pointsRequired: 750,
    icon: ShoppingBag,
    color: '#8B5CF6',
    category: 'Accessories',
  },
  {
    id: '5',
    title: 'Monthly Supplement Box',
    description: 'Curated supplements for your goals',
    pointsRequired: 1000,
    icon: Pill,
    color: '#EC4899',
    category: 'Supplements',
  },
  {
    id: '6',
    title: 'Weekly Meal Prep',
    description: '7 healthy meals delivered',
    pointsRequired: 1500,
    icon: Utensils,
    color: '#F59E0B',
    category: 'Meals',
  },
  {
    id: '7',
    title: 'Monthly Gym Membership',
    description: 'Full access to partner gyms',
    pointsRequired: 2500,
    icon: Dumbbell,
    color: COLORS.primary,
    category: 'Gym',
  },
  {
    id: '8',
    title: 'Premium Gym Bag',
    description: 'High-quality training bag',
    pointsRequired: 3000,
    icon: ShoppingBag,
    color: '#8B5CF6',
    category: 'Accessories',
  },
];

const RewardCard = ({ reward, userPoints }: { reward: Reward; userPoints: number }) => {
  const isUnlocked = userPoints >= reward.pointsRequired;
  const progress = Math.min((userPoints / reward.pointsRequired) * 100, 100);
  const Icon = reward.icon;

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
  const userPoints = calculatePoints();

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
              <Text style={styles.breakdownValue}>+{userStats.formScore}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Consistency</Text>
              <Text style={styles.breakdownValue}>+{userStats.consistencyScore}</Text>
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

