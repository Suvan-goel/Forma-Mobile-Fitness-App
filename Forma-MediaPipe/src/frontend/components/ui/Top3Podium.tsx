/**
 * Top3Podium — Visual podium for the top 3 leaderboard entries
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface Top3PodiumProps {
  entries: LeaderboardEntry[];
}

const PODIUM_COLORS = ['#F5A623', '#A1A1AA', '#CD7F32']; // Gold, Silver, Bronze
const PODIUM_HEIGHTS = [100, 80, 68]; // Heights for 1st, 2nd, 3rd

const PodiumItem = memo(({ entry, index }: { entry: LeaderboardEntry; index: number }) => {
  const isFirst = index === 0;
  const podiumColor = PODIUM_COLORS[index];
  const podiumHeight = PODIUM_HEIGHTS[index];

  return (
    <View style={styles.podiumItem}>
      {/* Avatar */}
      <View style={[styles.avatar, isFirst && styles.avatarFirst, { borderColor: podiumColor }]}>
        <Text style={styles.avatarText}>
          {entry.displayName.charAt(0).toUpperCase()}
        </Text>
        {isFirst && (
          <View style={styles.crownContainer}>
            <Crown size={14} color="#F5A623" fill="#F5A623" />
          </View>
        )}
      </View>

      {/* Name */}
      <Text style={styles.name} numberOfLines={1}>
        {entry.displayName}
      </Text>

      {/* Score */}
      <Text style={[styles.score, { color: getScoreColor(entry.score) }]}>
        {entry.score.toFixed(1)}
      </Text>

      {/* Podium base */}
      <View style={[styles.podiumBase, { height: podiumHeight, backgroundColor: `${podiumColor}15` }]}>
        <Text style={[styles.rankText, { color: podiumColor }]}>
          {entry.rank}
        </Text>
      </View>
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
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    gap: SPACING.md,
  },
  podiumItem: {
    flex: 1,
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: SPACING.xs,
  },
  avatarFirst: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  crownContainer: {
    position: 'absolute',
    top: -12,
  },
  name: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    marginBottom: SPACING.sm,
  },
  podiumBase: {
    width: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
  },
});
