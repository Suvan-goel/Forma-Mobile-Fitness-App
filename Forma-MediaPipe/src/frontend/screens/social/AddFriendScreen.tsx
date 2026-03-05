/**
 * AddFriendScreen — Search and add friends
 */

import React, { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Search, UserPlus, Check, Clock, Heart } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { useUserSearch, useFriends, useFollowing } from '../../../backend/hooks';
import { UserSearchResult } from '../../../backend/services/api/types';

const StatusIndicator = memo(({ status }: { status: UserSearchResult['relationshipStatus'] }) => {
  switch (status) {
    case 'friends':
      return (
        <View style={[styles.statusBadge, { backgroundColor: 'rgba(52, 211, 153, 0.08)', borderColor: 'rgba(52, 211, 153, 0.15)' }]}>
          <Check size={14} color="#34D399" />
          <Text style={[styles.statusText, { color: '#34D399' }]}>Friends</Text>
        </View>
      );
    case 'pending_sent':
      return (
        <View style={[styles.statusBadge, { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)' }]}>
          <Clock size={14} color={COLORS.textTertiary} />
          <Text style={[styles.statusText, { color: COLORS.textTertiary }]}>Pending</Text>
        </View>
      );
    default:
      return null;
  }
});

export const AddFriendScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  const { results, isLoading, error } = useUserSearch(query);
  const { sendRequest } = useFriends();
  const { followUser, unfollowUser, isFollowingUser } = useFollowing();

  const handleAdd = useCallback(async (userId: string) => {
    await sendRequest(userId);
  }, [sendRequest]);

  const handleToggleFollow = useCallback(async (userId: string) => {
    if (isFollowingUser(userId)) {
      await unfollowUser(userId);
    } else {
      await followUser(userId);
    }
  }, [isFollowingUser, unfollowUser, followUser]);

  const renderItem = useCallback(({ item }: { item: UserSearchResult }) => (
    <View style={styles.userRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>

      <View style={styles.userInfo}>
        <Text style={styles.userName} numberOfLines={1}>
          {item.displayName}
        </Text>
        {item.mutualFriendCount > 0 && (
          <Text style={styles.mutualText}>
            {item.mutualFriendCount} mutual friend{item.mutualFriendCount > 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {item.relationshipStatus === 'none' || item.relationshipStatus === 'pending_received' ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.followHeartBtn}
            onPress={() => handleToggleFollow(item.userId)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Heart
              size={18}
              color={isFollowingUser(item.userId) ? '#F472B6' : COLORS.textTertiary}
              fill={isFollowingUser(item.userId) ? '#F472B6' : 'none'}
              strokeWidth={1.8}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => handleAdd(item.userId)}
            activeOpacity={0.7}
          >
            <UserPlus size={15} color={COLORS.text} />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.followHeartBtn}
            onPress={() => handleToggleFollow(item.userId)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Heart
              size={18}
              color={isFollowingUser(item.userId) ? '#F472B6' : COLORS.textTertiary}
              fill={isFollowingUser(item.userId) ? '#F472B6' : 'none'}
              strokeWidth={1.8}
            />
          </TouchableOpacity>
          <StatusIndicator status={item.relationshipStatus} />
        </View>
      )}
    </View>
  ), [handleAdd, handleToggleFollow, isFollowingUser]);

  const keyExtractor = useCallback((item: UserSearchResult) => item.userId, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Friends</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Search size={16} color={COLORS.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name..."
          placeholderTextColor={COLORS.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Results */}
      {isLoading && query.length >= 2 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={
            query.length >= 2 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No users found</Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconContainer}>
                  <Search size={24} color={COLORS.textTertiary} />
                </View>
                <Text style={styles.emptyText}>Search for friends by name</Text>
                <Text style={styles.emptySubtext}>Type at least 2 characters</Text>
              </View>
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.screenHorizontal,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    padding: 0,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: SPACING.md,
    paddingBottom: 40,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  avatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
  },
  userInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  userName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 15,
    color: COLORS.text,
  },
  mutualText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  followHeartBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  addButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
  },
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: SPACING.xs,
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  emptySubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
