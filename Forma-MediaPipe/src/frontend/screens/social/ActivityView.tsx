/**
 * ActivityView — Activity feed tab content within SocialScreen
 */

import React, { memo, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, Plus } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { useActivityFeed } from '../../../backend/hooks/useActivityFeed';
import { useReactions } from '../../../backend/hooks/useReactions';
import { ActivityEvent } from '../../../backend/services/api/types';
import { ActivityEventCard } from '../../components/ui/ActivityEventCard';
import { getTabScreenBottomPadding } from '../../utils/safeAreaSpacing';

export const ActivityView: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const { events, isLoading, isLoadingMore, error, hasMore, loadMore, refetch } = useActivityFeed('all');
  const navigation = useNavigation<any>();

  const eventIds = useMemo(() => events.map(e => e.id), [events]);
  const { reactions, toggleReaction } = useReactions(eventIds);

  const renderItem = useCallback(({ item }: { item: ActivityEvent }) => (
    <ActivityEventCard
      event={item}
      reactions={reactions[item.id]}
      onToggleReaction={toggleReaction}
    />
  ), [reactions, toggleReaction]);

  const keyExtractor = useCallback((item: ActivityEvent) => item.id, []);

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

  // Refetch feed when returning from CreateActivityPost
  const didNavigateRef = React.useRef(false);

  const handleCreatePost = useCallback(() => {
    didNavigateRef.current = true;
    navigation.navigate('CreateActivityPost');
  }, [navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (didNavigateRef.current) {
        didNavigateRef.current = false;
        refetch();
      }
    });
    return unsubscribe;
  }, [navigation, refetch]);

  const fab = (
    <View
      style={[
        styles.fabWrapper,
        { bottom: getTabScreenBottomPadding(insets.bottom, 12) },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.fab}
        onPress={handleCreatePost}
        activeOpacity={0.8}
      >
        <Plus size={18} color={COLORS.primary} strokeWidth={2.5} />
        <Text style={styles.fabText}>New Post</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading && events.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        {fab}
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
        {fab}
      </View>
    );
  }

  return (
    <View style={styles.feedContainer}>
      <FlatList
        data={events}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
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
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: getTabScreenBottomPadding(insets.bottom) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && events.length > 0}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
      {fab}
    </View>
  );
});

const styles = StyleSheet.create({
  feedContainer: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  listContent: {
    paddingTop: 2,
  },

  /* ── FAB ── */
  fabWrapper: {
    position: 'absolute',
    right: SPACING.screenHorizontal,
    alignItems: 'flex-end',
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(122, 85, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.38)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  fabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.primary,
    letterSpacing: 0.1,
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
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
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
