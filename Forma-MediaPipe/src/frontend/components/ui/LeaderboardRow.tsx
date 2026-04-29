/**
 * LeaderboardRow — Card-style row in the leaderboard list
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = memo(({ entry, isCurrentUser }) => {
  const TrendIcon = entry.trend === 'up' ? TrendingUp : entry.trend === 'down' ? TrendingDown : Minus;
  const trendColor = entry.trend === 'up' ? '#34D399' : entry.trend === 'down' ? '#E07856' : COLORS.textTertiary;

  return (
    <View style={[
      styles.cardOuter,
      isCurrentUser && styles.cardOuterHighlight,
      isCurrentUser && Platform.OS === 'ios' && {
        shadowColor: '#7C5CFF',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
    ]}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.card}
      >
        <View style={[styles.cardEdge, isCurrentUser && styles.cardEdgeHighlight]}>
          {/* Rank badge */}
          <Text style={[styles.rank, isCurrentUser && styles.rankHighlight]}>
            {entry.rank}
          </Text>

          {/* Avatar */}
          <View style={[styles.avatar, isCurrentUser && styles.avatarHighlight]}>
            <Text style={styles.avatarText}>
              {entry.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* Name + trend */}
          <View style={styles.nameContainer}>
            <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
              {isCurrentUser ? 'You' : entry.displayName}
            </Text>
            <View style={styles.trendRow}>
              <TrendIcon size={12} color={trendColor} />
              <Text style={[styles.trendLabel, { color: trendColor }]}>
                {entry.trend === 'up' ? 'Rising' : entry.trend === 'down' ? 'Falling' : 'Steady'}
              </Text>
            </View>
          </View>

          {/* Score */}
          <View style={styles.scoreContainer}>
            <Text style={[styles.score, { color: getScoreColor(entry.score) }]}>
              {entry.score.toFixed(1)}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 6,
    borderRadius: 18,
    overflow: 'hidden',
  },
  cardOuterHighlight: {},
  card: {
    borderRadius: 18,
  },
  cardEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardEdgeHighlight: {
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  rank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  rankHighlight: {
    color: COLORS.primary,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  avatarHighlight: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  avatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
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
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  trendLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
  },
  scoreContainer: {
    marginLeft: SPACING.sm,
    minWidth: 48,
    alignItems: 'flex-end',
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
  },
});
