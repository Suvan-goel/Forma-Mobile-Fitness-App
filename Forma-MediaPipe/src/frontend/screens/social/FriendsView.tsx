/**
 * FriendsView — Friends tab content within SocialScreen
 */

import React, { memo, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import { UserPlus, Check, X, Users, Search } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW
} from '../../constants/theme';
import { useFriends } from '../../../backend/hooks';
import { Friend, FriendRequest, SuggestedFriend } from '../../../backend/services/api/types';
import { FriendRow } from '../../components/ui/FriendRow';

// ── Pending Requests Banner ───────────────────────────────────

const RequestItem = memo(({
  request,
  onAccept,
  onDecline,
}: {
  request: FriendRequest;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) => (
  <View style={styles.requestRow}>
    <View style={styles.requestAvatar}>
      <Text style={styles.requestAvatarText}>
        {request.fromDisplayName.charAt(0).toUpperCase()}
      </Text>
    </View>
    <View style={styles.requestInfo}>
      <Text style={styles.requestName} numberOfLines={1}>
        {request.fromDisplayName}
      </Text>
    </View>
    <TouchableOpacity
      style={styles.acceptButton}
      onPress={() => onAccept(request.friendshipId)}
      activeOpacity={0.7}
    >
      <Check size={16} color="#34D399" />
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.declineButton}
      onPress={() => onDecline(request.friendshipId)}
      activeOpacity={0.7}
    >
      <X size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  </View>
));

// ── Suggested Friend Row ─────────────────────────────────────

const SuggestedRow = memo(({
  suggestion,
  onAdd,
}: {
  suggestion: SuggestedFriend;
  onAdd: (userId: string) => void;
}) => (
  <View style={styles.suggestedRow}>
    <View style={styles.suggestedAvatar}>
      <Text style={styles.suggestedAvatarText}>
        {suggestion.displayName.charAt(0).toUpperCase()}
      </Text>
    </View>
    <View style={styles.suggestedInfo}>
      <Text style={styles.suggestedName} numberOfLines={1}>
        {suggestion.displayName}
      </Text>
      <Text style={styles.suggestedMutual}>
        {suggestion.mutualFriendCount} mutual friend{suggestion.mutualFriendCount === 1 ? '' : 's'}
      </Text>
    </View>
    <TouchableOpacity
      style={styles.followButton}
      onPress={() => onAdd(suggestion.userId)}
      activeOpacity={0.7}
    >
      <Text style={styles.followText}>Follow</Text>
    </TouchableOpacity>
  </View>
));

// ── Main View ─────────────────────────────────────────────────

export const FriendsView: React.FC = memo(() => {
  const navigation = useNavigation<any>();
  const {
    friends,
    pendingRequests,
    suggestedFriends,
    isLoading,
    error,
    refetch,
    sendRequest,
    respondToRequest,
  } = useFriends();

  const handleCompare = useCallback((userId: string) => {
    navigation.navigate('FriendComparison', { friendId: userId });
  }, [navigation]);

  const handleFriendPress = useCallback((userId: string) => {
    navigation.navigate('FriendProfile', { userId });
  }, [navigation]);

  const handleAccept = useCallback((friendshipId: string) => {
    respondToRequest(friendshipId, true);
  }, [respondToRequest]);

  const handleDecline = useCallback((friendshipId: string) => {
    respondToRequest(friendshipId, false);
  }, [respondToRequest]);

  const handleAddSuggested = useCallback((userId: string) => {
    sendRequest(userId);
  }, [sendRequest]);

  const handleAddFriend = useCallback(() => {
    navigation.navigate('AddFriend');
  }, [navigation]);

  const renderFriend = useCallback(({ item }: { item: Friend }) => (
    <FriendRow
      friend={item}
      onCompare={handleCompare}
      onPress={handleFriendPress}
    />
  ), [handleCompare, handleFriendPress]);

  const keyExtractor = useCallback((item: Friend) => item.friendshipId, []);

  const ListHeader = useMemo(() => (
    <View>
      <View style={styles.searchShell}>
        <Search size={14} color={COLORS.textTertiary} strokeWidth={1.6} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends"
          placeholderTextColor={COLORS.textTertiary}
          editable={false}
          pointerEvents="none"
        />
      </View>

      <LinearGradient
        colors={[...CARD_GRADIENT_ELEVATED]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.statsCard}
      >
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{friends.length}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{Math.max(friends.length * 2, pendingRequests.length)}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{pendingRequests.length}</Text>
          <Text style={styles.statLabel}>Requests</Text>
        </View>
      </LinearGradient>

      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>REQUESTS</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{pendingRequests.length}</Text>
            </View>
          </View>
          {pendingRequests.map(request => (
            <RequestItem
              key={request.friendshipId}
              request={request}
              onAccept={handleAccept}
              onDecline={handleDecline}
            />
          ))}
        </View>
      )}

      {/* Suggested friends */}
      {suggestedFriends.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>SUGGESTED FOR YOU</Text>
            <TouchableOpacity onPress={handleAddFriend} activeOpacity={0.7}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.suggestedList}>
            {suggestedFriends.slice(0, 3).map(s => (
              <SuggestedRow
                key={s.userId}
                suggestion={s}
                onAdd={handleAddSuggested}
              />
            ))}
          </View>
        </View>
      )}

      {/* Friends header */}
      {friends.length > 0 && (
        <View style={styles.friendsHeader}>
          <Text style={styles.sectionLabelInline}>FRIENDS</Text>
          <Text style={styles.friendsCount}>{friends.length}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.friendsMetricHeader}>Avg Form Score</Text>
        </View>
      )}
    </View>
  ), [pendingRequests, suggestedFriends, friends.length, handleAccept, handleDecline, handleAddSuggested, handleAddFriend]);

  if (isLoading && friends.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (error && friends.length === 0) {
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
    <View style={styles.container}>
      <FlatList
        data={friends}
        renderItem={renderFriend}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Users size={32} color={COLORS.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptySubtitle}>
              Add friends to compare stats and stay motivated
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddFriend} activeOpacity={0.8}>
              <UserPlus size={16} color={COLORS.primary} />
              <Text style={styles.addButtonText}>Add Friends</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && friends.length > 0}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      {friends.length > 0 && (
        <View style={styles.fabWrapper} pointerEvents="box-none">
          <TouchableOpacity style={styles.fab} onPress={handleAddFriend} activeOpacity={0.8}>
            <UserPlus size={16} color={COLORS.primary} />
            <Text style={styles.fabText}>Add Friend</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
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
    paddingBottom: 120,
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SPACING.screenHorizontal,
    marginTop: 4,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.text,
    padding: 0,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 12,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 13,
    ...CARD_SHADOW,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  section: {
    paddingTop: 8,
    paddingBottom: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  sectionLabelPadded: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  seeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.accent,
  },
  sectionLabelInline: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  countBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  countText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
  },
  friendsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  friendsCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  friendsMetricHeader: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  requestAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  requestAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
  },
  requestInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  requestName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
  },
  acceptButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  declineButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.xs,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  suggestedList: {
    marginHorizontal: SPACING.screenHorizontal,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  suggestedAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  suggestedAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
  },
  suggestedInfo: {
    flex: 1,
    marginLeft: 10,
  },
  suggestedName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12.5,
    color: COLORS.text,
    marginBottom: 2,
  },
  suggestedMutual: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  followButton: {
    minWidth: 58,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  followText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.text,
  },
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.xl,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.5)',
  },
  addButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.primary,
    letterSpacing: 0.3,
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
  fabWrapper: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.5)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  fabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
});
