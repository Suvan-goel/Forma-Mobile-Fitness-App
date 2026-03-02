/**
 * ActivityEventCard — Event card in the activity feed
 */

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Activity, Award, TrendingUp, Flame, Heart } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../../constants/theme';
import { ActivityEvent, ReactionType, EventReactions } from '../../../backend/services/api/types';

const EMOJI_REACTIONS: { type: ReactionType; emoji: string }[] = [
  { type: 'muscle', emoji: '\uD83D\uDCAA' },
  { type: 'fire', emoji: '\uD83D\uDD25' },
  { type: 'clap', emoji: '\uD83D\uDC4F' },
];

interface ActivityEventCardProps {
  event: ActivityEvent;
  reactions?: EventReactions;
  onToggleReaction?: (eventId: string, reactionType: ReactionType) => void;
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const EVENT_CONFIG: Record<string, { icon: any; color: string }> = {
  workout_completed: { icon: Activity, color: COLORS.primary },
  badge_earned: { icon: Award, color: '#F5A623' },
  personal_record: { icon: TrendingUp, color: '#34D399' },
  streak_milestone: { icon: Flame, color: '#E07856' },
};

export const ActivityEventCard: React.FC<ActivityEventCardProps> = memo(({ event, reactions, onToggleReaction }) => {
  const config = EVENT_CONFIG[event.eventType] || EVENT_CONFIG.workout_completed;
  const Icon = config.icon;

  const description = useMemo(() => {
    const p = event.payload;
    switch (event.eventType) {
      case 'workout_completed':
        return `Completed a workout — ${p.form_score} form score`;
      case 'badge_earned':
        return `Earned the "${p.badge_name}" badge`;
      case 'personal_record':
        return `New PR on ${p.exercise}${p.weight ? ` — ${p.weight} lbs` : ''}`;
      case 'streak_milestone':
        return `Hit a ${p.streak_days}-day streak`;
      default:
        return 'Activity';
    }
  }, [event.eventType, event.payload]);

  const formScore = event.eventType === 'workout_completed' ? event.payload.form_score as number : null;

  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.card}
      >
        <View style={styles.cardEdge}>
          {/* Header row */}
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: `${config.color}15` }]}>
              <Icon size={16} color={config.color} />
            </View>

            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {event.displayName}
              </Text>
              <Text style={styles.timestamp}>
                {getRelativeTime(event.createdAt)}
              </Text>
            </View>

            {formScore != null && (
              <View style={[styles.scoreBadge, { borderColor: `${getScoreColor(formScore)}25` }]}>
                <Text style={[styles.scoreText, { color: getScoreColor(formScore) }]}>
                  {formScore}
                </Text>
              </View>
            )}
          </View>

          {/* Description */}
          <Text style={styles.description}>{description}</Text>

          {/* Meta info */}
          {event.eventType === 'workout_completed' && !!event.payload.duration && (
            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Text style={styles.metaText}>
                  {event.payload.duration as string}
                </Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaText}>
                  {event.payload.exercise_count as number} exercises
                </Text>
              </View>
            </View>
          )}

          {/* Reaction row */}
          <View style={styles.reactionRow}>
            <TouchableOpacity
              style={styles.likeButton}
              onPress={() => onToggleReaction?.(event.id, 'like')}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Heart
                size={14}
                color={reactions?.userReaction === 'like' ? '#EF4444' : COLORS.textTertiary}
                fill={reactions?.userReaction === 'like' ? '#EF4444' : 'transparent'}
              />
              {(reactions?.counts.like ?? 0) > 0 && (
                <Text style={[
                  styles.likeCount,
                  reactions?.userReaction === 'like' && styles.likeCountActive,
                ]}>
                  {reactions!.counts.like}
                </Text>
              )}
            </TouchableOpacity>

            {EMOJI_REACTIONS.map(({ type, emoji }) => {
              const count = reactions?.counts[type] ?? 0;
              const isActive = reactions?.userReaction === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.emojiPill, isActive && styles.emojiPillActive]}
                  onPress={() => onToggleReaction?.(event.id, type)}
                  activeOpacity={0.6}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={[styles.emoji, !isActive && count === 0 && styles.emojiInactive]}>
                    {emoji}
                  </Text>
                  {count > 0 && (
                    <Text style={[styles.emojiCount, isActive && styles.emojiCountActive]}>
                      {count}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
    borderRadius: 18,
    overflow: 'hidden',
  },
  card: {
    borderRadius: 18,
  },
  cardEdge: {
    padding: SPACING.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  iconContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  name: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
  },
  timestamp: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  scoreBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  scoreText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
  },
  description: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Reaction row ── */
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  likeCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  likeCountActive: {
    color: '#EF4444',
  },
  emojiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  emojiPillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  emoji: {
    fontSize: 13,
  },
  emojiInactive: {
    opacity: 0.4,
  },
  emojiCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  emojiCountActive: {
    color: COLORS.textSecondary,
  },
});
