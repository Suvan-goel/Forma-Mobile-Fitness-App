/**
 * FriendRow — Row inside the grouped friends list card
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { COLORS, FONTS, getScoreColor } from '../../constants/theme';
import { Friend } from '../../../backend/services/api/types';

interface FriendRowProps {
  friend: Friend;
  onPress: (userId: string) => void;
  position?: 'single' | 'first' | 'middle' | 'last';
  isCurrentUser?: boolean;
}

export const FriendRow: React.FC<FriendRowProps> = memo(({
  friend,
  onPress,
  position = 'single',
  isCurrentUser = false,
}) => {
  const isLast = position === 'last' || position === 'single';

  return (
    <TouchableOpacity
      style={[styles.row, !isLast && styles.rowDivider]}
      onPress={() => onPress(friend.userId)}
      activeOpacity={0.7}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {friend.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {isCurrentUser ? 'You' : friend.displayName}
        </Text>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitle}>
            {friend.streakDays > 0 ? `${friend.streakDays} workout${friend.streakDays === 1 ? '' : 's'}` : friend.lastActive ?? 'Active recently'}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Text style={[styles.formScore, { color: getScoreColor(friend.avgFormScore) }]}>
          {Math.round(friend.avgFormScore)}
        </Text>
      </View>

      <ChevronRight size={15} color={isCurrentUser ? 'rgba(255,255,255,0.6)' : COLORS.textTertiary} strokeWidth={1.8} />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  avatarText: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  info: {
    flex: 1,
    marginLeft: 10,
  },
  name: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13.5,
    color: COLORS.text,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
  },
  stats: {
    alignItems: 'flex-end',
    marginRight: 6,
    minWidth: 34,
  },
  formScore: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
  },
});
