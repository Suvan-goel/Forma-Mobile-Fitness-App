/**
 * FriendComparisonScreen - 1v1 side-by-side stat comparison
 */

import React, { memo, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ChevronLeft, GitCompare } from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_VERTICAL_GAP,
  getScoreColor,
} from '../../constants/theme';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { useFriendComparison } from '../../../backend/hooks/useFriendComparison';
import type { ComparisonStats } from '../../../backend/services/api';

type MetricFormat = 'score' | 'integer' | 'decimal';

interface Metric {
  label: string;
  yourValue: number;
  friendValue: number;
  format: MetricFormat;
}

export const FriendComparisonScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { friendId } = route.params;
  const { comparison, isLoading, error, refetch } =
    useFriendComparison(friendId);

  const metrics = useMemo<Metric[]>(() => {
    if (!comparison) return [];

    return [
      {
        label: 'Form Score',
        yourValue: comparison.you.avgFormScore,
        friendValue: comparison.friend.avgFormScore,
        format: 'decimal',
      },
      {
        label: 'Streak',
        yourValue: comparison.you.streakDays,
        friendValue: comparison.friend.streakDays,
        format: 'integer',
      },
      {
        label: 'Weekly Workouts',
        yourValue: comparison.you.weeklyWorkouts,
        friendValue: comparison.friend.weeklyWorkouts,
        format: 'integer',
      },
      {
        label: 'Best Set',
        yourValue: comparison.you.bestSetScore,
        friendValue: comparison.friend.bestSetScore,
        format: 'score',
      },
      {
        label: 'Total Points',
        yourValue: comparison.you.totalPoints,
        friendValue: comparison.friend.totalPoints,
        format: 'integer',
      },
    ];
  }, [comparison]);

  const yourWins = useMemo(
    () =>
      metrics.filter((metric) => metric.yourValue > metric.friendValue).length,
    [metrics],
  );
  const friendWins = useMemo(
    () =>
      metrics.filter((metric) => metric.friendValue > metric.yourValue).length,
    [metrics],
  );
  const formDelta = comparison
    ? comparison.you.avgFormScore - comparison.friend.avgFormScore
    : 0;

  if (isLoading || !comparison) {
    return (
      <ScreenBackground>
        <View style={styles.container}>
          <ComparisonHeader
            topInset={insets.top}
            onBack={() => navigation.goBack()}
          />
          <View style={styles.centerContainer}>
            {error ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Could not load comparison</Text>
                <Text style={styles.emptyCopy}>{error}</Text>
                <TouchableOpacity onPress={refetch} activeOpacity={0.78}>
                  <LinearGradient
                    colors={[COLORS.primary, COLORS.primaryDark]}
                    style={styles.retryButton}
                  >
                    <Text style={styles.retryText}>Try Again</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <ActivityIndicator color={COLORS.primary} size="large" />
            )}
          </View>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <ComparisonHeader
          topInset={insets.top}
          onBack={() => navigation.goBack()}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.heroCard}
          >
            <View style={styles.heroEdge}>
              <Text style={styles.eyebrow}>FRIEND COMPARISON</Text>
              <View style={styles.matchupRow}>
                <CompetitorCard
                  label="You"
                  stats={comparison.you}
                  align="left"
                />

                <View style={styles.compareBadge}>
                  <GitCompare
                    size={18}
                    color={COLORS.primary}
                    strokeWidth={1.8}
                  />
                </View>

                <CompetitorCard
                  label="Friend"
                  stats={comparison.friend}
                  align="right"
                />
              </View>
            </View>
          </LinearGradient>

          <View style={styles.summaryRow}>
            <SummaryTile
              value={`${yourWins}-${friendWins}`}
              label="Metric edge"
            />
            <SummaryTile
              value={formatMetricValue(formDelta, 'decimal', true)}
              label="Form delta"
              tone={formDelta >= 0 ? 'positive' : 'negative'}
            />
          </View>

          <Text style={styles.sectionTitle}>Stats</Text>
          <View style={styles.metricList}>
            {metrics.map((metric) => (
              <MetricRow key={metric.label} metric={metric} />
            ))}
          </View>
        </ScrollView>
      </View>
    </ScreenBackground>
  );
});

const ComparisonHeader = ({
  topInset,
  onBack,
}: {
  topInset: number;
  onBack: () => void;
}) => (
  <View style={[styles.header, { paddingTop: topInset + 4 }]}>
    <TouchableOpacity
      onPress={onBack}
      style={styles.headerIcon}
      activeOpacity={0.7}
    >
      <ChevronLeft size={26} color={COLORS.textSecondary} strokeWidth={1.7} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>COMPARE</Text>
    <View style={styles.headerIcon} />
  </View>
);

const CompetitorCard = ({
  stats,
  label,
  align,
}: {
  stats: ComparisonStats;
  label: string;
  align: 'left' | 'right';
}) => {
  const initial = stats.displayName.charAt(0).toUpperCase();

  return (
    <View
      style={[styles.competitor, align === 'right' && styles.competitorRight]}
    >
      <View style={styles.avatarRing}>
        {stats.avatarUrl ? (
          <Image source={{ uri: stats.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <LinearGradient
            colors={['#F3F4F6', '#ADB2B6']}
            style={styles.avatarFallback}
          >
            <Text style={styles.avatarInitial}>{initial}</Text>
          </LinearGradient>
        )}
      </View>
      <Text style={styles.competitorLabel}>{label}</Text>
      <Text style={styles.competitorName} numberOfLines={1}>
        {stats.displayName}
      </Text>
      <Text
        style={[styles.formScore, { color: getScoreColor(stats.avgFormScore) }]}
      >
        {Math.round(stats.avgFormScore)}
      </Text>
    </View>
  );
};

const SummaryTile = ({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: 'positive' | 'negative';
}) => (
  <LinearGradient
    colors={[...CARD_GRADIENT_COLORS]}
    start={CARD_GRADIENT_START}
    end={CARD_GRADIENT_END}
    style={styles.summaryTile}
  >
    <Text
      style={[
        styles.summaryValue,
        tone === 'positive' && styles.summaryValuePositive,
        tone === 'negative' && styles.summaryValueNegative,
      ]}
    >
      {value}
    </Text>
    <Text style={styles.summaryLabel}>{label}</Text>
  </LinearGradient>
);

const MetricRow = ({ metric }: { metric: Metric }) => {
  const youWin = metric.yourValue > metric.friendValue;
  const friendWin = metric.friendValue > metric.yourValue;
  const isDraw = metric.yourValue === metric.friendValue;
  const maxValue = Math.max(metric.yourValue, metric.friendValue, 1);
  const yourWidth = Math.max(6, (metric.yourValue / maxValue) * 100);
  const friendWidth = Math.max(6, (metric.friendValue / maxValue) * 100);
  const leaderText = isDraw ? 'Even' : youWin ? 'You lead' : 'Friend leads';

  return (
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.metricCard}
    >
      <View style={styles.metricEdge}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricLabel}>{metric.label}</Text>
          <Text
            style={[
              styles.leaderText,
              (youWin || friendWin) && styles.leaderTextActive,
            ]}
          >
            {leaderText}
          </Text>
        </View>

        <View style={styles.valuesRow}>
          <View style={styles.valueSide}>
            <Text style={styles.valueOwner}>You</Text>
            <Text style={[styles.metricValue, youWin && styles.winningValue]}>
              {formatMetricValue(metric.yourValue, metric.format)}
            </Text>
          </View>
          <View style={[styles.valueSide, styles.valueSideRight]}>
            <Text style={styles.valueOwner}>Friend</Text>
            <Text
              style={[styles.metricValue, friendWin && styles.winningValue]}
            >
              {formatMetricValue(metric.friendValue, metric.format)}
            </Text>
          </View>
        </View>

        <View style={styles.trackRow}>
          <View style={styles.trackHalfLeft}>
            <View
              style={[
                styles.trackFill,
                styles.trackFillLeft,
                { width: `${yourWidth}%` },
                youWin && styles.trackFillWinning,
                isDraw && styles.trackFillDraw,
              ]}
            />
          </View>
          <View style={styles.trackDivider} />
          <View style={styles.trackHalfRight}>
            <View
              style={[
                styles.trackFill,
                styles.trackFillRight,
                { width: `${friendWidth}%` },
                friendWin && styles.trackFillWinning,
                isDraw && styles.trackFillDraw,
              ]}
            />
          </View>
        </View>
      </View>
    </LinearGradient>
  );
};

const formatMetricValue = (
  value: number,
  format: MetricFormat,
  includeSign = false,
) => {
  const absValue = Math.abs(value);
  const sign = includeSign && value > 0 ? '+' : value < 0 ? '-' : '';
  const targetValue = includeSign ? absValue : value;

  switch (format) {
    case 'integer':
      return `${sign}${Math.round(targetValue).toLocaleString()}`;
    case 'score':
      return `${sign}${targetValue.toFixed(0)}`;
    case 'decimal':
      return `${sign}${targetValue.toFixed(1)}`;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
  },
  header: {
    minHeight: 58,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 10,
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
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: 3,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 44,
  },
  heroCard: {
    borderRadius: CARD_RADIUS,
    marginTop: 4,
    marginBottom: CARD_VERTICAL_GAP,
  },
  heroEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 16,
  },
  eyebrow: {
    fontFamily: FONTS.display.bold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2.4,
    marginBottom: 16,
  },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  competitor: {
    flex: 1,
    minWidth: 0,
  },
  competitorRight: {
    alignItems: 'flex-end',
  },
  avatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    padding: 1,
    backgroundColor: 'rgba(255,255,255,0.52)',
    marginBottom: 10,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: '#101418',
  },
  competitorLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  competitorName: {
    maxWidth: '100%',
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  formScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 25,
    marginTop: 8,
  },
  compareBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,85,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122,85,255,0.24)',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: CARD_VERTICAL_GAP,
  },
  summaryTile: {
    flex: 1,
    minHeight: 78,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  summaryValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 24,
    color: COLORS.text,
    marginBottom: 4,
  },
  summaryValuePositive: {
    color: COLORS.green,
  },
  summaryValueNegative: {
    color: COLORS.yellow,
  },
  summaryLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
    letterSpacing: 2.2,
    marginBottom: 10,
  },
  metricList: {
    gap: CARD_VERTICAL_GAP,
  },
  metricCard: {
    borderRadius: CARD_RADIUS,
  },
  metricEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  metricLabel: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
  },
  leaderText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  leaderTextActive: {
    color: COLORS.green,
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  valueSide: {
    flex: 1,
  },
  valueSideRight: {
    alignItems: 'flex-end',
  },
  valueOwner: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  metricValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.textSecondary,
  },
  winningValue: {
    color: COLORS.green,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  trackHalfLeft: {
    flex: 1,
    height: '100%',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  trackHalfRight: {
    flex: 1,
    height: '100%',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  trackDivider: {
    width: 4,
    height: '100%',
    backgroundColor: 'rgba(7,10,13,0.9)',
  },
  trackFill: {
    height: '100%',
    backgroundColor: 'rgba(122,85,255,0.34)',
  },
  trackFillLeft: {
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  trackFillRight: {
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  trackFillWinning: {
    backgroundColor: 'rgba(52,224,166,0.62)',
  },
  trackFillDraw: {
    backgroundColor: 'rgba(122,85,255,0.42)',
  },
  emptyCard: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(23,27,30,0.9)',
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyCopy: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  retryButton: {
    minWidth: 128,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
  },
});
