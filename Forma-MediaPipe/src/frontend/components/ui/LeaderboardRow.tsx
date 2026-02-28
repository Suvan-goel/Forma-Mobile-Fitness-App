/**
 * LeaderboardRow — Single row in the leaderboard list
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  metricLabel?: string;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = memo(({ entry, isCurrentUser, metricLabel }) => {
  const TrendIcon = entry.trend === 'up' ? TrendingUp : entry.trend === 'down' ? TrendingDown : Minus;
  const trendColor = entry.trend === 'up' ? '#34D399' : entry.trend === 'down' ? '#E07856' : COLORS.textTertiary;

  return (
    <View style={[styles.row, isCurrentUser && styles.rowHighlight]}>
      <View style={styles.rankContainer}>
        <Text style={[styles.rank, isCurrentUser && styles.rankHighlight]}>
          {entry.rank}
        </Text>
      </View>

      <View style={styles.avatarContainer}>
        <View style={[styles.avatar, isCurrentUser && styles.avatarHighlight]}>
          <Text style={styles.avatarText}>
            {entry.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.nameContainer}>
        <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
          {entry.displayName}
        </Text>
      </View>

      <View style={styles.scoreContainer}>
        <Text style={[styles.score, { color: getScoreColor(entry.score) }]}>
          {entry.score.toFixed(1)}
        </Text>
      </View>

      <View style={styles.trendContainer}>
        <TrendIcon size={14} color={trendColor} />
      </View>
    </View>
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
  rowHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
  },
  rankContainer: {
    width: 32,
    alignItems: 'center',
  },
  rank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  rankHighlight: {
    color: COLORS.primary,
  },
  avatarContainer: {
    marginLeft: SPACING.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  avatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
  },
  nameContainer: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  name: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  nameHighlight: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  scoreContainer: {
    marginLeft: SPACING.sm,
    minWidth: 48,
    alignItems: 'flex-end',
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
  },
  trendContainer: {
    marginLeft: SPACING.sm,
    width: 20,
    alignItems: 'center',
  },
});
