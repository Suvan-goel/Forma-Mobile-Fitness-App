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
import { ArrowLeft, Search, UserPlus, Check, Clock } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_STYLE } from '../../constants/theme';
import { useUserSearch, useFriends } from '../../../backend/hooks';
import { UserSearchResult } from '../../../backend/services/api/types';

const StatusIndicator = memo(({ status }: { status: UserSearchResult['relationshipStatus'] }) => {
  switch (status) {
    case 'friends':
      return (
        <View style={[styles.statusBadge, { backgroundColor: 'rgba(52, 211, 153, 0.1)' }]}>
          <Check size={14} color="#34D399" />
          <Text style={[styles.statusText, { color: '#34D399' }]}>Friends</Text>
        </View>
      );
    case 'pending_sent':
      return (
        <View style={[styles.statusBadge, { backgroundColor: 'rgba(255, 255, 255, 0.05)' }]}>
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
  const { sendRequest, suggestedFriends } = useFriends();

  const handleAdd = useCallback(async (userId: string) => {
    await sendRequest(userId);
  }, [sendRequest]);

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
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => handleAdd(item.userId)}
          activeOpacity={0.7}
        >
          <UserPlus size={16} color={COLORS.text} />
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      ) : (
        <StatusIndicator status={item.relationshipStatus} />
      )}
    </View>
  ), [handleAdd]);

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
          <ArrowLeft size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Friends</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Search size={18} color={COLORS.textTertiary} />
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
                <Search size={40} color={COLORS.textTertiary} />
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
    padding: 4,
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
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
    paddingVertical: 12,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
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
    borderRadius: 8,
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
