/**
 * HomeScreen — Central hub / landing page (Redesigned)
 *
 * Sections:
 *   1. Welcome Header (greeting, avatar initial, settings)
 *   2. Hero Form Score (large arc-inspired card)
 *   3. Stats Row (streak + workouts — bento)
 *   4. Quick Start CTA (gradient accent button)
 *   5. Achievements Teaser (compact progress card)
 *   6. Social Snapshot (top-3 leaderboard, compact)
 *   7. Active Challenges (streamlined)
 *   8. News Feed (minimal)
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
  Flame,
  Quote,
  Zap,
  Play,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
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
  const slideAnim = useRef(new Animated.Value(20)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { homeData, isLoading, error, refetch } = useHomeData();

  useEffect(() => {
    if (homeData) {
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
  }, [homeData, fadeAnim, slideAnim]);

  const navigateToTab = useCallback((tab: string) => {
    navigation.navigate('MainTabs', { screen: tab });
  }, [navigation]);

  const handleGoToSocial = useCallback(() => {
    navigateToTab('Social');
  }, [navigateToTab]);

  // ── Loading ────────────────────────────────────

  if (isLoading || !homeData) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={60} style={{ marginBottom: SPACING.lg }} />
          <LoadingSkeleton variant="card" height={160} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}>
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={64} style={{ marginBottom: SPACING.lg }} />
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={160} />
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

  // ── Derived values ──────────────────────────────

  const TrendIcon = homeData.formTrendDirection === 'up' ? TrendingUp
    : homeData.formTrendDirection === 'down' ? TrendingDown : Minus;
  const trendColor = homeData.formTrendDirection === 'up' ? '#34D399'
    : homeData.formTrendDirection === 'down' ? COLORS.orange : COLORS.textSecondary;
  const scoreColor = getScoreColor(homeData.formScore);

  return (
    <View style={styles.container}>
      {/* ── WELCOME HEADER ──────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.avatarImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.nameText}>{homeData.displayName.toUpperCase()}</Text>
            <Text style={styles.greetingText}>WELCOME BACK</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Menu size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              HERO: FORM SCORE CARD
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Analytics')}
          >
            <LinearGradient
              colors={SCREEN_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroEdge}>
                {/* Top label row */}
                <View style={styles.heroTopRow}>
                  <View style={styles.heroLabelRow}>
                    <Target size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.heroLabel}>FORM SCORE</Text>
                  </View>
                  <View style={[styles.trendChip, { backgroundColor: trendColor + '15' }]}>
                    <TrendIcon size={11} color={trendColor} strokeWidth={2} />
                    <Text style={[styles.trendChipText, { color: trendColor }]}>
                      {homeData.formTrendPercent > 0 ? '+' : ''}{homeData.formTrendPercent}%
                    </Text>
                  </View>
                </View>

                {/* Big score */}
                <View style={styles.heroScoreRow}>
                  <Text style={[styles.heroScore, { color: scoreColor }]}>
                    {homeData.formScore}
                  </Text>
                  <Text style={styles.heroScoreUnit}>/100</Text>
                </View>

                <Text style={styles.heroSubtext}>7-day average</Text>

                {/* Bottom CTA hint */}
                <View style={styles.heroCta}>
                  <Text style={styles.heroCtaText}>View Analytics</Text>
                  <ChevronRight size={13} color={COLORS.accent} strokeWidth={2} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              STATS ROW: STREAK + WORKOUTS
              ═══════════════════════════════════════════ */}
          <View style={styles.statsRow}>
            <TouchableOpacity
              style={styles.statCell}
              activeOpacity={0.8}
              onPress={() => navigateToTab('Analytics')}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <Flame size={14} color={COLORS.yellow} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.statValue}>
                    {homeData.streakDays > 0 ? homeData.streakDays : '—'}
                  </Text>
                  <Text style={styles.statLabel}>
                    {homeData.streakDays === 1 ? 'day streak' : homeData.streakDays > 0 ? 'day streak' : 'start today'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCell}
              activeOpacity={0.8}
              onPress={() => navigateToTab('Logbook')}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.statValue}>{homeData.workoutCount}</Text>
                  <Text style={styles.statLabel}>workouts</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* ═══════════════════════════════════════════
              QUICK START — Accent gradient CTA
              ═══════════════════════════════════════════ */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigateToTab('Record')}
          >
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <View style={styles.ctaInner}>
                <View style={styles.ctaIconWrap}>
                  <Play size={16} color="#FFFFFF" strokeWidth={2} fill="#FFFFFF" />
                </View>
                <View style={styles.ctaTextWrap}>
                  <Text style={styles.ctaTitle}>Start Workout</Text>
                  <Text style={styles.ctaSub}>AI-powered form tracking</Text>
                </View>
                <ChevronRight size={18} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Motivational Quote ─────────────────── */}
          {homeData.motivationalQuote ? (
            <View style={styles.quoteWrap}>
              <Quote size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
              <Text style={styles.quoteText}>{homeData.motivationalQuote}</Text>
            </View>
          ) : null}

          {/* ═══════════════════════════════════════════
              ACHIEVEMENTS — Compact rewards card
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Trophy size={13} color={COLORS.yellow} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Rewards')}
          >
            <LinearGradient
              colors={['#1A1510', '#111008', '#0E0C07']}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.achieveCard}
            >
              <View style={styles.achieveEdge}>
                <View style={styles.achieveTopRow}>
                  <Trophy size={20} color={COLORS.yellow} strokeWidth={1.5} />
                  <View style={styles.achieveInfo}>
                    <Text style={styles.achievePts}>
                      {homeData.totalPoints.toLocaleString()}
                      <Text style={styles.achievePtsSuffix}> pts</Text>
                    </Text>
                    {homeData.nextBadge ? (
                      <Text style={styles.achieveNext} numberOfLines={1}>
                        Next: {homeData.nextBadge.name}
                      </Text>
                    ) : (
                      <Text style={styles.achieveNext}>All badges unlocked</Text>
                    )}
                  </View>
                  <ChevronRight size={16} color={COLORS.yellow} strokeWidth={1.5} />
                </View>

                {homeData.nextBadge && (
                  <View style={styles.achieveProgressWrap}>
                    <View style={styles.progressTrack}>
                      <LinearGradient
                        colors={[homeData.nextBadge.color + 'BB', homeData.nextBadge.color]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.progressFill, { width: `${Math.min((homeData.nextBadge.current / homeData.nextBadge.required) * 100, 100)}%` }]}
                      />
                    </View>
                    <Text style={[styles.achievePct, { color: homeData.nextBadge.color }]}>
                      {Math.round((homeData.nextBadge.current / homeData.nextBadge.required) * 100)}%
                    </Text>
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              SOCIAL — Compact top-3 leaderboard
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Users size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>SOCIAL</Text>
            </View>
            <TouchableOpacity style={styles.seeAllBtn} activeOpacity={0.7} onPress={handleGoToSocial}>
              <Text style={styles.seeAllText}>See All</Text>
              <ChevronRight size={11} color={COLORS.accent} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity activeOpacity={0.85} onPress={handleGoToSocial}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.socialCard}
            >
              <View style={styles.socialEdge}>
                {/* Top 3 leaderboard */}
                {homeData.socialPreview.leaderboard.slice(0, 3).map((entry, idx) => (
                  <View
                    key={entry.rank}
                    style={[
                      styles.lbRow,
                      entry.isCurrentUser && styles.lbRowHighlight,
                      idx < 2 && styles.lbRowBorder,
                    ]}
                  >
                    <View style={[styles.lbRankWrap, { backgroundColor: (RANK_COLORS[entry.rank] || COLORS.textTertiary) + '18' }]}>
                      <Text style={[styles.lbRank, { color: RANK_COLORS[entry.rank] || COLORS.textSecondary }]}>
                        {entry.rank}
                      </Text>
                    </View>
                    <View style={[styles.lbAvatar, entry.isCurrentUser && styles.lbAvatarAccent]}>
                      <Text style={styles.lbAvatarText}>{entry.displayName[0]}</Text>
                    </View>
                    <Text style={[styles.lbName, entry.isCurrentUser && styles.lbNameAccent]} numberOfLines={1}>
                      {entry.displayName}{entry.isCurrentUser ? ' (You)' : ''}
                    </Text>
                    <Text style={styles.lbPts}>{entry.points.toLocaleString()}</Text>
                  </View>
                ))}

                {/* Recent activity preview */}
                {homeData.socialPreview.friendActivity.length > 0 && (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.activityPreview}>
                      <Zap size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
                      <Text style={styles.activityPreviewText} numberOfLines={1}>
                        <Text style={styles.activityPreviewName}>
                          {homeData.socialPreview.friendActivity[0].displayName}
                        </Text>
                        {' '}{homeData.socialPreview.friendActivity[0].action}
                      </Text>
                      <Text style={styles.activityPreviewTime}>
                        {homeData.socialPreview.friendActivity[0].timeAgo}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ═══════════════════════════════════════════
              CHALLENGES — Streamlined
              ═══════════════════════════════════════════ */}
          {homeData.challenges.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Flame size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>CHALLENGES</Text>
                </View>
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
                      style={styles.challengeGradient}
                    >
                      <View style={styles.challengeEdge}>
                        <View style={styles.challengeTopRow}>
                          <View style={styles.challengeTextWrap}>
                            <Text style={styles.challengeTitle}>{challenge.title}</Text>
                            <Text style={styles.challengeDesc} numberOfLines={1}>{challenge.description}</Text>
                          </View>
                          {isComplete ? (
                            <View style={styles.donePill}>
                              <Text style={styles.doneText}>DONE</Text>
                            </View>
                          ) : (
                            <Text style={styles.challengeCounter}>
                              {challenge.currentValue}/{challenge.targetValue}
                            </Text>
                          )}
                        </View>
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
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* ═══════════════════════════════════════════
              NEWS — Minimal feed
              ═══════════════════════════════════════════ */}
          {homeData.news.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Newspaper size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>NEWS</Text>
                </View>
              </View>

              {homeData.news.map((item) => {
                const catColor = NEWS_CATEGORY_COLORS[item.category] || COLORS.accent;
                return (
                  <View key={item.id} style={styles.newsOuter}>
                    <LinearGradient
                      colors={[...CARD_GRADIENT_COLORS]}
                      start={CARD_GRADIENT_START}
                      end={CARD_GRADIENT_END}
                      style={styles.newsGradient}
                    >
                      <View style={styles.newsEdge}>
                        <View style={styles.newsTopRow}>
                          <Text style={[styles.newsPillText, { color: catColor }]}>
                            {NEWS_CATEGORY_LABELS[item.category]}
                          </Text>
                          <Text style={styles.newsDate}>{item.date}</Text>
                        </View>
                        <Text style={styles.newsTitle}>{item.title}</Text>
                        <Text style={styles.newsBody} numberOfLines={2}>{item.body}</Text>
                      </View>
                    </LinearGradient>
                  </View>
                );
              })}
            </>
          )}

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
    paddingBottom: 160,
  },

  /* ── Header ──────────────────────────────────── */
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
    gap: 12,
  },
  avatarWrap: {
    width: 50,
    height: 50,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  greetingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  nameText: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Hero Form Score ─────────────────────────── */
  heroCard: {
    borderRadius: 22,
    marginBottom: 12,
    marginTop: 18,
  },
  heroEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  trendChipText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    letterSpacing: -0.3,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  heroScore: {
    fontFamily: FONTS.display.bold,
    fontSize: 56,
    letterSpacing: -2,
    lineHeight: 60,
  },
  heroScoreUnit: {
    fontFamily: FONTS.mono.regular,
    fontSize: 16,
    color: COLORS.textTertiary,
  },
  heroSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.10)',
  },
  heroCtaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.2,
  },

  /* ── Stats Row ───────────────────────────────── */
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

  /* ── Quick Start CTA ─────────────────────────── */
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

  /* ── Quote ───────────────────────────────────── */
  quoteWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 6,
  },
  quoteText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    fontStyle: 'italic',
    flex: 1,
    lineHeight: 18,
  },

  /* ── Section Headers ─────────────────────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
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

  /* ── Achievements Card ───────────────────────── */
  achieveCard: {
    borderRadius: 18,
  },
  achieveEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.12)',
    padding: 16,
  },
  achieveTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  achieveInfo: {
    flex: 1,
    gap: 2,
  },
  achievePts: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  achievePtsSuffix: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  achieveNext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  achieveProgressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  achievePct: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    letterSpacing: -0.3,
  },

  /* ── Shared Progress Bar ─────────────────────── */
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

  /* ── Divider ─────────────────────────────────── */
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginVertical: 10,
  },

  /* ── Social Card ─────────────────────────────── */
  socialCard: {
    borderRadius: 18,
  },
  socialEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  lbRowHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
    borderRadius: 10,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  lbRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  lbRankWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbRank: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
  },
  lbAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvatarAccent: {
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  lbAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
  },
  lbName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },
  lbNameAccent: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
  },
  lbPts: {
    fontFamily: FONTS.mono.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  /* Activity preview row */
  activityPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityPreviewText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    flex: 1,
  },
  activityPreviewName: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
  },
  activityPreviewTime: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },

  /* ── Challenges ──────────────────────────────── */
  challengeOuter: {
    marginBottom: 8,
  },
  challengeGradient: {
    borderRadius: 16,
  },
  challengeEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  challengeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  challengeTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  challengeTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  challengeDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  challengeCounter: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  donePill: {
    backgroundColor: '#34D3991A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  doneText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    color: '#34D399',
    letterSpacing: 1,
  },

  /* ── News ────────────────────────────────────── */
  newsOuter: {
    marginBottom: 8,
  },
  newsGradient: {
    borderRadius: 16,
  },
  newsEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  newsTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  newsPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  newsPillText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    letterSpacing: 1,
  },
  newsDate: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  newsTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  newsBody: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
});
