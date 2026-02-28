/**
 * FriendProfileScreen — View a friend's public profile
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft, GitCompare, Award, Calendar, Flame } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_STYLE, getScoreColor } from '../../constants/theme';
import { useFriendProfile } from '../../../backend/hooks';

export const FriendProfileScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId } = route.params;
  const { profile, isLoading, error } = useFriendProfile(userId);

  const handleCompare = useCallback(() => {
    navigation.navigate('FriendComparison', { friendId: userId });
  }, [navigation, userId]);

  if (isLoading || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <ArrowLeft size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <View style={styles.largeAvatar}>
            <Text style={styles.largeAvatarText}>
              {profile.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <Text style={styles.memberSince}>
            Member since {profile.memberSince.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Calendar size={16} color={COLORS.textTertiary} />
            <Text style={styles.statValue}>{profile.totalWorkouts}</Text>
            <Text style={styles.statLabel}>Workouts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Flame size={16} color={COLORS.textTertiary} />
            <Text style={styles.statValue}>{profile.streakDays}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Award size={16} color={COLORS.textTertiary} />
            <Text style={[styles.statValue, { color: getScoreColor(profile.avgFormScore) }]}>
              {profile.avgFormScore.toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>Avg Form</Text>
          </View>
        </View>

        {/* Badges */}
        {profile.earnedBadgeIds.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={styles.badgeRow}>
              {profile.earnedBadgeIds.map(badgeId => (
                <View key={badgeId} style={styles.badge}>
                  <Award size={18} color={COLORS.primary} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Recent workouts */}
        {profile.recentWorkouts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Workouts</Text>
            {profile.recentWorkouts.map(workout => (
              <View key={workout.id} style={styles.workoutCard}>
                <View style={styles.workoutHeader}>
                  <Text style={styles.workoutName}>{workout.name}</Text>
                  <Text style={[styles.workoutScore, { color: getScoreColor(workout.formScore) }]}>
                    {workout.formScore}
                  </Text>
                </View>
                <Text style={styles.workoutMeta}>
                  {workout.date} • {workout.duration} • {workout.totalSets} sets
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Compare button */}
        <TouchableOpacity style={styles.compareButton} onPress={handleCompare} activeOpacity={0.7}>
          <GitCompare size={18} color={COLORS.text} />
          <Text style={styles.compareButtonText}>Compare Stats</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  largeAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  largeAvatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
  },
  displayName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
  },
  memberSince: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.screenHorizontal,
    ...CARD_STYLE,
    padding: SPACING.md,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  section: {
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  sectionTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.md,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutCard: {
    ...CARD_STYLE,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  workoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  workoutName: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
  },
  workoutScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
  },
  workoutMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  compareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.screenHorizontal,
    marginTop: SPACING.xxl,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  compareButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 15,
    color: COLORS.text,
  },
});
