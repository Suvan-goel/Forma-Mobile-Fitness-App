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
import { Plus, ChevronLeft, Dumbbell, Pause, Play, Trash2, ChevronDown, ChevronUp, FileText, X } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useCurrentWorkout, LoggedSet } from '../contexts/CurrentWorkoutContext';
import { SetNotesModal } from '../components/ui/SetNotesModal';
import { WeightInputModal } from '../components/ui/WeightInputModal';

export type { LoggedSet };

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: LoggedSet; showWeightFor?: { exerciseId: string } } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; exerciseId?: string; returnToCurrentWorkout: true };
};

type CurrentWorkoutRouteProp = RouteProp<RecordStackParamList, 'CurrentWorkout'>;
type CurrentWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'CurrentWorkout'>;

export const CurrentWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<CurrentWorkoutNavigationProp>();
  const route = useRoute<CurrentWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const {
    exercises,
    sets,
    addSet,
    clearSets,
    updateSetWeight,
    removeSetFromExercise,
    setWorkoutInProgress,
    workoutElapsedSeconds: contextElapsed,
    setWorkoutElapsedSeconds,
  } = useCurrentWorkout();
  const [elapsedSeconds, setElapsedSeconds] = useState(contextElapsed);
  const [isPaused, setIsPaused] = useState(false);
  const [expandedExerciseIds, setExpandedExerciseIds] = useState<Set<string>>(new Set());
  const [notesModalSet, setNotesModalSet] = useState<{
    set: LoggedSet;
    setIndex: number;
    exerciseName: string;
  } | null>(null);
  const [weightModalData, setWeightModalData] = useState<{
    exerciseId: string;
    exerciseName: string;
    setIndex: number;
    currentWeight?: number;
    currentUnit?: 'kg' | 'lbs';
  } | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSetCountsRef = useRef<Map<string, number>>(new Map());

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

  // When screen gains focus: handle newSet fallback and show weight modal only when Camera requested it
  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.newSet) {
        addSet(route.params.newSet);
        navigation.setParams({ newSet: undefined });
      }

      // Open weight modal exactly once when returning from Camera with showWeightFor
      const showWeightFor = route.params?.showWeightFor;
      if (showWeightFor?.exerciseId) {
        const exercise = exercises.find((ex) => ex.id === showWeightFor.exerciseId);
        if (exercise && exercise.sets.length > 0) {
          const lastSetIndex = exercise.sets.length - 1;
          const lastSet = exercise.sets[lastSetIndex];
          setExpandedExerciseIds((prev) => new Set(prev).add(exercise.id));
          setWeightModalData({
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            setIndex: lastSetIndex,
            currentWeight: lastSet?.weight,
            currentUnit: lastSet?.weightUnit || 'kg',
          });
        }
        navigation.setParams({ showWeightFor: undefined });
      }
    }, [route.params?.newSet, route.params?.showWeightFor, addSet, navigation, exercises])
  );

  // Auto-expand exercises when new sets are added (no modal here — modal only from showWeightFor param)
  useEffect(() => {
    exercises.forEach((exercise) => {
      const prevCount = prevSetCountsRef.current.get(exercise.id) || 0;
      const currentCount = exercise.sets.length;
      if (currentCount > prevCount) {
        setExpandedExerciseIds((prev) => new Set(prev).add(exercise.id));
      }
      prevSetCountsRef.current.set(exercise.id, currentCount);
    });
  }, [exercises]);

  const toggleExerciseExpanded = (exerciseId: string) => {
    setExpandedExerciseIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(exerciseId)) {
        newSet.delete(exerciseId);
      } else {
        newSet.add(exerciseId);
      }
      return newSet;
    });
  };

  const handleAddExercise = () => {
    navigation.navigate('ChooseExercise');
  };

  const handleAddSet = (exercise: { id: string; name: string; category: string }) => {
    navigation.navigate('Camera', {
      exerciseName: exercise.name,
      category: exercise.category,
      exerciseId: exercise.id,
      returnToCurrentWorkout: true,
    });
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

    const category = exercises[0]?.name || 'General';
    const duration = formatStopwatch(elapsedSeconds);

    navigation.navigate('SaveWorkout', {
      workoutData: {
        category,
        duration,
        totalSets,
        totalReps,
        avgFormScore,
      },
    });
  };

  const handleGoBack = () => {
    setWorkoutElapsedSeconds(elapsedSeconds);
    navigation.reset({
      index: 0,
      routes: [{ name: 'RecordLanding' }],
    });
  };

  const handleWeightSubmit = (weight: number, unit: 'kg' | 'lbs') => {
    if (weightModalData) {
      updateSetWeight(weightModalData.exerciseId, weightModalData.setIndex, weight, unit);
      setWeightModalData(null);
    }
  };

  const handleEditWeight = (exerciseId: string, exerciseName: string, setIndex: number, currentWeight?: number, currentUnit?: 'kg' | 'lbs') => {
    setWeightModalData({
      exerciseId,
      exerciseName,
      setIndex,
      currentWeight,
      currentUnit: currentUnit || 'kg',
    });
  };

  const handleDeleteSet = (exerciseId: string, exerciseName: string, setIndex: number) => {
    Alert.alert(
      'Delete set?',
      `Are you sure you want to delete Set ${setIndex + 1} for ${exerciseName}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeSetFromExercise(exerciseId, setIndex),
        },
      ]
    );
  };

  const handleDiscardWorkout = () => {
    Alert.alert(
      'Discard Workout',
      'Are you sure? This will delete all recorded sets and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            clearSets();
            setWorkoutElapsedSeconds(0);
            setWorkoutInProgress(false);
            navigation.reset({
              index: 0,
              routes: [{ name: 'RecordLanding' }],
            });
          },
        },
      ]
    );
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
          <TouchableOpacity
            style={styles.headerDiscardButton}
            onPress={handleDiscardWorkout}
            activeOpacity={0.7}
          >
            <Trash2 size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Exercises List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 60 },
          exercises.length === 0 && styles.scrollContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {exercises.length === 0 ? (
          <View style={styles.emptyState}>
            <Dumbbell size={48} color={COLORS.textSecondary} strokeWidth={1} />
            <Text style={styles.emptyStateText}>No sets yet</Text>
            <Text style={styles.emptyStateSubtext}>Tap "Add new exercise" to get started</Text>
          </View>
        ) : (
          exercises.map((exercise) => {
            const isExpanded = expandedExerciseIds.has(exercise.id);
            return (
              <View key={exercise.id} style={styles.exerciseCard}>
                <TouchableOpacity
                  style={styles.exerciseCardHeader}
                  onPress={() => toggleExerciseExpanded(exercise.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.exerciseName}>{exercise.name}</Text>
                  <View style={styles.exerciseHeaderRight}>
                    <Text style={styles.setCount}>{exercise.sets.length} sets</Text>
                    {isExpanded ? (
                      <ChevronUp size={20} color={COLORS.textSecondary} />
                    ) : (
                      <ChevronDown size={20} color={COLORS.textSecondary} />
                    )}
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.setsList}>
                    {exercise.sets.map((set, setIndex) => (
                      <View key={setIndex} style={styles.setCard}>
                        <View style={styles.setCardHeader}>
                          <Text style={styles.setNumber}>Set {setIndex + 1}</Text>
                          <View style={styles.setCardHeaderActions}>
                            <TouchableOpacity
                              style={styles.notesButton}
                              onPress={() => {
                                setNotesModalSet({
                                  set,
                                  setIndex: setIndex + 1,
                                  exerciseName: exercise.name,
                                });
                              }}
                              activeOpacity={0.7}
                            >
                              <FileText size={18} color={COLORS.primary} />
                              <Text style={styles.notesButtonText}>Notes</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.deleteSetButton}
                              onPress={() => handleDeleteSet(exercise.id, exercise.name, setIndex)}
                              activeOpacity={0.7}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              accessibilityRole="button"
                              accessibilityLabel="Delete set"
                            >
                              <X size={20} color={COLORS.textSecondary} strokeWidth={2.5} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.setMetrics}>
                          <View style={styles.metricItem}>
                            <Text style={styles.metricLabel}>Reps</Text>
                            <MonoText style={styles.metricValue}>{set.reps}</MonoText>
                          </View>
                          <TouchableOpacity
                            style={styles.metricItem}
                            onPress={() => handleEditWeight(exercise.id, exercise.name, setIndex, set.weight, set.weightUnit)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.metricLabel}>Weight</Text>
                            <MonoText style={[styles.metricValue, !set.weight && styles.metricValueEmpty]}>
                              {set.weight && set.weight > 0 
                                ? `${set.weight}${set.weightUnit || 'kg'}` 
                                : '—'}
                            </MonoText>
                          </TouchableOpacity>
                          <View style={styles.metricItem}>
                            <Text style={styles.metricLabel}>Form</Text>
                            <MonoText style={styles.metricValue}>{set.formScore}</MonoText>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.addSetButton}
                  onPress={() => handleAddSet(exercise)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.addSetButtonText}>Add set</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {notesModalSet && (
        <SetNotesModal
          visible={!!notesModalSet}
          onClose={() => setNotesModalSet(null)}
          set={notesModalSet.set}
          setNumber={notesModalSet.setIndex}
          exerciseName={notesModalSet.exerciseName}
        />
      )}

      {weightModalData && (
        <WeightInputModal
          visible={!!weightModalData}
          onClose={() => setWeightModalData(null)}
          onSubmit={handleWeightSubmit}
          initialWeight={weightModalData.currentWeight}
          initialUnit={weightModalData.currentUnit}
          exerciseName={weightModalData.exerciseName}
          setNumber={weightModalData.setIndex + 1}
        />
      )}

      {/* Add New Exercise Button - Fixed at bottom */}
      <View style={[styles.addButtonContainer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
        <TouchableOpacity style={styles.addButton} onPress={handleAddExercise} activeOpacity={0.8}>
          <Plus size={18} color={COLORS.primary} />
          <Text style={styles.addButtonText}>Add new exercise</Text>
        </TouchableOpacity>
      </View>
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
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.sm,
    minHeight: 48,
  },
  headerTimerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
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
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xs,
    justifyContent: 'center',
    opacity: 0.85,
  },
  headerEndWorkoutText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  headerDiscardButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(128, 128, 128, 0.35)',
    marginLeft: SPACING.xs,
    paddingLeft: SPACING.xs,
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    opacity: 0.9,
  },
  addButtonContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
    backgroundColor: COLORS.background,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: 28,
    gap: SPACING.xs,
  },
  addButtonText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
  },
  scrollContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxxl * 2,
    alignSelf: 'stretch',
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
  exerciseCard: {
    ...CARD_STYLE,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
  },
  exerciseHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  setCount: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  setsList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  addSetButton: {
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  addSetButtonText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.primary,
  },
  setCard: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.15)',
  },
  setCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  setCardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  notesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 172, 124, 0.12)',
  },
  notesButtonText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.primary,
  },
  deleteSetButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
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
    marginBottom: SPACING.xs,
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
  metricValueEmpty: {
    color: COLORS.textSecondary,
  },
  bottomButtonContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
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
