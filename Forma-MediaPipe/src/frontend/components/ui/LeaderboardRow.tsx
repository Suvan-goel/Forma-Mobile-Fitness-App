/**
 * LeaderboardRow — Card-style row in the leaderboard list
 */

import React, { memo } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../../constants/theme';
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
  return (
    <View style={[
      styles.cardOuter,
      isFirstRow && styles.cardOuterFirst,
      isLastRow && styles.cardOuterLast,
    ]}>
      <LinearGradient
        colors={isCurrentUser ? ['#7B5CFF', '#694AE8', '#5639CA'] : ['rgba(25, 31, 35, 0.92)', 'rgba(13, 20, 24, 0.92)', 'rgba(8, 14, 17, 0.92)']}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={[
          styles.card,
          isFirstRow && styles.cardFirst,
          isLastRow && styles.cardLast,
        ]}
      >
        <View style={[
          styles.cardEdge,
          isCurrentUser && styles.cardEdgeHighlight,
          isFirstRow && styles.cardEdgeFirst,
          isLastRow && styles.cardEdgeLast,
        ]}>
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
          </View>

          <View style={styles.scoreContainer}>
            <Text style={[styles.score, isCurrentUser && styles.scoreHighlight]}>
              {entry.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </Text>
          </View>

          <Text style={[styles.streakColumn, isCurrentUser && styles.streakColumnHighlight]}>
            {entry.streakDays ?? '-'}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    borderRadius: 0,
    overflow: 'hidden',
  },
  cardOuterFirst: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  cardOuterLast: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  card: {
    borderRadius: 0,
  },
  cardFirst: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  cardLast: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  cardEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  cardEdgeFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  cardEdgeLast: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  cardEdgeHighlight: {
    borderColor: 'rgba(255, 255, 255, 0.075)',
  },
  rank: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
    width: 28,
    textAlign: 'center',
  },
  rankHighlight: {
    color: COLORS.text,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
    marginLeft: 9,
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.text,
  },
  nameHighlight: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  scoreContainer: {
    marginLeft: SPACING.sm,
    width: 76,
    alignItems: 'flex-end',
  },
  score: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.text,
  },
  scoreHighlight: {
    color: COLORS.text,
  },
  streakColumn: {
    width: 42,
    textAlign: 'center',
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  streakColumnHighlight: {
    color: COLORS.text,
  },
});
