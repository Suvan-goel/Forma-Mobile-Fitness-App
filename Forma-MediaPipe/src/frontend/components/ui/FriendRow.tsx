/**
 * FriendRow — Card-style row in the friends list
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor ,
} from '../../constants/theme';
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
  const isFirst = position === 'first' || position === 'single';
  const isLast = position === 'last' || position === 'single';

  return (
    <TouchableOpacity
      style={styles.rowOuter}
      onPress={() => onPress(friend.userId)}
      activeOpacity={0.7}
    >
      <LinearGradient
        colors={isCurrentUser ? ['rgba(122, 85, 255, 0.42)', 'rgba(122, 85, 255, 0.24)'] : [...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={[
          styles.rowGradient,
          isFirst && styles.rowTop,
          isLast && styles.rowBottom,
        ]}
      >
        <View style={[styles.rowEdge, !isLast && styles.rowDivider]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {friend.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* Info */}
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
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  rowOuter: {
    marginHorizontal: SPACING.screenHorizontal,
  },
  rowGradient: {
    backgroundColor: COLORS.cardBackground,
    overflow: 'hidden',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  rowTop: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.085)',
  },
  rowBottom: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.055)',
    marginBottom: 10,
  },
  rowEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.055)',
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
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
  },
  info: {
    flex: 1,
    marginLeft: 10,
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12.5,
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
    fontSize: 13,
  },
});
