/**
 * FriendRow — Card-style row in the friends list
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GitCompare, Flame } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor ,
  CARD_SHADOW
} from '../../constants/theme';
import { Friend } from '../../../backend/services/api/types';

interface FriendRowProps {
  friend: Friend;
  onCompare: (userId: string) => void;
  onPress: (userId: string) => void;
}

export const FriendRow: React.FC<FriendRowProps> = memo(({ friend, onCompare, onPress }) => {
  return (
    <TouchableOpacity
      style={styles.cardOuter}
      onPress={() => onPress(friend.userId)}
      activeOpacity={0.7}
    >
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.card}
      >
        <View style={styles.cardEdge}>
          {/* Avatar — circular */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {friend.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* Info */}
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {friend.displayName}
            </Text>
            <View style={styles.subtitleRow}>
              {friend.streakDays > 0 && (
                <>
                  <Flame size={11} color="#E07856" />
                  <Text style={styles.streakText}>{friend.streakDays}d</Text>
                </>
              )}
              {friend.lastActive && (
                <Text style={styles.subtitle}>{friend.lastActive}</Text>
              )}
            </View>
          </View>

          {/* Form score */}
          <View style={styles.stats}>
            <Text style={[styles.formScore, { color: getScoreColor(friend.avgFormScore) }]}>
              {friend.avgFormScore.toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>form</Text>
          </View>

          {/* Compare button */}
          <TouchableOpacity
            style={styles.compareButton}
            onPress={() => onCompare(friend.userId)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <GitCompare size={15} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 6,
    borderRadius: 18,

    ...CARD_SHADOW,
},
  card: {
    borderRadius: 18,

    ...CARD_SHADOW,
},
  cardEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
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
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  streakText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: '#E07856',
  },
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  stats: {
    alignItems: 'flex-end',
    marginRight: SPACING.sm,
  },
  formScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 15,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  compareButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
});
