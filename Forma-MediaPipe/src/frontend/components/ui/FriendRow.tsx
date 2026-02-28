/**
 * FriendRow — Single row in the friends list
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { GitCompare } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
import { Friend } from '../../../backend/services/api/types';

interface FriendRowProps {
  friend: Friend;
  onCompare: (userId: string) => void;
  onPress: (userId: string) => void;
}

export const FriendRow: React.FC<FriendRowProps> = memo(({ friend, onCompare, onPress }) => {
  return (
    <TouchableOpacity
      style={styles.row}
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
          {friend.displayName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {friend.lastActive || `${friend.streakDays} day streak`}
        </Text>
      </View>

      <View style={styles.stats}>
        <Text style={[styles.formScore, { color: getScoreColor(friend.avgFormScore) }]}>
          {friend.avgFormScore.toFixed(1)}
        </Text>
        <Text style={styles.statLabel}>form</Text>
      </View>

      <TouchableOpacity
        style={styles.compareButton}
        onPress={() => onCompare(friend.userId)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <GitCompare size={16} color={COLORS.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.screenHorizontal,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
  },
  info: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
  },
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  stats: {
    alignItems: 'flex-end',
    marginRight: SPACING.md,
  },
  formScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  compareButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
});
