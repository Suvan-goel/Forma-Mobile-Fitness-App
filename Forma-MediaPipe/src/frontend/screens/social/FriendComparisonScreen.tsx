/**
 * FriendComparisonScreen — 1v1 side-by-side stat comparison
 */

import React, { memo } from 'react';
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
import { ArrowLeft, Swords } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { useFriendComparison } from '../../../backend/hooks';
import { ComparisonCard } from '../../components/ui/ComparisonCard';

export const FriendComparisonScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { friendId } = route.params;
  const { comparison, isLoading, error } = useFriendComparison(friendId);

  if (isLoading || !comparison) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Compare</Text>
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
        <Text style={styles.headerTitle}>Compare</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* VS Header */}
        <View style={styles.vsHeader}>
          <View style={styles.vsAvatar}>
            <Text style={styles.vsAvatarText}>
              {comparison.you.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>

          <View style={styles.vsIconContainer}>
            <Swords size={22} color={COLORS.primary} />
            <Text style={styles.vsText}>VS</Text>
          </View>

          <View style={styles.vsAvatar}>
            <Text style={styles.vsAvatarText}>
              {comparison.friend.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Names */}
        <View style={styles.nameRow}>
          <Text style={styles.vsName} numberOfLines={1}>{comparison.you.displayName}</Text>
          <View style={{ width: 60 }} />
          <Text style={styles.vsName} numberOfLines={1}>{comparison.friend.displayName}</Text>
        </View>

        {/* Comparison cards */}
        <View style={styles.cardsContainer}>
          <ComparisonCard
            label="Form Score"
            yourValue={comparison.you.avgFormScore}
            friendValue={comparison.friend.avgFormScore}
            format="decimal"
            higherIsBetter={true}
          />
          <ComparisonCard
            label="Streak"
            yourValue={comparison.you.streakDays}
            friendValue={comparison.friend.streakDays}
            format="integer"
            higherIsBetter={true}
          />
          <ComparisonCard
            label="Weekly Workouts"
            yourValue={comparison.you.weeklyWorkouts}
            friendValue={comparison.friend.weeklyWorkouts}
            format="integer"
            higherIsBetter={true}
          />
          <ComparisonCard
            label="Best Set"
            yourValue={comparison.you.bestSetScore}
            friendValue={comparison.friend.bestSetScore}
            format="score"
            higherIsBetter={true}
          />
          <ComparisonCard
            label="Total Points"
            yourValue={comparison.you.totalPoints}
            friendValue={comparison.friend.totalPoints}
            format="integer"
            higherIsBetter={true}
          />
        </View>
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
  vsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.xl,
  },
  vsAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsAvatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
  },
  vsIconContainer: {
    alignItems: 'center',
    gap: 4,
  },
  vsText: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.primary,
    letterSpacing: 2,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.xl,
  },
  vsName: {
    flex: 1,
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
  },
  cardsContainer: {
    gap: 0,
  },
});
