/**
 * LeaderboardView — Leaderboard tab content within SocialScreen
 */

import React, { memo, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
import { useLeaderboard } from '../../../backend/hooks';
import { LeaderboardEntry, LeaderboardMetric, TimeWindow } from '../../../backend/services/api/types';
import { Top3Podium } from '../../components/ui/Top3Podium';
import { LeaderboardRow } from '../../components/ui/LeaderboardRow';

const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'form_score', label: 'Form Score' },
  { key: 'weekly_volume', label: 'Volume' },
  { key: 'streak', label: 'Streak' },
];

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '1_week', label: '1W' },
  { key: '1_month', label: '1M' },
  { key: 'all_time', label: 'All' },
];

const MetricSelector = memo(({ active, onSelect }: { active: LeaderboardMetric; onSelect: (m: LeaderboardMetric) => void }) => (
  <View style={styles.selectorRow}>
    {METRICS.map(m => (
      <TouchableOpacity
        key={m.key}
        style={styles.tab}
        onPress={() => onSelect(m.key)}
        activeOpacity={0.7}
      >
        <Text style={[styles.tabText, active === m.key && styles.tabTextActive]}>
          {m.label}
        </Text>
        {active === m.key && <View style={styles.underline} />}
      </TouchableOpacity>
    ))}
  </View>
));

const TimeSelector = memo(({ active, onSelect }: { active: TimeWindow; onSelect: (t: TimeWindow) => void }) => (
  <View style={styles.timeRow}>
    <View style={styles.timeTrack}>
      {TIME_WINDOWS.map(t => (
        <TouchableOpacity
          key={t.key}
          style={[styles.timePill, active === t.key && styles.timePillActive]}
          onPress={() => onSelect(t.key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.timeText, active === t.key && styles.timeTextActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
));

export const LeaderboardView: React.FC = memo(() => {
  const [metric, setMetric] = useState<LeaderboardMetric>('form_score');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1_week');
  const { entries, currentUser, totalParticipants, isLoading, error, refetch } = useLeaderboard(metric, timeWindow);

  const top3 = useMemo(() => entries.slice(0, 3), [entries]);
  const rest = useMemo(() => entries.slice(3), [entries]);

  const currentUserId = currentUser?.userId;
  const showStickyBanner = currentUser && currentUser.rank > 10;

  const renderItem = useCallback(({ item }: { item: LeaderboardEntry }) => (
    <LeaderboardRow
      entry={item}
      isCurrentUser={item.userId === currentUserId}
    />
  ), [currentUserId]);

  const keyExtractor = useCallback((item: LeaderboardEntry) => item.userId, []);

  const ListHeader = useMemo(() => (
    <View>
      <MetricSelector active={metric} onSelect={setMetric} />
      <TimeSelector active={timeWindow} onSelect={setTimeWindow} />

      {isLoading && entries.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No rankings yet</Text>
          <Text style={styles.emptySubtitle}>Complete workouts to appear on the leaderboard</Text>
        </View>
      ) : (
        <>
          <Top3Podium entries={top3} />
          <View style={styles.listHeaderRow}>
            <Text style={styles.listHeaderText}>
              {totalParticipants} participants
            </Text>
          </View>
        </>
      )}
    </View>
  ), [metric, timeWindow, isLoading, error, entries.length, top3, totalParticipants, refetch]);

  return (
    <View style={styles.container}>
      <FlatList
        data={rest}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && entries.length > 0}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Sticky current user banner */}
      {showStickyBanner && currentUser && (
        <View style={styles.stickyBanner}>
          <View style={styles.stickyRankBadge}>
            <Text style={styles.stickyRank}>#{currentUser.rank}</Text>
          </View>
          <Text style={styles.stickyName}>You</Text>
          <Text style={[styles.stickyScore, { color: getScoreColor(currentUser.score) }]}>
            {currentUser.score.toFixed(1)}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 120,
  },

  /* ── Metric Selector ── */
  selectorRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal + 50,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginTop: 4,
    marginBottom: 4,
    gap: 20,
  },

  /* ── Time Window Selector ── */
  timeRow: {
    alignItems: 'center',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  timeTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    padding: 2,
  },
  timePill: {
    paddingVertical: 6,
    paddingHorizontal: 22,
    borderRadius: 8,
  },
  timePillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  timeText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  timeTextActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },

  /* ── Shared tab styles ── */
  tab: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },

  /* ── List Header ── */
  listHeaderRow: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.sm,
  },
  listHeaderText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },

  /* ── States ── */
  loadingContainer: {
    paddingTop: 80,
    alignItems: 'center',
  },
  errorContainer: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.orange,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SPACING.md,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  retryText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.primary,
  },
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  emptyTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
  },
  emptySubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  /* ── Sticky Banner ── */
  stickyBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingBottom: 28,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.15)',
    gap: SPACING.md,
  },
  stickyRankBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  stickyRank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    color: COLORS.primary,
  },
  stickyName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  stickyScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
  },
});
