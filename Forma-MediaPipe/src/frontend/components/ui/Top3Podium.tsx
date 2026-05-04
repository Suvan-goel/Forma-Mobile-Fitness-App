/**
 * Top3Podium — Podium display for top 3 leaderboard entries
 */

import React, { memo } from 'react';
import { Image, View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Crown } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface Top3PodiumProps {
  entries: LeaderboardEntry[];
}

const PODIUM_COLORS = ['#F5A623', '#A1A1AA', '#CD7F32']; // Gold, Silver, Bronze
const PODIUM_GRADIENTS: [string, string, string][] = [
  ['rgba(244, 164, 38, 0.16)', 'rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.018)'],
  ['rgba(255, 255, 255, 0.070)', 'rgba(255, 255, 255, 0.038)', 'rgba(255, 255, 255, 0.016)'],
  ['rgba(205, 127, 50, 0.13)', 'rgba(255, 255, 255, 0.044)', 'rgba(255, 255, 255, 0.016)'],
];
const PODIUM_HEIGHTS = [150, 124, 124];

const PodiumItem = memo(({ entry, index }: { entry: LeaderboardEntry; index: number }) => {
  const isFirst = index === 0;
  const podiumColor = PODIUM_COLORS[index];
  const podiumHeight = PODIUM_HEIGHTS[index];
  const gradient = PODIUM_GRADIENTS[index];

  return (
    <View style={[styles.podiumItem, isFirst && styles.podiumItemFirst]}>
      <View style={[
        styles.avatarDock,
        { bottom: podiumHeight + 10 },
        isFirst && Platform.OS === 'ios' && {
          shadowColor: podiumColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.42,
          shadowRadius: 14,
        },
      ]}>
        <View style={[styles.avatar, isFirst && styles.avatarFirst, { borderColor: podiumColor }]}>
          {entry.avatarUrl ? (
            <Image source={{ uri: entry.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={[styles.avatarText, isFirst && styles.avatarTextFirst]}>
              {entry.displayName.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        {isFirst && (
          <View style={styles.crownContainer}>
            <Crown size={14} color="#F5A623" fill="#F5A623" />
          </View>
        )}
      </View>

      <LinearGradient
        colors={gradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[styles.card, { height: podiumHeight }, isFirst && styles.cardFirst]}
      >
        <View style={[styles.cardEdge, { borderColor: `${podiumColor}45` }, isFirst && styles.cardEdgeFirst]}>
          <View style={[styles.rankBadge, { backgroundColor: podiumColor }]}>
            <Text style={[styles.rankBadgeText, index === 1 && styles.rankBadgeTextDark]}>
              {entry.rank}
            </Text>
          </View>

          <Text style={[styles.name, isFirst && styles.nameFirst]} numberOfLines={1}>
            {entry.displayName}
          </Text>
          <Text style={styles.score}>
            {entry.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </Text>
          <Text style={styles.pointsLabel}>pts</Text>
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
    paddingTop: 96,
    paddingBottom: 6,
    gap: 5,
  },
  podiumItem: {
    flex: 1,
    alignItems: 'stretch',
  },
  podiumItemFirst: {
    flex: 1.06,
  },
  card: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  cardFirst: {
    backgroundColor: 'rgba(245, 166, 35, 0.075)',
  },
  cardEdge: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 16,
    paddingBottom: 11,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
  },
  cardEdgeFirst: {
    paddingTop: 18,
    paddingBottom: 13,
  },
  avatarDock: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 2,
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  avatarFirst: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontFamily: FONTS.display.medium,
    fontSize: 20,
    color: COLORS.text,
  },
  avatarTextFirst: {
    fontSize: 23,
  },
  crownContainer: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  rankBadgeText: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: '#11181D',
  },
  rankBadgeTextDark: {
    color: '#1E2225',
  },
  name: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 5,
  },
  nameFirst: {
    fontSize: 12,
  },
  score: {
    fontFamily: FONTS.ui.regular,
    fontSize: 19,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 1,
  },
  pointsLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
});
