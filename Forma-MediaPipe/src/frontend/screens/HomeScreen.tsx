/**
 * HomeScreen — Central hub / landing page
 *
 * Sections:
 *   1. Motivation Dashboard (welcome, streak, daily quote)
 *   2. Progress Snapshot (points, form trend, workouts, next badge)
 *   3. Social Preview Hub (leaderboard teaser, friend activity)
 *   4. Challenge Centre (weekly goals derived from existing data)
 *   5. News & Updates (placeholder feed)
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  Animated,
  TouchableOpacity,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Zap,
  Award,
  Target,
  Users,
  Newspaper,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Dumbbell,
  Menu,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useAlert } from '../contexts/AlertContext';
import { useHomeData } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import type { RootStackParamList } from '../app/RootNavigator';


// ── Helpers ────────────────────────────────────────

const RANK_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

const NEWS_CATEGORY_COLORS: Record<string, string> = {
  tip: COLORS.accent,
  update: COLORS.yellow,
  new: '#34D399',
};

const NEWS_CATEGORY_LABELS: Record<string, string> = {
  tip: 'TIP',
  update: 'UPDATE',
  new: 'NEW',
};

// ── Main Screen ────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const { homeData, isLoading, error, refetch } = useHomeData();

  useEffect(() => {
    if (homeData) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }
  }, [homeData, fadeAnim]);

  const navigateToTab = useCallback((tab: string) => {
    navigation.navigate('MainTabs', { screen: tab });
  }, [navigation]);

  const handleComingSoon = useCallback(() => {
    showAlert('Coming Soon', 'Social features are on the way! Stay tuned.');
  }, [showAlert]);

  // ── Loading ────────────────────────────────────

  if (isLoading || !homeData) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={180} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}>
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={90} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={200} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={100} />
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

  // ── Render ─────────────────────────────────────

  const TrendIcon = homeData.formTrendDirection === 'up' ? TrendingUp
    : homeData.formTrendDirection === 'down' ? TrendingDown : Minus;
  const trendColor = homeData.formTrendDirection === 'up' ? '#34D399'
    : homeData.formTrendDirection === 'down' ? COLORS.orange : COLORS.textSecondary;

  return (
    <View style={styles.container}>
      {/* ── WELCOME HEADER ──────────────────────── */}
      <View style={styles.welcomeRow}>
        <View style={styles.welcomeLeft}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.welcomeLabel}>Welcome back,</Text>
            <Text style={styles.welcomeName}>{homeData.displayName}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
        >
          <Menu size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* ═══════════════════════════════════════════
              SECTION 2: PROGRESS SNAPSHOT
              ═══════════════════════════════════════════ */}
          <View style={[styles.sectionHeader, { marginTop: SPACING.md }]}>
            <Zap size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>PROGRESS SNAPSHOT</Text>
          </View>

          {/* 3-tile summary row */}
          <View style={styles.tileRow}>
            <TouchableOpacity style={styles.tileFlex} activeOpacity={0.8} onPress={() => navigateToTab('Rewards')}>
              <LinearGradient colors={[...CARD_GRADIENT_COLORS]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.tileGradient}>
                <View style={styles.tileGlass}>
                  <Trophy size={14} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.tileValue}>{homeData.totalPoints}</Text>
                  <Text style={styles.tileLabel}>POINTS</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileFlex} activeOpacity={0.8} onPress={() => navigateToTab('Analytics')}>
              <LinearGradient colors={[...CARD_GRADIENT_COLORS]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.tileGradient}>
                <View style={styles.tileGlass}>
                  <View style={styles.tileIconRow}>
                    <TrendIcon size={14} color={trendColor} strokeWidth={1.5} />
                  </View>
                  <Text style={[styles.tileValue, { color: trendColor }]}>
                    {homeData.formTrendPercent > 0 ? '+' : ''}{homeData.formTrendPercent}%
                  </Text>
                  <Text style={styles.tileLabel}>FORM TREND</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileFlex} activeOpacity={0.8} onPress={() => navigateToTab('Logbook')}>
              <LinearGradient colors={[...CARD_GRADIENT_COLORS]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.tileGradient}>
                <View style={styles.tileGlass}>
                  <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.tileValue}>{homeData.workoutCount}</Text>
                  <Text style={styles.tileLabel}>WORKOUTS</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Next Badge + Form Score cards */}
          <View style={styles.twoColRow}>
            {/* Next Badge */}
            {homeData.nextBadge && (
              <TouchableOpacity style={styles.halfCard} activeOpacity={0.8} onPress={() => navigateToTab('Rewards')}>
                <LinearGradient colors={[...CARD_GRADIENT_COLORS]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.cardGradient}>
                  <View style={styles.cardGlassEdge}>
                    <View style={styles.sectionLabelRow}>
                      <Award size={12} color={homeData.nextBadge.color} strokeWidth={1.5} />
                      <Text style={styles.sectionLabel}>NEXT BADGE</Text>
                    </View>
                    <Text style={styles.badgeName}>{homeData.nextBadge.name}</Text>
                    <View style={styles.progressTrack}>
                      {homeData.nextBadge.current > 0 && (
                        <LinearGradient
                          colors={[homeData.nextBadge.color + 'BB', homeData.nextBadge.color]}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={[styles.progressFill, { width: `${Math.min((homeData.nextBadge.current / homeData.nextBadge.required) * 100, 100)}%` }]}
                        />
                      )}
                    </View>
                    <Text style={styles.progressLabel}>
                      {homeData.nextBadge.current} / {homeData.nextBadge.required} pts
                    </Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {/* Form Score */}
            <TouchableOpacity style={styles.halfCard} activeOpacity={0.8} onPress={() => navigateToTab('Analytics')}>
              <LinearGradient colors={[...CARD_GRADIENT_COLORS]} start={CARD_GRADIENT_START} end={CARD_GRADIENT_END} style={styles.cardGradient}>
                <View style={styles.cardGlassEdge}>
                  <View style={styles.sectionLabelRow}>
                    <Target size={12} color={getScoreColor(homeData.formScore)} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>FORM SCORE</Text>
                  </View>
                  <Text style={[styles.formScoreValue, { color: getScoreColor(homeData.formScore) }]}>
                    {homeData.formScore}
                  </Text>
                  <View style={styles.trendRow}>
                    <TrendIcon size={12} color={trendColor} strokeWidth={1.5} />
                    <Text style={[styles.trendText, { color: trendColor }]}>
                      {homeData.formTrendDirection === 'up' ? 'Improving' : homeData.formTrendDirection === 'down' ? 'Declining' : 'Stable'}
                    </Text>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* ═══════════════════════════════════════════
              SECTION 3: SOCIAL PREVIEW HUB
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionHeader}>
            <Users size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>SOCIAL</Text>
            <TouchableOpacity style={styles.seeAllBtn} activeOpacity={0.7} onPress={handleComingSoon}>
              <Text style={styles.seeAllText}>See All</Text>
              <ChevronRight size={12} color={COLORS.accent} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Leaderboard preview */}
              <Text style={styles.innerLabel}>LEADERBOARD PREVIEW</Text>
              {homeData.socialPreview.leaderboard.slice(0, 5).map((entry) => (
                <View key={entry.rank} style={[styles.leaderRow, entry.isCurrentUser && styles.leaderRowHighlight]}>
                  <Text style={[styles.leaderRank, { color: RANK_COLORS[entry.rank] || COLORS.textSecondary }]}>
                    #{entry.rank}
                  </Text>
                  <View style={[styles.leaderAvatar, entry.isCurrentUser && styles.leaderAvatarAccent]}>
                    <Text style={styles.leaderAvatarText}>{entry.displayName[0]}</Text>
                  </View>
                  <Text style={[styles.leaderName, entry.isCurrentUser && styles.leaderNameHighlight]} numberOfLines={1}>
                    {entry.displayName}{entry.isCurrentUser ? ' (You)' : ''}
                  </Text>
                  <Text style={styles.leaderPoints}>{entry.points}</Text>
                </View>
              ))}

              <View style={styles.divider} />

              {/* Friends activity */}
              <Text style={styles.innerLabel}>FRIENDS ACTIVITY</Text>
              {homeData.socialPreview.friendActivity.map((item) => (
                <View key={item.id} style={styles.activityRow}>
                  <View style={styles.activityAvatar}>
                    <Text style={styles.activityAvatarText}>{item.displayName[0]}</Text>
                  </View>
                  <View style={styles.activityInfo}>
                    <Text style={styles.activityText}>
                      <Text style={styles.activityName}>{item.displayName}</Text> {item.action}
                    </Text>
                    <Text style={styles.activityTime}>{item.timeAgo}</Text>
                  </View>
                </View>
              ))}

              {/* CTA */}
              <TouchableOpacity style={styles.socialCta} activeOpacity={0.7} onPress={handleComingSoon}>
                <Text style={styles.socialCtaText}>View Leaderboard</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              SECTION 4: CHALLENGE CENTRE
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionHeader}>
            <Target size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>CHALLENGES</Text>
          </View>

          {homeData.challenges.map((challenge) => {
            const progress = challenge.targetValue > 0
              ? Math.min((challenge.currentValue / challenge.targetValue) * 100, 100)
              : 0;
            const isComplete = challenge.currentValue >= challenge.targetValue;

            return (
              <TouchableOpacity
                key={challenge.id}
                activeOpacity={0.8}
                onPress={() => navigateToTab(challenge.navigateTo)}
                style={styles.challengeOuter}
              >
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardGlassEdge}>
                    <View style={styles.challengeHeader}>
                      <Text style={styles.challengeTitle}>{challenge.title}</Text>
                      {isComplete && (
                        <View style={styles.completePill}>
                          <Text style={styles.completeText}>DONE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.challengeDesc}>{challenge.description}</Text>
                    <View style={styles.progressTrack}>
                      {progress > 0 && (
                        <LinearGradient
                          colors={isComplete ? ['#34D399BB', '#34D399'] : [COLORS.accent + 'BB', COLORS.accent]}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={[styles.progressFill, { width: `${progress}%` }]}
                        />
                      )}
                    </View>
                    <Text style={styles.progressLabel}>
                      {challenge.currentValue} / {challenge.targetValue} {challenge.unit}
                    </Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}

          {/* ═══════════════════════════════════════════
              SECTION 5: NEWS & UPDATES
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionHeader}>
            <Newspaper size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>NEWS & UPDATES</Text>
          </View>

          {homeData.news.map((item) => {
            const catColor = NEWS_CATEGORY_COLORS[item.category] || COLORS.accent;
            return (
              <View key={item.id} style={styles.newsOuter}>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardGlassEdge}>
                    {/* Category pill */}
                    <View style={styles.newsCatRow}>
                      <View style={[styles.newsDot, { backgroundColor: catColor }]} />
                      <View style={[styles.newsPill, { backgroundColor: catColor + '1A' }]}>
                        <Text style={[styles.newsPillText, { color: catColor }]}>
                          {NEWS_CATEGORY_LABELS[item.category]}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.newsTitle}>{item.title}</Text>
                    <Text style={styles.newsBody} numberOfLines={2}>{item.body}</Text>
                    <Text style={styles.newsDate}>{item.date}</Text>
                  </View>
                </LinearGradient>
              </View>
            );
          })}

        </Animated.View>
      </ScrollView>
    </View>
  );
};

// ── Styles ─────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    paddingBottom: 180,
  },

  /* ── Welcome Header ──────────────────────────── */
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  welcomeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  welcomeLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  welcomeName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  settingsButton: {
    padding: 8,
  },

  /* ── Shared Card Styles ──────────────────────── */
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 16,
  },

  /* ── Section Headers ─────────────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.xl,
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 2,
    flex: 1,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },

  /* ── Shared divider ──────────────────────────── */
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: SPACING.md,
  },

  /* ── Section 2: Progress ─────────────────────── */
  tileRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tileFlex: {
    flex: 1,
  },
  tileGradient: {
    borderRadius: 19,
  },
  tileGlass: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 14,
    alignItems: 'center',
    minHeight: 90,
    justifyContent: 'center',
    gap: 4,
  },
  tileIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tileValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  tileLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },

  twoColRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  halfCard: {
    flex: 1,
  },

  badgeName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 10,
  },

  progressTrack: {
    height: 4,
    backgroundColor: '#27272A',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressLabel: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 6,
  },

  formScoreValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 36,
    letterSpacing: -1,
    marginBottom: 4,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
  },

  /* ── Section 3: Social ───────────────────────── */
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
  },
  innerLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    marginBottom: 10,
  },

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  leaderRowHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  leaderRank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    width: 28,
  },
  leaderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderAvatarAccent: {
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  leaderAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
  },
  leaderName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  leaderNameHighlight: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
  },
  leaderPoints: {
    fontFamily: FONTS.mono.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  activityAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  activityInfo: {
    flex: 1,
  },
  activityText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  activityName: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  activityTime: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  socialCta: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  socialCtaText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0.5,
  },

  /* ── Section 4: Challenges ───────────────────── */
  challengeOuter: {
    marginBottom: 10,
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  challengeTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  challengeDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  completePill: {
    backgroundColor: '#34D3991A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  completeText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    color: '#34D399',
    letterSpacing: 1,
  },

  /* ── Section 5: News ─────────────────────────── */
  newsOuter: {
    marginBottom: 10,
  },
  newsCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  newsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  newsPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  newsPillText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    letterSpacing: 1,
  },
  newsTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  newsBody: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  newsDate: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
});
