/**
 * LeaderboardView — Leaderboard tab content within SocialScreen
 */

import React, { memo, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Pressable,
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

const FilterBar = memo(({
  metric, onMetric, time, onTime,
}: {
  metric: LeaderboardMetric; onMetric: (m: LeaderboardMetric) => void;
  time: TimeWindow; onTime: (t: TimeWindow) => void;
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [triggerLayout, setTriggerLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const triggerRef = useRef<View>(null);

  const currentMetricLabel = METRICS.find(m => m.key === metric)?.label ?? '';
  const currentTimeIdx = TIME_WINDOWS.findIndex(t2 => t2.key === time);
  const currentTimeLabel = TIME_WINDOWS[currentTimeIdx].label;

  const cycleTime = useCallback(() => {
    const nextIdx = (currentTimeIdx + 1) % TIME_WINDOWS.length;
    onTime(TIME_WINDOWS[nextIdx].key);
  }, [currentTimeIdx, onTime]);

  const openDropdown = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setTriggerLayout({ x, y, width, height });
      setDropdownOpen(true);
    });
  }, []);

  const selectMetric = useCallback((m: LeaderboardMetric) => {
    onMetric(m);
    setDropdownOpen(false);
  }, [onMetric]);

  return (
    <View style={styles.filterBar}>
      {/* Metric dropdown trigger */}
      <View ref={triggerRef} collapsable={false}>
        <TouchableOpacity
          style={styles.metricTrigger}
          onPress={openDropdown}
          activeOpacity={0.7}
        >
          <View style={styles.underlineWrap}>
            <Text style={styles.metricTriggerText}>{currentMetricLabel}</Text>
            <View style={styles.filterUnderline} />
          </View>
          <Text style={styles.metricChevron}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Time — single cycling chip */}
      <TouchableOpacity
        style={styles.timeChip}
        onPress={cycleTime}
        activeOpacity={0.7}
      >
        <View style={styles.underlineWrap}>
          <Text style={styles.timeChipText}>{currentTimeLabel}</Text>
          <View style={styles.filterUnderline} />
        </View>
      </TouchableOpacity>

      {/* Dropdown menu */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable style={styles.dropdownBackdrop} onPress={() => setDropdownOpen(false)}>
          <View
            style={[
              styles.dropdownMenu,
              { top: triggerLayout.y + triggerLayout.height + 4, left: triggerLayout.x },
            ]}
          >
            {METRICS.map(m => (
              <TouchableOpacity
                key={m.key}
                style={[styles.dropdownItem, metric === m.key && styles.dropdownItemActive]}
                onPress={() => selectMetric(m.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dropdownItemText, metric === m.key && styles.dropdownItemTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
});

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
      <FilterBar metric={metric} onMetric={setMetric} time={timeWindow} onTime={setTimeWindow} />

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

  /* ── Combined Filter Bar ── */
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },

  /* Metric dropdown trigger */
  metricTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  metricTriggerText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  metricChevron: {
    fontSize: 18,
    color: COLORS.textTertiary,
  },

  /* Dropdown menu */
  dropdownBackdrop: {
    flex: 1,
  },
  dropdownMenu: {
    position: 'absolute',
    minWidth: 160,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  dropdownItemText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: -0.2,
  },
  dropdownItemTextActive: {
    color: COLORS.text,
  },

  /* Text + underline wrapper */
  underlineWrap: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  filterUnderline: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },

  /* Time — single cycling chip */
  timeChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  timeChipText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
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
