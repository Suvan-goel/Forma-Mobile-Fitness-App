/**
 * Top3Podium — Podium display for top 3 leaderboard entries
 */

import React, { memo } from 'react';
import { Image, View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Crown } from 'lucide-react-native';
import { COLORS, FONTS, SPACING ,
  CARD_SHADOW
} from '../../constants/theme';
import { LeaderboardEntry } from '../../../backend/services/api/types';

interface Top3PodiumProps {
  entries: LeaderboardEntry[];
}

const PODIUM_COLORS = ['#F5A623', '#A1A1AA', '#CD7F32']; // Gold, Silver, Bronze
const PODIUM_GRADIENTS: [string, string][] = [
  ['rgba(255, 255, 255, 0.075)', 'rgba(255, 255, 255, 0.025)'],
  ['rgba(255, 255, 255, 0.060)', 'rgba(255, 255, 255, 0.020)'],
  ['rgba(255, 255, 255, 0.060)', 'rgba(255, 255, 255, 0.020)'],
];
const PODIUM_HEIGHTS = [214, 176, 176];

const PodiumItem = memo(({ entry, index }: { entry: LeaderboardEntry; index: number }) => {
  const isFirst = index === 0;
  const podiumColor = PODIUM_COLORS[index];
  const podiumHeight = PODIUM_HEIGHTS[index];
  const gradient = PODIUM_GRADIENTS[index];

  return (
    <View style={[styles.podiumItem, isFirst && styles.podiumItemFirst]}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[styles.card, { height: podiumHeight }, isFirst && styles.cardFirst]}
      >
        <View style={[styles.cardEdge, { borderColor: `${podiumColor}35` }, isFirst && styles.cardEdgeFirst]}>
          <View style={[
            styles.avatarOuter,
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
    paddingTop: 14,
    paddingBottom: 0,
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
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',

    ...CARD_SHADOW,
},
  cardFirst: {
    backgroundColor: 'rgba(245, 166, 35, 0.08)',
  },
  cardEdge: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  cardEdgeFirst: {
    paddingTop: 18,
  },
  avatarOuter: {
    marginBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  avatarFirst: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
  },
  avatarTextFirst: {
    fontSize: 24,
  },
  crownContainer: {
    position: 'absolute',
    top: -11,
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
    fontSize: 16,
    color: '#11181D',
  },
  rankBadgeTextDark: {
    color: '#2A3136',
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 5,
  },
  nameFirst: {
    fontSize: 13,
  },
  score: {
    fontFamily: FONTS.mono.bold,
    fontSize: 18,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  pointsLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
