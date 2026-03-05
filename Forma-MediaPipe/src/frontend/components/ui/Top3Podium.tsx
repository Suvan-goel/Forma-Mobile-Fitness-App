/**
 * Top3Podium — Podium display for top 3 leaderboard entries
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Crown } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface Top3PodiumProps {
  entries: LeaderboardEntry[];
}

const PODIUM_COLORS = ['#F5A623', '#A1A1AA', '#CD7F32']; // Gold, Silver, Bronze
const PODIUM_GRADIENTS: [string, string][] = [
  ['rgba(245, 166, 35, 0.12)', 'rgba(245, 166, 35, 0.03)'],
  ['rgba(161, 161, 170, 0.10)', 'rgba(161, 161, 170, 0.02)'],
  ['rgba(205, 127, 50, 0.10)', 'rgba(205, 127, 50, 0.02)'],
];
const PODIUM_HEIGHTS = [110, 88, 72];

const PodiumItem = memo(({ entry, index }: { entry: LeaderboardEntry; index: number }) => {
  const isFirst = index === 0;
  const podiumColor = PODIUM_COLORS[index];
  const podiumHeight = PODIUM_HEIGHTS[index];
  const gradient = PODIUM_GRADIENTS[index];

  return (
    <View style={[styles.podiumItem, isFirst && styles.podiumItemFirst]}>
      {/* Avatar — circular */}
      <View style={[
        styles.avatarOuter,
        isFirst && Platform.OS === 'ios' && {
          shadowColor: podiumColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 16,
        },
      ]}>
        <LinearGradient
          colors={[`${podiumColor}30`, `${podiumColor}10`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.avatar, isFirst && styles.avatarFirst, { borderColor: podiumColor }]}
        >
          <Text style={[styles.avatarText, isFirst && styles.avatarTextFirst]}>
            {entry.displayName.charAt(0).toUpperCase()}
          </Text>
        </LinearGradient>
        {isFirst && (
          <View style={styles.crownContainer}>
            <Crown size={16} color="#F5A623" fill="#F5A623" />
          </View>
        )}
      </View>

      {/* Name */}
      <Text style={[styles.name, isFirst && styles.nameFirst]} numberOfLines={1}>
        {entry.displayName}
      </Text>

      {/* Score */}
      <Text style={[styles.score, { color: getScoreColor(entry.score) }]}>
        {entry.score.toFixed(1)}
      </Text>

      {/* Podium base */}
      <LinearGradient
        colors={gradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.podiumBase, { height: podiumHeight }]}
      >
        <View style={[styles.podiumBorder, { borderColor: `${podiumColor}20` }]}>
          <Text style={[styles.rankText, { color: podiumColor }]}>
            {entry.rank}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
});

export const Top3Podium: React.FC<Top3PodiumProps> = memo(({ entries }) => {
  if (entries.length < 3) return null;

  // Reorder: [2nd, 1st, 3rd] for visual layout
  const ordered = [entries[1], entries[0], entries[2]];

  return (
    <View style={styles.container}>
      {ordered.map((entry, i) => (
        <PodiumItem key={entry.userId} entry={entry} index={i === 0 ? 1 : i === 1 ? 0 : 2} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  podiumItem: {
    flex: 1,
    alignItems: 'center',
  },
  podiumItemFirst: {
    marginTop: -8,
  },
  avatarOuter: {
    marginBottom: SPACING.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarFirst: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  avatarTextFirst: {
    fontSize: 22,
  },
  crownContainer: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
  },
  name: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 2,
  },
  nameFirst: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 15,
    marginBottom: SPACING.sm,
  },
  podiumBase: {
    width: '100%',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: 'hidden',
  },
  podiumBorder: {
    flex: 1,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 1,
    borderBottomWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
  },
});
