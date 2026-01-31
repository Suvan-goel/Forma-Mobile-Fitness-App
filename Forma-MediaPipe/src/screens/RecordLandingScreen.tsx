import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutTemplate, Plus, Timer, Trash2, Pause, Play, Flag } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { AppHeader } from '../components/ui/AppHeader';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';

const formatStopwatch = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

import type { RecordStackParamList } from '../app/RootNavigator';

type RecordLandingNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'RecordLanding'>;

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const insets = useSafeAreaInsets();
  const { workoutInProgress, sets, workoutElapsedSeconds, setWorkoutElapsedSeconds, clearSets } =
    useCurrentWorkout();
  const navigationBarHeight = 60 + Math.max(insets.bottom, 8); // Approximate nav bar height + safe area
  const [timerPaused, setTimerPaused] = useState(false);

  useEffect(() => {
    if (!workoutInProgress || timerPaused) return;
    const interval = setInterval(() => {
      setWorkoutElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [workoutInProgress, timerPaused, setWorkoutElapsedSeconds]);

  const handleStartWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleResumeWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleChooseTemplate = () => {
    navigation.navigate('ChooseExercise');
  };

  const handleDiscardWorkout = () => {
    Alert.alert(
      'Discard workout',
      'Are you sure? This will clear all sets and time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: clearSets },
      ]
    );
  };

  const handlePauseWorkout = () => {
    setTimerPaused((p) => !p);
  };

  const handleFinishWorkout = () => {
    if (sets.length === 0) {
      clearSets();
      return;
    }
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      sets.reduce((sum, set) => sum + set.formScore, 0) / sets.length
    );
    const avgEffortScore = Math.round(
      sets.reduce((sum, set) => sum + set.effortScore, 0) / sets.length
    );
    const category = sets[0]?.exerciseName || 'General';
    const duration = formatStopwatch(workoutElapsedSeconds);

    navigation.navigate('SaveWorkout', {
      workoutData: {
        category,
        duration,
        totalSets,
        totalReps,
        avgFormScore,
        avgEffortScore,
      },
    });
  };

  return (
    <View style={styles.container}>
      <AppHeader />
      <View style={[styles.cardsContainer, { paddingBottom: navigationBarHeight + SPACING.lg }]}>
        {/* Top Card - Workout in progress (when active) or Start New Workout */}
        {workoutInProgress ? (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardContent}
              onPress={handleResumeWorkout}
              activeOpacity={0.7}
            >
              <View style={styles.plusIconContainer}>
                <Timer size={80} color={COLORS.primary} strokeWidth={1} />
              </View>
              <MonoText style={styles.cardTimer}>{formatStopwatch(workoutElapsedSeconds)}</MonoText>
              <Text style={styles.cardText}>Workout in progress</Text>
              <Text style={styles.cardSubtext}>
                {sets.length > 0
                  ? `${sets.length} set${sets.length === 1 ? '' : 's'} • Tap to resume`
                  : 'Tap to resume'}
              </Text>
            </TouchableOpacity>
            <View style={styles.workoutActions}>
              <TouchableOpacity
                style={styles.workoutActionButton}
                onPress={handleDiscardWorkout}
                activeOpacity={0.7}
              >
                <View style={styles.workoutActionIconWrap}>
                  <Trash2 size={22} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
                <Text style={styles.workoutActionLabel}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.workoutActionButton}
                onPress={handlePauseWorkout}
                activeOpacity={0.7}
              >
                <View style={styles.workoutActionIconWrap}>
                  {timerPaused ? (
                    <Play size={22} color={COLORS.primary} strokeWidth={1.5} />
                  ) : (
                    <Pause size={22} color={COLORS.primary} strokeWidth={1.5} />
                  )}
                </View>
                <Text style={styles.workoutActionLabel}>{timerPaused ? 'Resume' : 'Pause'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.workoutActionButton}
                onPress={handleFinishWorkout}
                activeOpacity={0.7}
              >
                <View style={styles.workoutActionIconWrap}>
                  <Flag size={22} color={COLORS.primary} strokeWidth={1.5} />
                </View>
                <Text style={styles.workoutActionLabel}>Finish</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.card}
            onPress={handleStartWorkout}
            activeOpacity={0.7}
          >
            <View style={styles.cardContent}>
              <View style={styles.plusIconContainer}>
                <Plus size={80} color={COLORS.primary} strokeWidth={1} />
              </View>
              <Text style={styles.cardText}>Start New Workout</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Bottom Card - Choose Template (hidden when workout in progress) */}
        {!workoutInProgress && (
          <TouchableOpacity
            style={styles.card}
            onPress={handleChooseTemplate}
            activeOpacity={0.7}
          >
            <View style={styles.cardContent}>
              <View style={styles.plusIconContainer}>
                <LayoutTemplate size={80} color={COLORS.primary} strokeWidth={1} />
              </View>
              <Text style={styles.cardText}>Choose Template</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  cardsContainer: {
    flex: 1,
    flexDirection: 'column',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.lg,
  },
  card: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  cardContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: SPACING.xl,
  },
  workoutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    alignSelf: 'stretch',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.2)',
  },
  workoutActionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutActionIconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutActionLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  plusIconContainer: {
    marginBottom: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTimer: {
    fontSize: 28,
    fontFamily: FONTS.ui.regular,
    color: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  cardText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    opacity: 0.85,
    marginBottom: SPACING.xs,
  },
  cardSubtext: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    opacity: 0.8,
    marginTop: SPACING.sm,
  },
});
