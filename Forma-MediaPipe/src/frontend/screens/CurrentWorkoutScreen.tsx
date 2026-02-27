import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Plus,
  ChevronLeft,
  Dumbbell,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
  Clock,
  Layers,
  Flag,
  Timer,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE, GLOW_SHADOW, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../constants/theme';
import CogIcon from '../components/icons/CogIcon';
import PauseIcon from '../components/icons/PauseIcon';
import { MonoText } from '../components/typography/MonoText';
import { useCurrentWorkout, LoggedSet } from '../contexts/CurrentWorkoutContext';
import { SetNotesModal } from '../components/ui/SetNotesModal';
import { WeightInputModal } from '../components/ui/WeightInputModal';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { useAlert } from '../contexts/AlertContext';

export type { LoggedSet };

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: LoggedSet; showWeightFor?: { exerciseId: string } } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; exerciseId?: string; returnToCurrentWorkout: true };
  SaveWorkout: { workoutData: { category: string; duration: string; totalSets: number; totalReps: number; avgFormScore: number } };
  WorkoutSettings: undefined;
};

type CurrentWorkoutRouteProp = RouteProp<RecordStackParamList, 'CurrentWorkout'>;
type CurrentWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'CurrentWorkout'>;

/* ── Helpers ──────────────────────────────── */

const formatStopwatch = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

/* ── Main Screen ──────────────────────────── */

const TIMER_FONT_SIZE_MAX = 72;
const TIMER_FONT_SIZE_MIN = 44;
const TIMER_LINE_HEIGHT_RATIO = 80 / 72;

export const CurrentWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<CurrentWorkoutNavigationProp>();
  const route = useRoute<CurrentWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { width: windowWidth } = useWindowDimensions();
  const timerFontSize = Math.min(
    TIMER_FONT_SIZE_MAX,
    Math.max(TIMER_FONT_SIZE_MIN, (windowWidth - 2 * SPACING.screenHorizontal) / 5)
  );
  const timerLineHeight = Math.round(timerFontSize * TIMER_LINE_HEIGHT_RATIO);
  const {
    exercises,
    sets,
    addSet,
    clearSets,
    updateSetWeight,
    removeExercise,
    removeSetFromExercise,
    setWorkoutInProgress,
    workoutElapsedSeconds: contextElapsed,
    setWorkoutElapsedSeconds,
    workoutPaused,
    setWorkoutPaused,
  } = useCurrentWorkout();
  const [elapsedSeconds, setElapsedSeconds] = useState(contextElapsed);
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
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);
  const prevSetCountsRef = useRef<Map<string, number>>(new Map());
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { restTimerEnabled, restTimerDurationSeconds } = useCameraSettings();
  isPausedRef.current = workoutPaused;

  /* ── Timer logic: one interval; when paused we skip ticking so the display freezes ──── */

  useEffect(() => {
    setWorkoutInProgress(true);
    const startFrom = contextElapsed > 0 ? contextElapsed : 0;
    startTimeRef.current = Date.now() - startFrom * 1000;
    setElapsedSeconds(startFrom);

    intervalRef.current = setInterval(() => {
      if (isPausedRef.current) return;
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

  const handlePausePress = () => {
    setWorkoutPaused((p) => {
      const next = !p;
      if (!next) {
        // Resuming: shift startTimeRef forward by the pause duration so the
        // interval calculates elapsed time correctly without jumping.
        startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      }
      return next;
    });
  };

  /* ── Rest timer logic ──── */

  const startRestTimer = useCallback(() => {
    if (!restTimerEnabled || restTimerDurationSeconds <= 0) return;
    // Clear any existing rest timer
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);

    const endTime = Date.now() + restTimerDurationSeconds * 1000;
    setRestSecondsLeft(restTimerDurationSeconds);

    restIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRestSecondsLeft(remaining);
      if (remaining <= 0) {
        if (restIntervalRef.current) clearInterval(restIntervalRef.current);
        restIntervalRef.current = null;
        setRestSecondsLeft(null);
      }
    }, 1000);
  }, [restTimerEnabled, restTimerDurationSeconds]);

  const cancelRestTimer = useCallback(() => {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    restIntervalRef.current = null;
    setRestSecondsLeft(null);
  }, []);

  // Clean up rest timer on unmount
  useEffect(() => {
    return () => {
      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    };
  }, []);

  /* ── Focus effects ──── */

  useFocusEffect(
    React.useCallback(() => {
      if (route.params?.newSet) {
        addSet(route.params.newSet);
        navigation.setParams({ newSet: undefined });
      }
      const showWeightFor = route.params?.showWeightFor;
      if (showWeightFor?.exerciseId) {
        startRestTimer();
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

  /* ── Handlers ──── */

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
      showAlert('No sets recorded', 'Add at least one set before ending the workout.');
      return;
    }
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      sets.reduce((sum, set) => sum + set.formScore, 0) / sets.length
    );
    const category = exercises[0]?.name || 'General';
    const duration = formatStopwatch(elapsedSeconds);
    navigation.navigate('SaveWorkout', {
      workoutData: { category, duration, totalSets, totalReps, avgFormScore },
    });
  };

  const handleGoBack = () => {
    setWorkoutElapsedSeconds(elapsedSeconds);
    navigation.reset({ index: 0, routes: [{ name: 'RecordLanding' }] });
  };

  const handleWeightSubmit = (weight: number, unit: 'kg' | 'lbs') => {
    if (weightModalData) {
      updateSetWeight(weightModalData.exerciseId, weightModalData.setIndex, weight, unit);
      setWeightModalData(null);
    }
  };

  const handleEditWeight = (
    exerciseId: string,
    exerciseName: string,
    setIndex: number,
    currentWeight?: number,
    currentUnit?: 'kg' | 'lbs'
  ) => {
    setWeightModalData({
      exerciseId,
      exerciseName,
      setIndex,
      currentWeight,
      currentUnit: currentUnit || 'kg',
    });
  };

  const handleDeleteExercise = (exerciseId: string, exerciseName: string, setCount: number) => {
    showAlert(
      'Remove exercise?',
      `Remove ${exerciseName}${setCount > 0 ? ` and its ${setCount} ${setCount === 1 ? 'set' : 'sets'}` : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeExercise(exerciseId),
        },
      ]
    );
  };

  const handleDeleteSet = (exerciseId: string, exerciseName: string, setIndex: number) => {
    showAlert(
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
    showAlert(
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
            navigation.reset({ index: 0, routes: [{ name: 'RecordLanding' }] });
          },
        },
      ]
    );
  };

  /* ── Computed ──── */

  const totalSetsCount = sets.length;
  const totalRepsCount = sets.reduce((sum, s) => sum + s.reps, 0);

  /* ── Render ──── */

  return (
    <View style={styles.container}>
      {/* ── HEADER ──────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.headerBackButton} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color="#71717A" strokeWidth={1.5} />
        </TouchableOpacity>

        <Text style={styles.headerLabel}>ACTIVE SESSION</Text>

        <TouchableOpacity
          style={styles.headerSettingsButton}
          onPress={() => navigation.navigate('WorkoutSettings')}
          activeOpacity={0.7}
        >
          <CogIcon size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* ── TIMER HERO ──────────────────────── */}
      <View style={styles.timerBlock}>
        <MonoText bold style={[styles.timerText, { fontSize: timerFontSize, lineHeight: timerLineHeight }]}>
          {formatStopwatch(elapsedSeconds)}
        </MonoText>
        {workoutPaused && (
          <View style={styles.pausedBadge}>
            <Text style={styles.pausedBadgeText}>PAUSED</Text>
          </View>
        )}
        {totalSetsCount > 0 && (
          <View style={styles.sessionMetaRow}>
            <View style={styles.sessionMetaItem}>
              <Layers size={12} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sessionMetaText}>{totalSetsCount} SETS</Text>
            </View>
            <View style={styles.sessionMetaDot} />
            <View style={styles.sessionMetaItem}>
              <Clock size={12} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sessionMetaText}>{totalRepsCount} REPS</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── REST TIMER BAR ──────────────────── */}
      {restSecondsLeft !== null && (
        <View style={styles.restTimerBar}>
          <Timer size={14} color={COLORS.accent} strokeWidth={1.5} />
          <View style={styles.restTimerProgress}>
            <View style={styles.restTimerTrack}>
              <View
                style={[
                  styles.restTimerFill,
                  { width: `${(restSecondsLeft / restTimerDurationSeconds) * 100}%` },
                ]}
              />
            </View>
          </View>
          <MonoText bold style={styles.restTimerText}>
            {Math.floor(restSecondsLeft / 60)}:{(restSecondsLeft % 60).toString().padStart(2, '0')}
          </MonoText>
          <TouchableOpacity
            onPress={cancelRestTimer}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <X size={14} color={COLORS.textTertiary} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── CONTENT AREA ────────────────────── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 180 },
          exercises.length === 0 && styles.scrollContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {exercises.length === 0 ? (
          /* ── THE VOID (Empty State) ──── */
          <View style={styles.voidState}>
            <View style={styles.voidIconWrap}>
              <Dumbbell size={40} color="#52525B" strokeWidth={1} />
            </View>
            <Text style={styles.voidTitle}>NO EXERCISES</Text>
            <Text style={styles.voidSubtext}>Add an exercise to begin tracking</Text>
          </View>
        ) : (
          /* ── EXERCISE CARDS ──── */
          exercises.map((exercise) => {
            const isExpanded = expandedExerciseIds.has(exercise.id);
            return (
              <View key={exercise.id} style={styles.exerciseCardOuter}>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.exerciseCardGradient}
                >
                  <View style={styles.exerciseCardGlassEdge}>
                    {/* Card Header */}
                    <TouchableOpacity
                      style={styles.exerciseCardHeader}
                      onPress={() => toggleExerciseExpanded(exercise.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.exerciseCardHeaderLeft}>
                        <Text style={styles.exerciseCardName}>{exercise.name}</Text>
                        <Text style={styles.exerciseCardMeta}>
                          {exercise.sets.length} {exercise.sets.length === 1 ? 'SET' : 'SETS'}
                        </Text>
                      </View>
                      <View style={styles.exerciseCardHeaderRight}>
                        <View style={styles.exerciseSetsBadge}>
                          <MonoText style={styles.exerciseSetsValue}>{exercise.sets.length}</MonoText>
                        </View>
                        {isExpanded ? (
                          <ChevronUp size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                        ) : (
                          <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                        )}
                        <TouchableOpacity
                          onPress={() => handleDeleteExercise(exercise.id, exercise.name, exercise.sets.length)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2 size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>

                    {/* Expanded Sets */}
                    {isExpanded && (
                      <View style={styles.setsList}>
                        {exercise.sets.map((set, setIndex) => (
                          <View key={setIndex} style={styles.setRow}>
                            <View style={styles.setRowHeader}>
                              <Text style={styles.setRowLabel}>SET {setIndex + 1}</Text>
                              <View style={styles.setRowActions}>
                                <TouchableOpacity
                                  style={styles.setNotesButton}
                                  onPress={() =>
                                    setNotesModalSet({
                                      set,
                                      setIndex: setIndex + 1,
                                      exerciseName: exercise.name,
                                    })
                                  }
                                  activeOpacity={0.7}
                                >
                                  <FileText size={14} color={COLORS.accent} strokeWidth={1.5} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.setDeleteButton}
                                  onPress={() => handleDeleteSet(exercise.id, exercise.name, setIndex)}
                                  activeOpacity={0.7}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <X size={14} color={COLORS.textTertiary} strokeWidth={2} />
                                </TouchableOpacity>
                              </View>
                            </View>
                            <View style={styles.setMetrics}>
                              <View style={styles.setMetricItem}>
                                <Text style={styles.setMetricLabel}>REPS</Text>
                                <MonoText bold style={styles.setMetricValue}>{set.reps}</MonoText>
                              </View>
                              <View style={styles.setMetricDivider} />
                              <TouchableOpacity
                                style={styles.setMetricItem}
                                onPress={() =>
                                  handleEditWeight(
                                    exercise.id,
                                    exercise.name,
                                    setIndex,
                                    set.weight,
                                    set.weightUnit
                                  )
                                }
                                activeOpacity={0.7}
                              >
                                <Text style={styles.setMetricLabel}>WEIGHT</Text>
                                <MonoText
                                  bold
                                  style={[styles.setMetricValue, !set.weight && styles.setMetricValueEmpty]}
                                >
                                  {set.weight && set.weight > 0
                                    ? `${set.weight}${set.weightUnit || 'kg'}`
                                    : '—'}
                                </MonoText>
                              </TouchableOpacity>
                              <View style={styles.setMetricDivider} />
                              <View style={styles.setMetricItem}>
                                <Text style={styles.setMetricLabel}>FORM</Text>
                                <MonoText bold style={[styles.setMetricValue, { color: getScoreColor(set.formScore) }]}>{set.formScore}</MonoText>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Add Set Row */}
                    <TouchableOpacity
                      style={styles.addSetRow}
                      onPress={() => handleAddSet(exercise)}
                      activeOpacity={0.7}
                    >
                      <Plus size={14} color={COLORS.accent} strokeWidth={2} />
                      <Text style={styles.addSetRowText}>Add set</Text>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Modals ──── */}
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

      {/* ── BOTTOM PANEL ── */}
      <View style={[styles.bottomPanel, { paddingBottom: Math.max(insets.bottom, SPACING.md) + 4 }]}>
        {/* Add Exercise */}
        <TouchableOpacity style={styles.addExerciseButton} onPress={handleAddExercise} activeOpacity={0.8}>
          <Plus size={15} color={COLORS.accent} strokeWidth={2.5} />
          <Text style={styles.addExerciseText}>Add exercise</Text>
        </TouchableOpacity>

        {/* Controls Row */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.controlDiscardButton}
            onPress={handleDiscardWorkout}
            activeOpacity={0.7}
          >
            <Trash2 size={16} color="#52525B" strokeWidth={1.5} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlPauseButton}
            onPress={handlePausePress}
            activeOpacity={0.7}
          >
            {workoutPaused ? (
              <Play size={17} color="#FFFFFF" strokeWidth={1.5} />
            ) : (
              <PauseIcon size={17} color="#A1A1AA" />
            )}
            <Text style={styles.controlPauseLabel}>
              {workoutPaused ? 'Resume' : 'Pause'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlFinishButton}
            onPress={handleEndWorkout}
            activeOpacity={0.7}
          >
            <Flag size={15} color="#FFFFFF" strokeWidth={1.5} />
            <Text style={styles.controlFinishLabel}>Finish</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Header ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 4,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#52525B',
    letterSpacing: 3,
  },
  headerSettingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Timer Hero ─────────────────────────── */
  timerBlock: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  timerText: {
    fontFamily: FONTS.mono.bold,
    fontSize: TIMER_FONT_SIZE_MAX,
    color: '#FFFFFF',
    lineHeight: 80,
    letterSpacing: -2,
    ...Platform.select({
      ios: {
        textShadowColor: 'rgba(255, 255, 255, 0.15)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 20,
      },
    }),
  },
  pausedBadge: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  pausedBadgeText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 2,
  },
  sessionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  sessionMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sessionMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#3F3F46',
  },
  sessionMetaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: '#A1A1AA',
    letterSpacing: 2,
  },

  /* ── Rest Timer Bar ──────────────────────── */
  restTimerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  restTimerProgress: {
    flex: 1,
  },
  restTimerTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  restTimerFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
  restTimerText: {
    fontSize: 14,
    color: COLORS.accent,
    minWidth: 36,
    textAlign: 'right',
  },

  /* ── Void (Empty State) ─────────────────── */
  voidState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  voidIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  voidTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#52525B',
    letterSpacing: 3,
    marginBottom: 6,
  },
  voidSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#3F3F46',
  },

  /* ── Scroll ─────────────────────────────── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    gap: 14,
  },
  scrollContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  /* ── Exercise Card ──────────────────────── */
  exerciseCardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  exerciseCardGradient: {
    borderRadius: 19,
  },
  exerciseCardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  exerciseCardHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  exerciseCardName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  exerciseCardMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: '#52525B',
    letterSpacing: 2,
  },
  exerciseCardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: SPACING.md,
  },
  exerciseDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseSetsBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: '#8B5CF6',
    minWidth: 36,
  },
  exerciseSetsValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    color: '#8B5CF6',
    lineHeight: 17,
    textAlign: 'center',
  },

  /* ── Set Rows ───────────────────────────── */
  setsList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  setRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  setRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  setRowLabel: {
    fontFamily: FONTS.ui.bold,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 2,
  },
  setRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setNotesButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  setMetricDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  setMetricLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: '#52525B',
    letterSpacing: 2,
  },
  setMetricValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 18,
    color: '#8B5CF6',
    lineHeight: 22,
  },
  setMetricValueEmpty: {
    color: '#3F3F46',
  },

  /* ── Add Set Row ────────────────────────── */
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
  },
  addSetRowText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },

  /* ── Bottom Panel ─────────────────────── */
  bottomPanel: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 12,
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    gap: 10,
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  addExerciseText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlDiscardButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlPauseButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  controlPauseLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#A1A1AA',
    letterSpacing: 0.3,
  },
  controlFinishButton: {
    flex: 1.4,
    flexDirection: 'row' as const,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  controlFinishLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
});
