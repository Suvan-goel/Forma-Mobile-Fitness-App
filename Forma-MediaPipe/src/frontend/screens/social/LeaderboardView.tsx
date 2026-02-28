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
import { COLORS, FONTS, SPACING, CARD_STYLE, getScoreColor } from '../../constants/theme';
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
        style={[styles.selectorPill, active === m.key && styles.selectorPillActive]}
        onPress={() => onSelect(m.key)}
        activeOpacity={0.7}
      >
        <Text style={[styles.selectorText, active === m.key && styles.selectorTextActive]}>
          {m.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
));

const TimeSelector = memo(({ active, onSelect }: { active: TimeWindow; onSelect: (t: TimeWindow) => void }) => (
  <View style={styles.timeRow}>
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
          <Text style={styles.stickyRank}>#{currentUser.rank}</Text>
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
  selectorRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
    gap: SPACING.xs,
  },
  selectorPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  selectorPillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  selectorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  selectorTextActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  timePill: {
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  timePillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
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
  listHeaderRow: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  listHeaderText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
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
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
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
  stickyBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderTopWidth: 1,
    borderTopColor: COLORS.primary,
    gap: SPACING.md,
  },
  stickyRank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
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
