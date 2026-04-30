/**
 * ActivityEventCard — Event card in the activity feed
 */

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Activity, Award, TrendingUp, Flame, Heart, MessageCircle, MoreHorizontal } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor ,
  CARD_SHADOW
} from '../../constants/theme';
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

const EVENT_IMAGES: Record<string, ImageSourcePropType> = {
  workout_completed: require('../../assets/exercises/barbell_squat_double.png'),
  personal_record: require('../../assets/exercises/barbell_curl_double.png'),
  badge_earned: require('../../assets/exercises/push_up_double.png'),
  streak_milestone: require('../../assets/exercises/cable_row_double.png'),
};

const EXERCISE_LINES = ['Back Squat', 'Romanian Deadlift', 'Walking Lunge'];

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
  const workoutName = (event.payload.workout_name as string | undefined) ?? 'Lower Body Strength';
  const caption = event.payload.caption as string | undefined;
  const showMediaSummary = event.eventType === 'workout_completed' || event.eventType === 'personal_record';
  const recordValue = event.payload.stat_value ?? event.payload.weight ?? event.payload.reps;

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
            <Icon size={16} color={config.color} strokeWidth={1.5} />

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
          <Text style={styles.description}>{caption || description}</Text>

          {showMediaSummary && (
            <View style={styles.mediaBlock}>
              <Image
                source={EVENT_IMAGES[event.eventType] ?? EVENT_IMAGES.workout_completed}
                style={styles.mediaImage}
                resizeMode="cover"
              />

              <View style={styles.mediaSummary}>
                {event.eventType === 'workout_completed' ? (
                  <>
                    <Text style={styles.workoutName} numberOfLines={1}>{workoutName}</Text>
                    <Text style={styles.summaryMeta}>
                      {event.payload.duration as string | undefined ?? '45 min'} · {event.payload.exercise_count as number | undefined ?? 4} exercises
                    </Text>
                    <View style={styles.formScoreWrap}>
                      <Text style={styles.formScoreLabel}>Form Score</Text>
                      <Text style={[styles.formScoreValue, { color: getScoreColor(formScore ?? 0) }]}>
                        {formScore}
                      </Text>
                      <Text style={styles.formScoreUnit}>/100</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.workoutName} numberOfLines={1}>
                      {event.payload.exercise as string | undefined ?? event.payload.stat_label as string | undefined ?? 'Personal Best'}
                    </Text>
                    <Text style={styles.summaryMeta}>Personal record</Text>
                    <View style={styles.formScoreWrap}>
                      <Text style={[styles.formScoreValue, { color: COLORS.green }]}>
                        {recordValue != null ? String(recordValue) : 'PR'}
                      </Text>
                      {!!event.payload.weight && <Text style={styles.formScoreUnit}>lb</Text>}
                    </View>
                  </>
                )}
              </View>
            </View>
          )}

          {event.eventType === 'workout_completed' && (
            <View style={styles.exerciseList}>
              {EXERCISE_LINES.map((line, index) => (
                <View key={line} style={styles.exerciseRow}>
                  <Text style={styles.exerciseName}>{line}</Text>
                  <Text style={styles.exerciseSets}>{index === 2 ? '+2' : `${4 - index} sets`}</Text>
                </View>
              ))}
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

            <View style={styles.commentMeta}>
              <MessageCircle size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
              <Text style={styles.likeCount}>{reactions?.counts.clap ?? 0}</Text>
            </View>

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

            <View style={{ flex: 1 }} />
            <MoreHorizontal size={18} color={COLORS.textTertiary} strokeWidth={1.6} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 12,
    borderRadius: 18,
    ...CARD_SHADOW,
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  cardEdge: {
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
    marginBottom: 8,
  },
  mediaBlock: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    backgroundColor: 'rgba(8, 12, 16, 0.16)',
  },
  mediaImage: {
    width: 132,
    height: 108,
  },
  mediaSummary: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  workoutName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  summaryMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  formScoreWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  formScoreLabel: {
    position: 'absolute',
    top: -9,
    left: 0,
    fontFamily: FONTS.ui.regular,
    fontSize: 8.5,
    color: COLORS.textSecondary,
  },
  formScoreValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 27,
    lineHeight: 31,
  },
  formScoreUnit: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginLeft: 2,
  },
  exerciseList: {
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.07)',
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  exerciseName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  exerciseSets: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },

  /* ── Reaction row ── */
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 8,
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
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
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
