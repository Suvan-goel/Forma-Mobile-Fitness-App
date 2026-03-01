import React, { memo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  Platform,
  Image,
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
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useRewards, useUser } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { Reward } from '../../backend/services/api';
import type { RootStackParamList } from '../app/RootNavigator';

const iconMap: { [key: string]: LucideIcon } = {
  Zap, Target, Activity, Shield, Star, Flame, Trophy, Crown, Lock, CheckCircle,
};

const getIconComponent = (iconName: string): LucideIcon => iconMap[iconName] || Star;

/* ── Badge Card ──────────────────────────── */

const BadgeCard = memo(({ reward, userPoints, earnedBadgeIds }: { reward: Reward; userPoints: number; earnedBadgeIds: string[] }) => {
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
          <View style={[
            styles.iconCircle,
            isUnlocked && { backgroundColor: accent + '1A', borderWidth: 1, borderColor: accent + '44' },
          ]}>
            {isUnlocked ? (
              <Icon size={20} color={accent} strokeWidth={1.5} />
            ) : (
              <Lock size={20} color={COLORS.textTertiary} strokeWidth={1.5} />
            )}
          </View>

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

          {/* Earned indicator */}
          {isUnlocked && (
            <View style={[styles.earnedBadge, { backgroundColor: accent + '1A', borderColor: accent + '44' }]}>
              <CheckCircle size={10} color={accent} strokeWidth={2.5} />
              <Text style={[styles.earnedText, { color: accent }]}>EARNED</Text>
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
  const { user: profileUser } = useUser();
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

  const earnedBadgeIds = userStats?.earnedBadgeIds ?? [];
  const earnedBadges = rewards.filter(r => earnedBadgeIds.includes(r.id));
  const lockedBadges = rewards.filter(r => !earnedBadgeIds.includes(r.id));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── HEADER ─────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          style={styles.backButton}
        >
          <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>REWARDS</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.avatarButton}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.avatarPlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <Text style={styles.headerSubtitle}>EARN BADGES</Text>

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
              <BadgeCard key={reward.id} reward={reward} userPoints={userPoints} earnedBadgeIds={earnedBadgeIds} />
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
              <BadgeCard key={reward.id} reward={reward} userPoints={userPoints} earnedBadgeIds={earnedBadgeIds} />
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

  /* ── Header ────────────────────────────────── */
  header: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 5,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 46,
    flex: 1,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 3,
    marginTop: 0,
    marginBottom: 20,
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
    overflow: 'hidden',
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  cardLocked: {
    opacity: 0.55,
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
});
