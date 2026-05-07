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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Search, UserPlus, Check, Clock, Heart, X, Users } from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  PAGE_TITLE_TEXT,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_START,
  SCREEN_GRADIENT_END,
} from '../../constants/theme';
import { useFollowing } from '../../../backend/hooks/useFollowing';
import { useFriends } from '../../../backend/hooks/useFriends';
import { useUserSearch } from '../../../backend/hooks/useUserSearch';
import { UserSearchResult } from '../../../backend/services/api/types';
import { getBottomOverlayPadding } from '../../utils/safeAreaSpacing';

const StatusIndicator = memo(({ status }: { status: UserSearchResult['relationshipStatus'] }) => {
  switch (status) {
    case 'friends':
      return (
        <View style={[styles.statusBadge, styles.statusBadgeSuccess]}>
          <Check size={13} color={COLORS.green} strokeWidth={2} />
          <Text style={[styles.statusText, { color: COLORS.green }]}>Friends</Text>
        </View>
      );
    case 'pending_sent':
      return (
        <View style={[styles.statusBadge, styles.statusBadgeMuted]}>
          <Clock size={13} color={COLORS.textTertiary} strokeWidth={1.8} />
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
  const hasSearchTerm = query.trim().length >= 2;

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
    <TouchableOpacity style={styles.userRowOuter} activeOpacity={0.78}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.userRow}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={styles.mutualText}>
            {item.mutualFriendCount > 0
              ? `${item.mutualFriendCount} mutual friend${item.mutualFriendCount > 1 ? 's' : ''}`
              : 'Forma member'}
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.followHeartBtn, isFollowingUser(item.userId) && styles.followHeartBtnActive]}
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

          {item.relationshipStatus === 'none' || item.relationshipStatus === 'pending_received' ? (
            <TouchableOpacity
              onPress={() => handleAdd(item.userId)}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.addButton}
              >
                <UserPlus size={14} color={COLORS.text} strokeWidth={2} />
                <Text style={styles.addButtonText}>Add</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <StatusIndicator status={item.relationshipStatus} />
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  ), [handleAdd, handleToggleFollow, isFollowingUser]);

  const keyExtractor = useCallback((item: UserSearchResult) => item.userId, []);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>ADD FRIENDS</Text>
          <Text style={styles.headerSubtitle}>Find people training on Forma</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.introCard}>
        <View style={styles.introIcon}>
          <Users size={18} color={COLORS.accent} strokeWidth={1.7} />
        </View>
        <View style={styles.introTextWrap}>
          <Text style={styles.introTitle}>Grow your training circle</Text>
          <Text style={styles.introText}>Search by name, follow progress, and send friend requests.</Text>
        </View>
      </View>

      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.searchGradient}
      >
        <View style={styles.searchContainer}>
          <Search size={16} color={COLORS.textTertiary} strokeWidth={1.7} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name"
            placeholderTextColor={COLORS.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              style={styles.clearSearchButton}
              onPress={() => setQuery('')}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={14} color={COLORS.textTertiary} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {error && hasSearchTerm && (
        <Text style={styles.inlineError}>{error}</Text>
      )}

      {isLoading && hasSearchTerm ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={
            results.length > 0 ? (
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsTitle}>Results</Text>
                <Text style={styles.resultsCount}>{results.length}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            hasSearchTerm ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconContainer}>
                  <Search size={22} color={COLORS.textTertiary} strokeWidth={1.6} />
                </View>
                <Text style={styles.emptyText}>No users found</Text>
                <Text style={styles.emptySubtext}>Try a different name</Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconContainer}>
                  <UserPlus size={24} color={COLORS.textTertiary} strokeWidth={1.6} />
                </View>
                <Text style={styles.emptyText}>Find people on Forma</Text>
                <Text style={styles.emptySubtext}>Type at least 2 characters</Text>
              </View>
            )
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, 40) },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </LinearGradient>
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
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  headerTitle: {
    ...PAGE_TITLE_TEXT,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(31, 39, 45, 0.58)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  introIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.18)',
    marginRight: 11,
  },
  introTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  introTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  introText: {
    marginTop: 3,
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  searchGradient: {
    gap: 9,
    marginHorizontal: SPACING.screenHorizontal,
    borderRadius: 8,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 48,
    paddingHorizontal: 13,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
  },
  clearSearchButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  inlineError: {
    marginHorizontal: SPACING.screenHorizontal,
    marginTop: 10,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.orange,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: 16,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 9,
  },
  resultsTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  resultsCount: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 10,
    color: COLORS.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
  },
  userRowOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 10,
    borderRadius: 8,
    ...CARD_SHADOW,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 70,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.18)',
  },
  avatarText: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
  },
  userInfo: {
    flex: 1,
    marginLeft: 11,
    minWidth: 0,
  },
  userName: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  mutualText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  followHeartBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  followHeartBtnActive: {
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
    borderColor: 'rgba(244, 114, 182, 0.18)',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 68,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addButtonText: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  statusBadgeSuccess: {
    backgroundColor: 'rgba(52, 224, 166, 0.08)',
    borderColor: 'rgba(52, 224, 166, 0.18)',
  },
  statusBadgeMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  statusText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
  },
  emptyContainer: {
    marginHorizontal: SPACING.screenHorizontal,
    marginTop: 34,
    paddingHorizontal: 20,
    paddingVertical: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(31, 39, 45, 0.42)',
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.085)',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.16)',
    marginBottom: SPACING.xs,
  },
  emptyText: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  emptySubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
