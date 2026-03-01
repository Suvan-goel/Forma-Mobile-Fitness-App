/**
 * FriendsView — Friends tab content within SocialScreen
 */

import React, { memo, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { UserPlus, Check, X, Users } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
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

// ── Suggested Friend Card ─────────────────────────────────────

const SuggestedCard = memo(({
  suggestion,
  onAdd,
}: {
  suggestion: SuggestedFriend;
  onAdd: (userId: string) => void;
}) => (
  <LinearGradient
    colors={[...CARD_GRADIENT_COLORS]}
    start={CARD_GRADIENT_START}
    end={CARD_GRADIENT_END}
    style={styles.suggestedGradient}
  >
    <View style={styles.suggestedCard}>
      <View style={styles.suggestedAvatar}>
        <Text style={styles.suggestedAvatarText}>
          {suggestion.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text style={styles.suggestedName} numberOfLines={1}>
        {suggestion.displayName}
      </Text>
      <Text style={styles.suggestedMutual}>
        {suggestion.mutualFriendCount} mutual
      </Text>
      <TouchableOpacity
        style={styles.addSmallButton}
        onPress={() => onAdd(suggestion.userId)}
        activeOpacity={0.7}
      >
        <UserPlus size={14} color={COLORS.primary} />
      </TouchableOpacity>
    </View>
  </LinearGradient>
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
          <Text style={styles.sectionLabelPadded}>PEOPLE YOU MAY KNOW</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestedScroll}
          >
            {suggestedFriends.map(s => (
              <SuggestedCard
                key={s.userId}
                suggestion={s}
                onAdd={handleAddSuggested}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Friends header */}
      {friends.length > 0 && (
        <View style={styles.friendsHeader}>
          <Text style={styles.sectionLabelInline}>FRIENDS</Text>
          <Text style={styles.friendsCount}>{friends.length}</Text>
        </View>
      )}
    </View>
  ), [pendingRequests, suggestedFriends, friends.length, handleAccept, handleDecline, handleAddSuggested]);

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
            <Users size={48} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptySubtitle}>
              Add friends to compare stats and stay motivated
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddFriend} activeOpacity={0.7}>
              <UserPlus size={18} color={COLORS.text} />
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
        <TouchableOpacity style={styles.fab} onPress={handleAddFriend} activeOpacity={0.7}>
          <UserPlus size={22} color={COLORS.text} />
        </TouchableOpacity>
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
    paddingBottom: 120,
  },
  section: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  sectionLabelPadded: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  sectionLabelInline: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  countBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
  },
  friendsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    gap: SPACING.sm,
  },
  friendsCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  requestAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.25)',
  },
  declineButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.xs,
  },
  suggestedScroll: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: SPACING.sm,
  },
  suggestedGradient: {
    borderRadius: 19,
  },
  suggestedCard: {
    width: 120,
    padding: SPACING.md,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  suggestedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  suggestedAvatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
  },
  suggestedName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  suggestedMutual: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  addSmallButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
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
    marginTop: SPACING.md,
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
    gap: SPACING.sm,
    marginTop: SPACING.xl,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  addButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
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
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 19,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  retryText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.primary,
  },
  fab: {
    position: 'absolute',
    bottom: 100,
    right: SPACING.xl,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
});
