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
  TextInput,
} from 'react-native';
import { UserPlus, Users, Search, Check, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useFriends } from '../../../backend/hooks/useFriends';
import { Friend, FriendRequest, SuggestedFriend } from '../../../backend/services/api/types';
import { FriendRow } from '../../components/ui/FriendRow';
import { getTabScreenBottomPadding } from '../../utils/safeAreaSpacing';

const FRIENDS_CARD_RADIUS = CARD_RADIUS - 2;

// ── Friend Request Row ───────────────────────────────────────

const RequestRow = memo(({
  request,
  onAccept,
  onDecline,
  isLast = false,
}: {
  request: FriendRequest;
  onAccept: (friendshipId: string) => void;
  onDecline: (friendshipId: string) => void;
  isLast?: boolean;
}) => (
  <View style={[styles.requestRow, !isLast && styles.cardRowDivider]}>
    <View style={styles.requestAvatar}>
      <Text style={styles.requestAvatarText}>
        {request.fromDisplayName.charAt(0).toUpperCase()}
      </Text>
    </View>
    <View style={styles.requestInfo}>
      <Text style={styles.requestName} numberOfLines={1}>
        {request.fromDisplayName}
      </Text>
      <Text style={styles.requestSubtitle}>Wants to connect</Text>
    </View>
    <TouchableOpacity
      style={[styles.requestAction, styles.requestAccept]}
      onPress={() => onAccept(request.friendshipId)}
      activeOpacity={0.7}
    >
      <Check size={15} color={COLORS.green} strokeWidth={2} />
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.requestAction, styles.requestDecline]}
      onPress={() => onDecline(request.friendshipId)}
      activeOpacity={0.7}
    >
      <X size={15} color={COLORS.textTertiary} strokeWidth={2} />
    </TouchableOpacity>
  </View>
));

// ── Suggested Friend Row ─────────────────────────────────────

const SuggestedRow = memo(({
  suggestion,
  onAdd,
  isLast = false,
}: {
  suggestion: SuggestedFriend;
  onAdd: (userId: string) => void;
  isLast?: boolean;
}) => (
  <View style={[styles.suggestedRow, !isLast && styles.cardRowDivider]}>
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
  const insets = useSafeAreaInsets();
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

  const handleFriendPress = useCallback((userId: string) => {
    navigation.navigate('FriendProfile', { userId });
  }, [navigation]);

  const handleAddSuggested = useCallback((userId: string) => {
    sendRequest(userId);
  }, [sendRequest]);

  const handleAcceptRequest = useCallback((friendshipId: string) => {
    respondToRequest(friendshipId, true);
  }, [respondToRequest]);

  const handleDeclineRequest = useCallback((friendshipId: string) => {
    respondToRequest(friendshipId, false);
  }, [respondToRequest]);

  const handleAddFriend = useCallback(() => {
    navigation.navigate('AddFriend');
  }, [navigation]);

  const renderFriend = useCallback(({ item, index }: { item: Friend; index: number }) => (
    <FriendRow
      friend={item}
      onPress={handleFriendPress}
      position={
        friends.length === 1
          ? 'single'
          : index === 0
            ? 'first'
            : index === friends.length - 1
              ? 'last'
              : 'middle'
      }
      isCurrentUser={item.displayName.toLowerCase() === 'you'}
    />
  ), [friends.length, handleFriendPress]);

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

      {pendingRequests.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Requests</Text>
            <View style={styles.requestCountBadge}>
              <Text style={styles.requestCountText}>{pendingRequests.length}</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.requestsList}
          >
            {pendingRequests.map((request, index) => (
              <RequestRow
                key={request.friendshipId}
                request={request}
                onAccept={handleAcceptRequest}
                onDecline={handleDeclineRequest}
                isLast={index === pendingRequests.length - 1}
              />
            ))}
          </LinearGradient>
        </View>
      )}

      {/* Suggested friends */}
      {suggestedFriends.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Suggested for you</Text>
            <TouchableOpacity onPress={handleAddFriend} activeOpacity={0.7}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.suggestedList}
          >
            {suggestedFriends.slice(0, 3).map((s, index) => (
              <SuggestedRow
                key={s.userId}
                suggestion={s}
                onAdd={handleAddSuggested}
                isLast={index === Math.min(suggestedFriends.length, 3) - 1}
              />
            ))}
          </LinearGradient>
        </View>
      )}

      {/* Friends header */}
      {friends.length > 0 && (
        <>
          <View style={styles.friendsHeader}>
            <Text style={styles.sectionLabelInline}>Your Friends</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.friendsMetricHeader}>This Week</Text>
            <Text style={styles.friendsMetricHeader}>Avg Form Score</Text>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.friendsList}
          >
            {friends.map((friend, index) => (
              <FriendRow
                key={friend.friendshipId}
                friend={friend}
                onPress={handleFriendPress}
                position={
                  friends.length === 1
                    ? 'single'
                    : index === 0
                      ? 'first'
                      : index === friends.length - 1
                        ? 'last'
                        : 'middle'
                }
                isCurrentUser={friend.displayName.toLowerCase() === 'you'}
              />
            ))}
          </LinearGradient>
        </>
      )}
    </View>
  ), [
    pendingRequests,
    suggestedFriends,
    friends,
    handleAcceptRequest,
    handleDeclineRequest,
    handleAddSuggested,
    handleAddFriend,
    handleFriendPress,
  ]);

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
        data={friends.length > 0 ? [] : friends}
        renderItem={renderFriend}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={friends.length === 0 ? (
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
        ) : null}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: getTabScreenBottomPadding(insets.bottom) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && friends.length > 0}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

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
    paddingTop: 0,
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SPACING.screenHorizontal,
    marginTop: 2,
    marginBottom: 9,
    paddingHorizontal: 12,
    height: 39,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
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
    marginBottom: 14,
    minHeight: 60,
    borderRadius: FRIENDS_CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingVertical: 10,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontFamily: FONTS.display.regular,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: 0,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  section: {
    paddingTop: 6,
    paddingBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 11.5,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  requestCountBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.28)',
  },
  requestCountText: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 10,
    color: COLORS.primary,
  },
  seeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.accent,
  },
  sectionLabelInline: {
    fontFamily: FONTS.display.regular,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: 0,
  },
  friendsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 8,
    gap: 14,
  },
  friendsMetricHeader: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  friendsList: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 10,
    borderRadius: FRIENDS_CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    ...CARD_SHADOW,
  },
  requestsList: {
    marginHorizontal: SPACING.screenHorizontal,
    borderRadius: FRIENDS_CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    ...CARD_SHADOW,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  requestAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.18)',
  },
  requestAvatarText: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
  },
  requestInfo: {
    flex: 1,
    marginLeft: 10,
  },
  requestName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13.5,
    color: COLORS.text,
  },
  requestSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  requestAction: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 7,
    borderWidth: 0.5,
  },
  requestAccept: {
    backgroundColor: 'rgba(52, 224, 166, 0.08)',
    borderColor: 'rgba(52, 224, 166, 0.2)',
  },
  requestDecline: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  suggestedList: {
    marginHorizontal: SPACING.screenHorizontal,
    borderRadius: FRIENDS_CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    ...CARD_SHADOW,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestedAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  suggestedAvatarText: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
  },
  suggestedInfo: {
    flex: 1,
    marginLeft: 10,
  },
  suggestedName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13.5,
    color: COLORS.text,
    marginBottom: 2,
  },
  suggestedMutual: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  followButton: {
    minWidth: 62,
    height: 31,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  followText: {
    fontFamily: FONTS.display.regular,
    fontSize: 12.5,
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
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
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
    borderWidth: 0.5,
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
    borderWidth: 0.5,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  retryText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.primary,
  },
});
