/**
 * LeaderboardRow — Card-style row in the leaderboard list
 */

import React, { memo } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  getScoreColor,
} from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  isFirstRow?: boolean;
  isLastRow?: boolean;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = memo(({
  entry,
  isCurrentUser,
  isFirstRow = false,
  isLastRow = false,
}) => {
  const streakLabel = entry.streakDays && entry.streakDays > 0
    ? `${entry.streakDays} day${entry.streakDays === 1 ? '' : 's'} streak`
    : 'No streak yet';

  return (
    <View style={styles.rowOuter}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={[
          styles.rowGradient,
          isFirstRow && styles.rowTop,
          isLastRow && styles.rowBottom,
        ]}
      >
        <View style={[
          styles.rowEdge,
          !isLastRow && styles.rowDivider,
        ]}>
          <Text style={styles.rank}>
            {entry.rank}
          </Text>

          <View style={[styles.avatar, isCurrentUser && styles.avatarHighlight]}>
            {entry.avatarUrl ? (
              <Image source={{ uri: entry.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {entry.displayName.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>

          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {isCurrentUser ? 'You' : entry.displayName}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {streakLabel}
            </Text>
          </View>

          <View style={styles.stats}>
            <Text style={[styles.score, { color: getScoreColor(entry.score) }]}>
              {entry.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </View>
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
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  rowTop: {
    borderTopLeftRadius: CARD_RADIUS,
    borderTopRightRadius: CARD_RADIUS,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  rowBottom: {
    borderBottomLeftRadius: CARD_RADIUS,
    borderBottomRightRadius: CARD_RADIUS,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  rank: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    width: 26,
    textAlign: 'center',
    marginRight: 8,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  avatarHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderColor: 'rgba(139, 92, 246, 0.38)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
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
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  stats: {
    alignItems: 'flex-end',
    marginLeft: SPACING.sm,
    minWidth: 40,
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
  },
});
