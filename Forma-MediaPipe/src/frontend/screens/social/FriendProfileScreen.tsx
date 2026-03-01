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
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ChevronLeft, GitCompare, Award, Calendar, Flame } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, getScoreColor } from '../../constants/theme';
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
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 36 }} />
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
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <View style={[
            styles.largeAvatarOuter,
            Platform.OS === 'ios' && {
              shadowColor: '#8B5CF6',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
            },
          ]}>
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.25)', 'rgba(139, 92, 246, 0.08)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.largeAvatar}
            >
              <Text style={styles.largeAvatarText}>
                {profile.displayName.charAt(0).toUpperCase()}
              </Text>
            </LinearGradient>
          </View>
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <Text style={styles.memberSince}>
            Member since {profile.memberSince.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <View style={styles.statIconContainer}>
              <Calendar size={14} color={COLORS.primary} />
            </View>
            <Text style={styles.statValue}>{profile.totalWorkouts}</Text>
            <Text style={styles.statLabel}>Workouts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.statIconContainer}>
              <Flame size={14} color="#E07856" />
            </View>
            <Text style={styles.statValue}>{profile.streakDays}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.statIconContainer}>
              <Award size={14} color="#34D399" />
            </View>
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
                  <View style={[styles.workoutScoreBadge, { borderColor: `${getScoreColor(workout.formScore)}25` }]}>
                    <Text style={[styles.workoutScore, { color: getScoreColor(workout.formScore) }]}>
                      {workout.formScore}
                    </Text>
                  </View>
                </View>
                <Text style={styles.workoutMeta}>
                  {workout.date} • {workout.duration} • {workout.totalSets} sets
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Compare button */}
        <TouchableOpacity
          style={styles.compareButton}
          onPress={handleCompare}
          activeOpacity={0.7}
        >
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
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
  largeAvatarOuter: {
    marginBottom: SPACING.md,
  },
  largeAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeAvatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: SPACING.md,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
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
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  section: {
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  sectionTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: SPACING.md,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
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
  workoutScoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  workoutScore: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
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
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  compareButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 15,
    color: COLORS.text,
  },
});
