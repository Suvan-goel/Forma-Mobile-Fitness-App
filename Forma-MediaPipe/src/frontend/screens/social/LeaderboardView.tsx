/**
 * LeaderboardView — Reusable leaderboard tab content
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
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { useLeaderboard } from '../../../backend/hooks';
import { LeaderboardEntry, TimeWindow } from '../../../backend/services/api/types';
import { Top3Podium } from '../../components/ui/Top3Podium';
import { LeaderboardRow } from '../../components/ui/LeaderboardRow';

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '1_week', label: 'This Week' },
  { key: 'all_time', label: 'All Time' },
];

const FilterBar = memo(({
  time, onTime,
}: {
  time: TimeWindow; onTime: (t: TimeWindow) => void;
}) => {
  return (
    <View style={styles.filterBar}>
      {TIME_WINDOWS.map(item => {
        const active = item.key === time;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.timeSegment, active && styles.timeSegmentActive]}
            onPress={() => onTime(item.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.timeSegmentText, active && styles.timeSegmentTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

const TableHeader = memo(() => (
  <View style={styles.tableHeader}>
    <Text style={[styles.tableHeaderText, styles.rankColumn]}>Rank</Text>
    <Text style={[styles.tableHeaderText, styles.athleteColumn]}>Athlete</Text>
    <Text style={[styles.tableHeaderText, styles.scoreColumn]}>Form Score</Text>
    <Text style={[styles.tableHeaderText, styles.streakColumn]}>Streak</Text>
  </View>
));

export const LeaderboardView: React.FC = memo(() => {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1_week');
  const { entries, currentUser, isLoading, error, refetch } = useLeaderboard('form_score', timeWindow);

  const top3 = useMemo(() => entries.slice(0, 3), [entries]);
  const rest = useMemo(() => entries.slice(3), [entries]);

  const currentUserId = currentUser?.userId;
  const showStickyBanner = currentUser && currentUser.rank > 10;

  const renderItem = useCallback(({ item, index }: { item: LeaderboardEntry; index: number }) => (
    <LeaderboardRow
      entry={item}
      isCurrentUser={item.userId === currentUserId}
      isFirstRow={index === 0}
      isLastRow={index === rest.length - 1}
    />
  ), [currentUserId, rest.length]);

  const keyExtractor = useCallback((item: LeaderboardEntry) => item.userId, []);

  const ListHeader = useMemo(() => (
    <View>
      <FilterBar time={timeWindow} onTime={setTimeWindow} />

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
          <TableHeader />
        </>
      )}
    </View>
  ), [timeWindow, isLoading, error, entries.length, top3, refetch]);

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
          <Text style={styles.stickyScore}>
            {currentUser.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
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
    paddingBottom: 106,
  },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    width: '78%',
    maxWidth: 320,
    minWidth: 260,
    marginTop: 2,
    marginBottom: 0,
    padding: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  timeSegment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  timeSegmentActive: {
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
  },
  timeSegmentText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  timeSegmentTextActive: {
    color: COLORS.primary,
  },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.screenHorizontal,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 7,
  },
  tableHeaderText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  rankColumn: {
    width: 56,
  },
  athleteColumn: {
    flex: 1,
  },
  scoreColumn: {
    width: 84,
    textAlign: 'right',
  },
  streakColumn: {
    width: 48,
    textAlign: 'center',
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
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 20,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(124, 92, 255, 0.28)',
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
    paddingVertical: 10,
    paddingBottom: 28,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: '#0E151A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
    gap: SPACING.md,
  },
  stickyRankBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(124, 92, 255, 0.14)',
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
    color: COLORS.green,
  },
});
