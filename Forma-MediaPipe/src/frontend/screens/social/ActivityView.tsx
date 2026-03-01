/**
 * ActivityView — Activity feed tab content within SocialScreen
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
import { Inbox } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { useActivityFeed } from '../../../backend/hooks';
import { ActivityEvent, ActivityFilter } from '../../../backend/services/api/types';
import { ActivityEventCard } from '../../components/ui/ActivityEventCard';

const FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'badges', label: 'Badges' },
  { key: 'records', label: 'PRs' },
];

const FilterRow = memo(({ active, onSelect }: { active: ActivityFilter; onSelect: (f: ActivityFilter) => void }) => (
  <View style={styles.filterRow}>
    {FILTERS.map(f => (
      <TouchableOpacity
        key={f.key}
        style={[styles.filterPill, active === f.key && styles.filterPillActive]}
        onPress={() => onSelect(f.key)}
        activeOpacity={0.7}
      >
        <Text style={[styles.filterText, active === f.key && styles.filterTextActive]}>
          {f.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
));

export const ActivityView: React.FC = memo(() => {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const { events, isLoading, isLoadingMore, error, hasMore, loadMore, refetch } = useActivityFeed(filter);

  const renderItem = useCallback(({ item }: { item: ActivityEvent }) => (
    <ActivityEventCard event={item} />
  ), []);

  const keyExtractor = useCallback((item: ActivityEvent) => item.id, []);

  const ListHeader = useMemo(() => (
    <FilterRow active={filter} onSelect={setFilter} />
  ), [filter]);

  const ListFooter = useMemo(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator color={COLORS.primary} size="small" />
        </View>
      );
    }
    return null;
  }, [isLoadingMore]);

  if (isLoading && events.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (error && events.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={refetch} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Inbox size={28} color={COLORS.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptySubtitle}>
            Add friends to see their workout activity here
          </Text>
        </View>
      }
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.3}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={isLoading && events.length > 0}
          onRefresh={refetch}
          tintColor={COLORS.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    />
  );
});

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  listContent: {
    paddingBottom: 120,
  },

  /* ── Filter pills ── */
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  filterPill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    backgroundColor: 'transparent',
  },
  filterPillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  filterText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  filterTextActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },

  /* ── States ── */
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  emptyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: SPACING.md,
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
  footerLoading: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
  },
});
