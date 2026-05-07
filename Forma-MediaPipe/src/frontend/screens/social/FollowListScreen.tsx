/**
 * FollowListScreen — Displays followers or following list
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { ChevronLeft, UserPlus, Users } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, PAGE_TITLE_TEXT, SPACING } from '../../constants/theme';
import { useFollowing } from '../../../backend/hooks/useFollowing';
import type { FollowRelation } from '../../../backend/services/api/types';
import type { RootStackParamList } from '../../app/RootNavigator';
import { getBottomOverlayPadding } from '../../utils/safeAreaSpacing';

type FollowListNavProp = NativeStackNavigationProp<RootStackParamList>;
type FollowListRouteProp = RouteProp<RootStackParamList, 'FollowList'>;

export const FollowListScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<FollowListNavProp>();
  const route = useRoute<FollowListRouteProp>();
  const { mode } = route.params;

  const {
    followers,
    following,
    isLoading,
    followUser,
    unfollowUser,
    isFollowingUser,
  } = useFollowing();

  const data = mode === 'followers' ? followers : following;
  const title = mode === 'followers' ? 'Followers' : 'Following';

  const handleUserPress = useCallback((userId: string) => {
    navigation.navigate('FriendProfile', { userId });
  }, [navigation]);

  const handleToggleFollow = useCallback(async (userId: string) => {
    if (isFollowingUser(userId)) {
      await unfollowUser(userId);
    } else {
      await followUser(userId);
    }
  }, [isFollowingUser, unfollowUser, followUser]);

  const renderItem = useCallback(({ item }: { item: FollowRelation }) => {
    const initial = item.displayName.charAt(0).toUpperCase();
    const isFollowed = isFollowingUser(item.userId);

    return (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => handleUserPress(item.userId)}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <LinearGradient
              colors={['#9F75FF', '#633FE5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </LinearGradient>
          )}
        </View>

        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.displayName}
          </Text>
        </View>

        {mode === 'followers' ? (
          <TouchableOpacity
            style={[styles.followBtn, isFollowed && styles.followBtnActive]}
            onPress={() => handleToggleFollow(item.userId)}
            activeOpacity={0.7}
          >
            {isFollowed ? (
              <Text style={styles.followBtnTextActive}>Following</Text>
            ) : (
              <>
                <UserPlus size={13} color={COLORS.text} strokeWidth={2} />
                <Text style={styles.followBtnText}>Follow</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.unfollowBtn}
            onPress={() => unfollowUser(item.userId)}
            activeOpacity={0.7}
          >
            <Text style={styles.unfollowBtnText}>Unfollow</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }, [mode, isFollowingUser, handleToggleFollow, unfollowUser, handleUserPress]);

  const keyExtractor = useCallback((item: FollowRelation) => item.userId, []);

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
        <Text style={styles.headerTitle}>{title.toUpperCase()}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Users size={24} color={COLORS.textTertiary} />
              </View>
              <Text style={styles.emptyText}>
                {mode === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </Text>
            </View>
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, 32) },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    ...PAGE_TITLE_TEXT,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: SPACING.sm,
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
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.display.regular,
    fontSize: 18,
    color: COLORS.text,
  },
  userInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  userName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.text,
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  followBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  followBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  followBtnTextActive: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  unfollowBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  unfollowBtnText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
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
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: SPACING.xs,
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
});
