/**
 * ActivityEventCard — Single event in the activity feed
 */

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Activity, Award, TrendingUp, Flame } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_STYLE, getScoreColor } from '../../constants/theme';
import { ActivityEvent } from '../../../backend/services/api/types';

interface ActivityEventCardProps {
  event: ActivityEvent;
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

export const ActivityEventCard: React.FC<ActivityEventCardProps> = memo(({ event }) => {
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
    <View style={styles.card}>
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
          <View style={styles.scoreBadge}>
            <Text style={[styles.scoreText, { color: getScoreColor(formScore) }]}>
              {formScore}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.description}>{description}</Text>

      {event.eventType === 'workout_completed' && !!event.payload.duration && (
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {event.payload.duration as string} • {event.payload.exercise_count as number} exercises
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    ...CARD_STYLE,
    padding: SPACING.md,
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scoreText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
  },
  description: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  metaRow: {
    marginTop: SPACING.xs,
  },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
});
