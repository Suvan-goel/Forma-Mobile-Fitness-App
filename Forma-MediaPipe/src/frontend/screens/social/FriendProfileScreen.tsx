/**
 * FriendProfileScreen — View a friend's public profile
 * Redesigned to match HomeScreen card / gradient style
 */

import React, { memo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ChevronLeft,
  GitCompare,
  Award,
  Calendar,
  Flame,
  Dumbbell,
  Trophy,
  ChevronRight,
  Target,
} from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../../constants/theme';
import { useFriendProfile } from '../../../backend/hooks';

export const FriendProfileScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId } = route.params;
  const { profile, isLoading } = useFriendProfile(userId);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (profile) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [profile, fadeAnim, slideAnim]);

  const handleCompare = useCallback(() => {
    navigation.navigate('FriendComparison', { friendId: userId });
  }, [navigation, userId]);

  if (isLoading || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </View>
    );
  }

  const scoreColor = getScoreColor(profile.avgFormScore);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              PROFILE HERO CARD
              ═══════════════════════════════════════════ */}
          <LinearGradient
            colors={['#1E1A2E', '#151020', '#0C0A14']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroEdge}>
              {/* Avatar + Name */}
              <View style={styles.profileRow}>
                <View style={[
                  styles.avatarOuter,
                  Platform.OS === 'ios' && {
                    shadowColor: '#8B5CF6',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.25,
                    shadowRadius: 12,
                  },
                ]}>
                  <LinearGradient
                    colors={['rgba(139, 92, 246, 0.30)', 'rgba(139, 92, 246, 0.10)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.avatar}
                  >
                    <Text style={styles.avatarText}>
                      {profile.displayName.charAt(0).toUpperCase()}
                    </Text>
                  </LinearGradient>
                </View>
                <View style={styles.nameWrap}>
                  <Text style={styles.displayName}>{profile.displayName}</Text>
                  <Text style={styles.memberSince}>
                    Member since {profile.memberSince.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Text>
                </View>
              </View>

              {/* Form Score */}
              <View style={styles.heroScoreSection}>
                <View style={styles.heroLabelRow}>
                  <Target size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.heroLabel}>AVG FORM SCORE</Text>
                </View>
                <View style={styles.heroScoreRow}>
                  <Text style={[styles.heroScore, { color: scoreColor }]}>
                    {profile.avgFormScore.toFixed(1)}
                  </Text>
                  <Text style={styles.heroScoreUnit}>/100</Text>
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              STATS ROW: BENTO GRID
              ═══════════════════════════════════════════ */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <View style={[styles.statIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.statValue}>{profile.totalWorkouts}</Text>
                  <Text style={styles.statLabel}>workouts</Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <View style={[styles.statIconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                      <Flame size={14} color={COLORS.yellow} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.statValue}>
                    {profile.streakDays > 0 ? profile.streakDays : '—'}
                  </Text>
                  <Text style={styles.statLabel}>
                    {profile.streakDays === 1 ? 'day streak' : profile.streakDays > 0 ? 'day streak' : 'no streak'}
                  </Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* ═══════════════════════════════════════════
              COMPARE CTA — Accent gradient button
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleCompare}
          >
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <View style={styles.ctaInner}>
                <View style={styles.ctaIconWrap}>
                  <GitCompare size={16} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View style={styles.ctaTextWrap}>
                  <Text style={styles.ctaTitle}>Compare Stats</Text>
                  <Text style={styles.ctaSub}>See how you stack up</Text>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              BADGES
              ═══════════════════════════════════════════ */}
          {profile.earnedBadgeIds.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>BADGES</Text>
                </View>
              </View>

              <LinearGradient
                colors={['#1A1510', '#111008', '#0E0C07']}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.badgeCard}
              >
                <View style={styles.badgeEdge}>
                  <View style={styles.badgeRow}>
                    {profile.earnedBadgeIds.map(badgeId => (
                      <View key={badgeId} style={styles.badge}>
                        <Award size={18} color={COLORS.yellow} />
                      </View>
                    ))}
                  </View>
                  <Text style={styles.badgeCount}>
                    {profile.earnedBadgeIds.length} {profile.earnedBadgeIds.length === 1 ? 'badge' : 'badges'} earned
                  </Text>
                </View>
              </LinearGradient>
            </>
          )}

          {/* ═══════════════════════════════════════════
              RECENT WORKOUTS
              ═══════════════════════════════════════════ */}
          {profile.recentWorkouts.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Calendar size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>RECENT WORKOUTS</Text>
                </View>
              </View>

              {profile.recentWorkouts.map((workout) => (
                <View key={workout.id} style={styles.workoutOuter}>
                  <LinearGradient
                    colors={[...CARD_GRADIENT_COLORS]}
                    start={CARD_GRADIENT_START}
                    end={CARD_GRADIENT_END}
                    style={styles.workoutGradient}
                  >
                    <View style={styles.workoutEdge}>
                      <View style={styles.workoutTopRow}>
                        <View style={styles.workoutTextWrap}>
                          <Text style={styles.workoutName}>{workout.name}</Text>
                          <Text style={styles.workoutMeta}>
                            {workout.date} • {workout.duration} • {workout.totalSets} sets
                          </Text>
                        </View>
                        <View style={[styles.workoutScoreBadge, { backgroundColor: getScoreColor(workout.formScore) + '15' }]}>
                          <Text style={[styles.workoutScore, { color: getScoreColor(workout.formScore) }]}>
                            {workout.formScore}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </LinearGradient>
                </View>
              ))}
            </>
          )}

        </Animated.View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 60,
  },

  /* ── Hero Profile Card ─────────────────────── */
  heroCard: {
    borderRadius: 22,
    marginBottom: 12,
    marginTop: 8,
  },
  heroEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  avatarOuter: {},
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
  },
  nameWrap: {
    flex: 1,
    gap: 2,
  },
  displayName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  memberSince: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  heroScoreSection: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.10)',
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  heroScore: {
    fontFamily: FONTS.display.bold,
    fontSize: 44,
    letterSpacing: -2,
    lineHeight: 48,
  },
  heroScoreUnit: {
    fontFamily: FONTS.mono.regular,
    fontSize: 16,
    color: COLORS.textTertiary,
  },

  /* ── Stats Row (Bento) ─────────────────────── */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
  },
  statGradient: {
    borderRadius: 18,
  },
  statEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  statIconRow: {
    marginBottom: 12,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 34,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  /* ── Compare CTA ───────────────────────────── */
  ctaGradient: {
    borderRadius: 16,
    marginBottom: 12,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  ctaIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTextWrap: {
    flex: 1,
    gap: 2,
  },
  ctaTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  ctaSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
  },

  /* ── Section Headers ───────────────────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
  },

  /* ── Badges Card ───────────────────────────── */
  badgeCard: {
    borderRadius: 18,
  },
  badgeEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
    padding: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 166, 35, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Workout Cards ─────────────────────────── */
  workoutOuter: {
    marginBottom: 8,
  },
  workoutGradient: {
    borderRadius: 16,
  },
  workoutEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  workoutTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workoutTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  workoutName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  workoutMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 3,
  },
  workoutScoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  workoutScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
    letterSpacing: -0.3,
  },
});
