/**
 * LeaderboardRow — Card-style row in the leaderboard list
 */

import React, { memo } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor ,
  CARD_SHADOW
} from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
}

export const LeaderboardRow: React.FC<LeaderboardRowProps> = memo(({ entry, isCurrentUser }) => {
  const TrendIcon = entry.trend === 'up' ? TrendingUp : entry.trend === 'down' ? TrendingDown : Minus;
  const trendColor = entry.trend === 'up' ? '#34E0A6' : entry.trend === 'down' ? '#E07856' : COLORS.textTertiary;
  const trendLabel = entry.trend === 'up' ? 'Up' : entry.trend === 'down' ? 'Down' : 'Flat';

  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={isCurrentUser ? ['#7254F4', '#5A3ED4', '#4B32B8'] : [...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.card}
      >
        <View style={[styles.cardEdge, isCurrentUser && styles.cardEdgeHighlight]}>
          <Text style={[styles.rank, isCurrentUser && styles.rankHighlight]}>
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

          <View style={styles.nameContainer}>
            <Text style={[styles.name, isCurrentUser && styles.nameHighlight]} numberOfLines={1}>
              {isCurrentUser ? 'You' : entry.displayName}
            </Text>
            <View style={styles.trendRow}>
              <TrendIcon size={12} color={trendColor} />
              <Text style={[styles.trendLabel, { color: trendColor }]}>
                {trendLabel}
              </Text>
            </View>
          </View>

          <View style={styles.scoreContainer}>
            <Text style={[styles.score, isCurrentUser ? styles.scoreHighlight : { color: getScoreColor(entry.score) }]}>
              {entry.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </Text>
          </View>

          <Text style={[styles.trendColumn, isCurrentUser && styles.trendColumnHighlight]}>
            {entry.trend === 'up' ? '↗' : entry.trend === 'down' ? '↘' : '–'}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 5,
    borderRadius: 10,

    ...CARD_SHADOW,
},
  card: {
    borderRadius: 10,

    ...CARD_SHADOW,
},
  cardEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  cardEdgeHighlight: {
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  rank: {
    fontFamily: FONTS.mono.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
    width: 26,
  },
  rankHighlight: {
    color: COLORS.text,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarHighlight: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
  },
  nameContainer: {
    flex: 1,
    marginLeft: 10,
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
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
    fontSize: 10,
  },
  scoreContainer: {
    marginLeft: SPACING.sm,
    width: 72,
    alignItems: 'flex-end',
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 13,
  },
  scoreHighlight: {
    color: COLORS.text,
  },
  trendColumn: {
    width: 34,
    textAlign: 'right',
    fontFamily: FONTS.mono.bold,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  trendColumnHighlight: {
    color: COLORS.text,
  },
});
