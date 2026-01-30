import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, ChevronLeft, Dumbbell, Pause, Play } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { saveWorkout } from '../services/workoutStorage';
import { useCurrentWorkout, LoggedSet } from '../contexts/CurrentWorkoutContext';

export type { LoggedSet };

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: LoggedSet } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; returnToCurrentWorkout: true };
};

type CurrentWorkoutRouteProp = RouteProp<RecordStackParamList, 'CurrentWorkout'>;
type CurrentWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'CurrentWorkout'>;

export const CurrentWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<CurrentWorkoutNavigationProp>();
  const route = useRoute<CurrentWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const {
    sets,
    addSet,
    clearSets,
    setWorkoutInProgress,
    workoutElapsedSeconds: contextElapsed,
    setWorkoutElapsedSeconds,
  } = useCurrentWorkout();
  const [elapsedSeconds, setElapsedSeconds] = useState(contextElapsed);
  const [isPaused, setIsPaused] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatStopwatch = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    setWorkoutInProgress(true);
    const startFrom = contextElapsed > 0 ? contextElapsed : 0;
    startTimeRef.current = Date.now() - startFrom * 1000;
    setElapsedSeconds(startFrom);
    intervalRef.current = setInterval(() => {
      if (startTimeRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      startTimeRef.current = null;
    };
  }, [setWorkoutInProgress, contextElapsed]);

  useEffect(() => {
    if (isPaused && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else if (!isPaused && intervalRef.current === null && startTimeRef.current !== null) {
      startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }
  }, [isPaused]);

  const handlePausePress = () => {
    setIsPaused((p) => !p);
  };

  // Fallback: if Camera passed newSet via params (e.g. before context existed), add it
  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.newSet) {
        addSet(route.params.newSet);
        navigation.setParams({ newSet: undefined });
      }
    }, [route.params?.newSet, addSet, navigation])
  );

  const handleAddSet = () => {
    navigation.navigate('ChooseExercise');
  };

  const handleEndWorkout = () => {
    if (sets.length === 0) {
      Alert.alert('No sets recorded', 'Add at least one set before ending the workout.');
      return;
    }

    // Aggregate workout data
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      sets.reduce((sum, set) => sum + set.formScore, 0) / sets.length
    );
    const avgEffortScore = Math.round(
      sets.reduce((sum, set) => sum + set.effortScore, 0) / sets.length
    );

    // Use the first exercise's name as category or default to "General"
    const category = sets[0]?.exerciseName || 'General';
    const now = new Date();
    const name = `Workout – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    // Save workout
    saveWorkout({
      name,
      category,
      duration: '0:00', // Can be enhanced with actual timing later
      totalSets,
      totalReps,
      formScore: avgFormScore,
      effortScore: avgEffortScore,
    });

    // Clear sets and reset to RecordLanding
    clearSets();
    navigation.reset({
      index: 0,
      routes: [{ name: 'RecordLanding' }],
    });
  };

  const handleGoBack = () => {
    setWorkoutElapsedSeconds(elapsedSeconds);
    navigation.reset({
      index: 0,
      routes: [{ name: 'RecordLanding' }],
    });
  };

  return (
    <View style={styles.container}>
      {/* Header: back left; timer + pause + end grouped on same line with border */}
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity style={styles.headerButton} onPress={handleGoBack}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerTimerGroup}>
          <MonoText style={styles.headerTitle}>{formatStopwatch(elapsedSeconds)}</MonoText>
          <TouchableOpacity
            style={styles.headerTimerGroupButton}
            onPress={handlePausePress}
            activeOpacity={0.7}
          >
            {isPaused ? (
              <Play size={20} color={COLORS.text} />
            ) : (
              <Pause size={20} color={COLORS.text} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerEndWorkoutButton}
            onPress={handleEndWorkout}
            activeOpacity={0.7}
          >
            <Text style={styles.headerEndWorkoutText}>End Workout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add New Set Button */}
      <View style={styles.addButtonContainer}>
        <TouchableOpacity style={styles.addButton} onPress={handleAddSet} activeOpacity={0.8}>
          <Plus size={20} color="#000000" />
          <Text style={styles.addButtonText}>Add new set</Text>
        </TouchableOpacity>
      </View>

      {/* Sets List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {sets.length === 0 ? (
          <View style={styles.emptyState}>
            <Dumbbell size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyStateText}>No sets yet</Text>
            <Text style={styles.emptyStateSubtext}>Tap "Add new set" to get started</Text>
          </View>
        ) : (
          sets.map((set, index) => (
            <View key={index} style={styles.setCard}>
              <View style={styles.setHeader}>
                <Text style={styles.setNumber}>Set {index + 1}</Text>
                <Text style={styles.exerciseName}>{set.exerciseName}</Text>
              </View>
              <View style={styles.setMetrics}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Reps</Text>
                  <MonoText style={styles.metricValue}>{set.reps}</MonoText>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Weight</Text>
                  <MonoText style={styles.metricValue}>
                    {set.weight && set.weight > 0 ? `${set.weight}` : '—'}
                  </MonoText>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Form</Text>
                  <MonoText style={styles.metricValue}>{set.formScore}</MonoText>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Effort</Text>
                  <MonoText style={styles.metricValue}>{set.effortScore}</MonoText>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    minHeight: 48,
  },
  headerTimerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.35)',
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTimerGroupButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  headerEndWorkoutButton: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    justifyContent: 'center',
    opacity: 0.85,
  },
  headerEndWorkoutText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    opacity: 0.9,
  },
  addButtonContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    gap: SPACING.xs,
  },
  addButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: '#000000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxxl * 2,
  },
  emptyStateText: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  emptyStateSubtext: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
  },
  setCard: {
    backgroundColor: '#1E2228',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  setNumber: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
    marginRight: SPACING.sm,
  },
  exerciseName: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    flex: 1,
  },
  setMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  metricValue: {
    fontSize: 18,
    color: COLORS.text,
  },
  bottomButtonContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    backgroundColor: COLORS.background,
  },
  endButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    gap: SPACING.xs,
  },
  endButtonDisabled: {
    backgroundColor: '#1E2228',
  },
  endButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: '#000000',
  },
  endButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
});
