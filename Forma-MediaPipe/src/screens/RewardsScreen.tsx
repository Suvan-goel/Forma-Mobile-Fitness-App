import React, { memo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gift, Utensils, Dumbbell, ShoppingBag, Pill, Star, Lock, LucideIcon } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useRewards } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { Reward } from '../services/api';

const iconMap: { [key: string]: LucideIcon } = {
  Gift, Utensils, Dumbbell, ShoppingBag, Pill, Star, Lock,
};

const getIconComponent = (iconName: string): LucideIcon => iconMap[iconName] || Gift;

const CARD_COLORS: [string, string, string] = ['#1F1F1F', '#0F0F0F', '#0A0A0A'];
const GRAD_START = { x: 0, y: 0 };
const GRAD_END = { x: 1, y: 1 };
const PROGRESS_COLORS: [string, string] = ['#7C3AED', '#8B5CF6'];

/* ── Reward Card ──────────────────────────── */

const RewardCard = memo(({ reward, userPoints }: { reward: Reward; userPoints: number }) => {
  const isUnlocked = userPoints >= reward.pointsRequired;
  const progress = Math.min((userPoints / reward.pointsRequired) * 100, 100);
  const Icon = getIconComponent(reward.iconName);

  return (
    <TouchableOpacity
      activeOpacity={isUnlocked ? 0.82 : 1}
      style={styles.cardOuter}
    >
      <LinearGradient
        colors={CARD_COLORS}
        start={GRAD_START}
        end={GRAD_END}
        style={styles.cardGradient}
      >
        <View style={[styles.cardGlassEdge, !isUnlocked && styles.cardLocked]}>
          {/* Icon */}
          <View style={[styles.iconCircle, isUnlocked && styles.iconCircleActive]}>
            {isUnlocked ? (
              <Icon size={20} color="#8B5CF6" strokeWidth={1.5} />
            ) : (
              <Lock size={20} color="#52525B" strokeWidth={1.5} />
            )}
          </View>

          {/* Info */}
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, !isUnlocked && styles.cardTitleLocked]}>
              {reward.title}
            </Text>
            <Text style={styles.cardDesc}>{reward.description}</Text>

            {/* Progress bar */}
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                {progress > 0 && (
                  <LinearGradient
                    colors={PROGRESS_COLORS}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={[styles.progressFill, { width: `${progress}%` }]}
                  />
                )}
              </View>
              <Text style={styles.pointsLabel}>{reward.pointsRequired} pts</Text>
            </View>
          </View>

          {/* Redeem badge */}
          {isUnlocked && (
            <LinearGradient
              colors={PROGRESS_COLORS}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.redeemBadge}
            >
              <Text style={styles.redeemText}>REDEEM</Text>
            </LinearGradient>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

/* ── Main Screen ──────────────────────────── */

export const RewardsScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const { rewards, userStats, userPoints, isLoading, error, refetch } = useRewards();

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

  const unlockedRewards = rewards.filter(r => userPoints >= r.pointsRequired);
  const lockedRewards = rewards.filter(r => userPoints < r.pointsRequired);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* ── HERO SCORE ─────────────────────────── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroValue}>{userPoints}</Text>
          <Text style={styles.heroLabel}>AVAILABLE POINTS</Text>

          {/* Sub-stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>+{userStats?.formScore || 0}</Text>
              <Text style={styles.statLabel}>FORM</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>+{userStats?.consistencyScore || 0}</Text>
              <Text style={styles.statLabel}>CONSISTENCY</Text>
            </View>
          </View>
        </View>

        {/* ── UNLOCKED REWARDS ───────────────────── */}
        {unlockedRewards.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>UNLOCK REWARDS</Text>
            {unlockedRewards.map(reward => (
              <RewardCard key={reward.id} reward={reward} userPoints={userPoints} />
            ))}
          </>
        )}

        {/* ── LOCKED REWARDS ─────────────────────── */}
        {lockedRewards.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>KEEP GOING</Text>
            {lockedRewards.map(reward => (
              <RewardCard key={reward.id} reward={reward} userPoints={userPoints} />
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
    paddingTop: 4,
    paddingBottom: 150,
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
    color: '#8B5CF6',
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
    gap: 4,
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
  statDivider: {
    width: 1,
    height: 28,
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

  /* ── Reward Card ───────────────────────────── */
  cardOuter: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 15,
      },
      android: { elevation: 4 },
    }),
  },
  cardGradient: {
    borderRadius: 24,
  },
  cardGlassEdge: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  cardLocked: {
    opacity: 0.6,
  },

  /* ── Icon Circle ───────────────────────────── */
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },

  /* ── Card Info ─────────────────────────────── */
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  cardTitleLocked: {
    color: '#A1A1AA',
  },
  cardDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#52525B',
    marginTop: 2,
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
    color: '#52525B',
    letterSpacing: 0.5,
  },

  /* ── Redeem Badge ──────────────────────────── */
  redeemBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  redeemText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
});
