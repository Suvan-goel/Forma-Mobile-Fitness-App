import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  useWindowDimensions,
  AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { startWorkoutActivity, endWorkoutActivity } from 'expo-live-activity';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Flag,
  Timer,
  Video,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_ELEVATED, CARD_GRADIENT_START, CARD_GRADIENT_END, CARD_RADIUS, getScoreColor ,
  SCREEN_GRADIENT_COLORS, SCREEN_GRADIENT_START, SCREEN_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';
import CogIcon from '../components/icons/CogIcon';
import { MonoText } from '../components/typography/MonoText';
import { useCurrentWorkout, LoggedSet } from '../contexts/CurrentWorkoutContext';
import { SetNotesModal } from '../components/ui/SetNotesModal';
import { WeightInputModal } from '../components/ui/WeightInputModal';
import { RecordingOptionsModal } from '../components/ui/RecordingOptionsModal';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { useAlert } from '../contexts/AlertContext';
import { cleanupTempRecording } from '../../backend/services/screenRecording';

export type { LoggedSet };

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: LoggedSet; showWeightFor?: { exerciseId: string; hasRecording?: boolean } } | undefined;
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

const getTimerParts = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [
    h.toString().padStart(2, '0'),
    ':',
    m.toString().padStart(2, '0'),
    ':',
    s.toString().padStart(2, '0'),
  ];
};

/* ── Self-contained Timer Display (memo'd to avoid re-rendering parent) ──── */

const WorkoutTimerDisplay = React.memo(({
  startTimeRef,
  isPausedRef,
  contextElapsed,
  elapsedSecondsRef,
  timerFontSize,
  timerLineHeight,
}: {
  startTimeRef: React.RefObject<number | null>;
  isPausedRef: React.RefObject<boolean>;
  contextElapsed: number;
  elapsedSecondsRef: React.RefObject<number>;
  timerFontSize: number;
  timerLineHeight: number;
}) => {
  const [seconds, setSeconds] = useState(contextElapsed);

  useEffect(() => {
    const startFrom = contextElapsed > 0 ? contextElapsed : 0;
    startTimeRef.current = Date.now() - startFrom * 1000;
    setSeconds(startFrom);
    elapsedSecondsRef.current = startFrom;

    const recalc = () => {
      if (isPausedRef.current) return;
      if (startTimeRef.current !== null) {
        const val = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setSeconds(val);
        elapsedSecondsRef.current = val;
      }
    };

    const interval = setInterval(recalc, 1000);

    // Force immediate recalculation when app returns from background
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') recalc();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [contextElapsed, startTimeRef, isPausedRef, elapsedSecondsRef]);

  const digitStyle = useMemo(
    () => [styles.timerDigit, { fontSize: timerFontSize, lineHeight: timerLineHeight }],
    [timerFontSize, timerLineHeight],
  );
  const colonStyle = useMemo(
    () => [styles.timerColon, { fontSize: timerFontSize * 0.7, lineHeight: timerLineHeight }],
    [timerFontSize, timerLineHeight],
  );

  return (
    <View style={styles.timerDisplay}>
      {getTimerParts(seconds).map((part, i) => (
        <MonoText key={i} style={part === ':' ? colonStyle : digitStyle}>
          {part}
        </MonoText>
      ))}
    </View>
  );
});

/* ── Main Screen ──────────────────────────── */

const TIMER_FONT_SIZE_MAX = 15;
const TIMER_FONT_SIZE_MIN = 13;

export const CurrentWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<CurrentWorkoutNavigationProp>();
  const route = useRoute<CurrentWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { width: windowWidth } = useWindowDimensions();
  const timerFontSize = Math.min(
    TIMER_FONT_SIZE_MAX,
    Math.max(TIMER_FONT_SIZE_MIN, (windowWidth - 2 * SPACING.screenHorizontal) / 6)
  );
  const timerLineHeight = Math.round(timerFontSize * 1.15);
  const {
    exercises,
    addSet,
    clearSets,
    updateSetWeight,
    attachRecordingToSet,
    updateSetRecordingFlags,
    removeExercise,
    removeSetFromExercise,
    setWorkoutInProgress,
    workoutElapsedSeconds: contextElapsed,
    setWorkoutElapsedSeconds,
    workoutPaused,
    pendingRecording,
    setPendingRecording,
  } = useCurrentWorkout();
  const elapsedSecondsRef = useRef(contextElapsed);
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
    showRecordingOptions?: boolean;
  } | null>(null);
  const [recordingOptionsModal, setRecordingOptionsModal] = useState<{
    exerciseId: string;
    exerciseName: string;
    setIndex: number;
    saveToLibrary: boolean;
    saveToCameraRoll: boolean;
  } | null>(null);
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const prevSetCountsRef = useRef<Map<string, number>>(new Map());
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const weightModalDataRef = useRef(weightModalData);
  weightModalDataRef.current = weightModalData;
  const { restTimerEnabled, restTimerDurationSeconds } = useCameraSettings();
  isPausedRef.current = workoutPaused;

  /* ── Timer logic (interval lives inside WorkoutTimerDisplay) ──── */

  useEffect(() => {
    setWorkoutInProgress(true);
    startWorkoutActivity(elapsedSecondsRef.current);
  }, [setWorkoutInProgress]);

  /* ── Rest timer logic ──── */

  const startRestTimer = useCallback(() => {
    if (!restTimerEnabled || restTimerDurationSeconds <= 0) return;
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
        const exercise = exercisesRef.current.find((ex) => ex.id === showWeightFor.exerciseId);
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
            showRecordingOptions: !!showWeightFor.hasRecording,
          });
        }
        navigation.setParams({ showWeightFor: undefined });
      }
    }, [route.params?.newSet, route.params?.showWeightFor, addSet, navigation, startRestTimer])
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

  const toggleExerciseExpanded = useCallback((exerciseId: string) => {
    setExpandedExerciseIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(exerciseId)) {
        newSet.delete(exerciseId);
      } else {
        newSet.add(exerciseId);
      }
      return newSet;
    });
  }, []);

  const handleAddExercise = useCallback(() => {
    navigation.navigate('ChooseExercise');
  }, [navigation]);

  const handleAddSet = useCallback((exercise: { id: string; name: string; category: string }) => {
    navigation.navigate('Camera', {
      exerciseName: exercise.name,
      category: exercise.category,
      exerciseId: exercise.id,
      returnToCurrentWorkout: true,
    });
  }, [navigation]);

  const handleEndWorkout = useCallback(() => {
    const currentExercises = exercisesRef.current;
    const currentSets = currentExercises.flatMap((ex) => ex.sets);
    if (currentSets.length === 0) {
      showAlert('No sets recorded', 'Add at least one set before ending the workout.');
      return;
    }
    const totalSets = currentSets.length;
    const totalReps = currentSets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      currentSets.reduce((sum, set) => sum + set.formScore, 0) / currentSets.length
    );
    const category = currentExercises[0]?.name || 'General';
    const duration = formatStopwatch(elapsedSecondsRef.current);
    endWorkoutActivity();
    navigation.navigate('SaveWorkout', {
      workoutData: { category, duration, totalSets, totalReps, avgFormScore },
    });
  }, [navigation, showAlert]);

  const handleGoBack = useCallback(() => {
    setWorkoutElapsedSeconds(elapsedSecondsRef.current);
    navigation.reset({ index: 0, routes: [{ name: 'RecordLanding' }] });
  }, [setWorkoutElapsedSeconds, navigation]);

  // Auto-attach pending recording to the latest set when it arrives
  useEffect(() => {
    if (!pendingRecording) return;
    const exercise = exercises.find((ex) => ex.name === pendingRecording.exerciseName);
    if (exercise) {
      // Find the latest set without a recording attached
      let targetIndex = -1;
      for (let i = exercise.sets.length - 1; i >= 0; i--) {
        if (!exercise.sets[i].tempRecordingUrl) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex >= 0) {
        attachRecordingToSet(exercise.id, targetIndex, pendingRecording.tempUrl);
      }
    }
    setPendingRecording(null);
  }, [pendingRecording, exercises, attachRecordingToSet, setPendingRecording]);

  const handleSaveRecordingPrefs = useCallback((saveToLibrary: boolean, saveToCameraRoll: boolean) => {
    const data = weightModalDataRef.current;
    if (!data) return;
    updateSetRecordingFlags(data.exerciseId, data.setIndex, { saveToLibrary, saveToCameraRoll });
  }, [updateSetRecordingFlags]);

  const handleWeightSubmit = useCallback((weight: number, unit: 'kg' | 'lbs') => {
    const data = weightModalDataRef.current;
    if (data) {
      updateSetWeight(data.exerciseId, data.setIndex, weight, unit);
      setWeightModalData(null);
    }
  }, [updateSetWeight]);

  const handleEditWeight = useCallback((
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
  }, []);

  const handleDeleteExercise = useCallback((exerciseId: string, exerciseName: string, setCount: number) => {
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
  }, [showAlert, removeExercise]);

  const handleDeleteSet = useCallback((exerciseId: string, exerciseName: string, setIndex: number) => {
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
  }, [showAlert, removeSetFromExercise]);

  const handleDiscardWorkout = useCallback(() => {
    showAlert(
      'Discard Workout',
      'Are you sure? This will delete all recorded sets and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // Clean up all temp recording files
            for (const ex of exercisesRef.current) {
              for (const s of ex.sets) {
                if (s.tempRecordingUrl) {
                  cleanupTempRecording(s.tempRecordingUrl).catch(() => {});
                }
              }
            }
            endWorkoutActivity();
            clearSets();
            setWorkoutElapsedSeconds(0);
            setWorkoutInProgress(false);
            navigation.reset({ index: 0, routes: [{ name: 'RecordLanding' }] });
          },
        },
      ]
    );
  }, [showAlert, clearSets, setWorkoutElapsedSeconds, setWorkoutInProgress, navigation]);

  /* ── Computed ──── */
  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const totalReps = exercises.reduce(
    (sum, exercise) => sum + exercise.sets.reduce((setSum, set) => setSum + set.reps, 0),
    0
  );
  const workoutTitle = exercises.length > 0 ? 'Free Session' : 'Current Workout';


  /* ── Render ──── */

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      {/* ── HEADER ──────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerIconButton} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Current Workout</Text>
          <View style={styles.headerTimerPill}>
          <WorkoutTimerDisplay
            startTimeRef={startTimeRef}
            isPausedRef={isPausedRef}
            contextElapsed={contextElapsed}
            elapsedSecondsRef={elapsedSecondsRef}
            timerFontSize={timerFontSize}
            timerLineHeight={timerLineHeight}
          />
          </View>
        </View>

        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation.navigate('WorkoutSettings')}
          activeOpacity={0.7}
        >
          <CogIcon size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
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
            exercises.length === 0
              ? styles.scrollContentEmpty
              : { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 180 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {exercises.length === 0 ? (
            /* ── Empty State ──── */
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Dumbbell size={32} color={COLORS.textTertiary} strokeWidth={1} />
              </View>
              <Text style={styles.emptyTitle}>No exercises yet</Text>
              <Text style={styles.emptySubtext}>Tap below to add your first exercise</Text>
            </View>
          ) : (
            /* ── EXERCISE CARDS ──── */
            <>
            <View style={styles.summaryCardOuter}>
              <LinearGradient
                colors={CARD_GRADIENT_ELEVATED as any}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.summaryCardGradient}
              >
                <View style={styles.summaryCardEdge}>
                  <Text style={styles.summaryEyebrow}>WORKOUT</Text>
                  <Text style={styles.summaryTitle}>{workoutTitle}</Text>
                  <Text style={styles.summaryMeta}>
                    {exercises.length} exercise{exercises.length === 1 ? '' : 's'} · {totalSets} set{totalSets === 1 ? '' : 's'} · {totalReps} reps
                  </Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.exercisesSectionRow}>
              <View style={styles.exercisesSectionLabelRow}>
                <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
                <Text style={styles.exercisesSectionLabel}>EXERCISES</Text>
              </View>
              <Text style={styles.exercisesCount}>{exercises.length}</Text>
            </View>
            {exercises.map((exercise) => {
              const isExpanded = expandedExerciseIds.has(exercise.id);
              return (
                <View key={exercise.id} style={styles.exerciseCardOuter}>
                  <LinearGradient
                    colors={CARD_GRADIENT_COLORS as any}
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
                        <View style={styles.exerciseAccentLine} />
                        <View style={styles.exerciseCardHeaderLeft}>
                          <Text style={styles.exerciseCardName}>{exercise.name}</Text>
                          <Text style={styles.exerciseCardMeta}>
                            {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'} recorded
                          </Text>
                        </View>
                        <View style={styles.exerciseCardHeaderRight}>
                          {isExpanded ? (
                            <ChevronUp size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                          ) : (
                            <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                          )}
                          <TouchableOpacity
                            onPress={() => handleDeleteExercise(exercise.id, exercise.name, exercise.sets.length)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.exerciseDeleteBtn}
                          >
                            <Trash2 size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>

                      {/* Expanded Sets */}
                      {isExpanded && (
                        <View style={styles.setsList}>
                          {exercise.sets.map((set, setIndex) => {
                            const isCurrentSet = setIndex === exercise.sets.length - 1;
                            return (
                              <TouchableOpacity
                                key={setIndex}
                                style={[styles.setRow, isCurrentSet && styles.setRowCurrent]}
                                activeOpacity={0.76}
                                onPress={() =>
                                  handleEditWeight(
                                    exercise.id,
                                    exercise.name,
                                    setIndex,
                                    set.weight,
                                    set.weightUnit
                                  )
                                }
                                onLongPress={() => handleDeleteSet(exercise.id, exercise.name, setIndex)}
                              >
                                <MonoText bold style={[styles.setIndexText, isCurrentSet && styles.setIndexTextCurrent]}>
                                  {setIndex + 1}
                                </MonoText>
                                <Text style={[styles.setValueText, !set.weight && styles.setValueTextEmpty]}>
                                  {set.weight && set.weight > 0 ? `${set.weight} ${set.weightUnit || 'kg'}` : 'No weight'}
                                </Text>
                                <Text style={styles.setRepsText}>x {set.reps}</Text>
                                {isCurrentSet ? <Text style={styles.currentSetText}>Current</Text> : null}
                                <TouchableOpacity
                                  style={[styles.setScoreRing, { borderColor: getScoreColor(set.formScore) }]}
                                  onPress={() =>
                                    setNotesModalSet({
                                      set,
                                      setIndex: setIndex + 1,
                                      exerciseName: exercise.name,
                                    })
                                  }
                                  activeOpacity={0.7}
                                >
                                  <MonoText bold style={[styles.setScoreText, { color: getScoreColor(set.formScore) }]}>
                                    {set.formScore}
                                  </MonoText>
                                </TouchableOpacity>
                                {set.tempRecordingUrl ? (
                                  <TouchableOpacity
                                    style={styles.setCompactIcon}
                                    onPress={() =>
                                      setRecordingOptionsModal({
                                        exerciseId: exercise.id,
                                        exerciseName: exercise.name,
                                        setIndex,
                                        saveToLibrary: set.saveRecordingToLibrary !== false,
                                        saveToCameraRoll: set.saveToCameraRoll === true,
                                      })
                                    }
                                    activeOpacity={0.7}
                                  >
                                    <Video
                                      size={12}
                                      color={set.saveRecordingToLibrary !== false ? COLORS.accent : COLORS.textTertiary}
                                      strokeWidth={1.5}
                                    />
                                  </TouchableOpacity>
                                ) : (
                                  <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}

                      {/* Add Set Row */}
                      <TouchableOpacity
                        style={styles.addSetRow}
                        onPress={() => handleAddSet(exercise)}
                        activeOpacity={0.7}
                      >
                        <Plus size={13} color={COLORS.accent} strokeWidth={2.5} />
                        <Text style={styles.addSetRowText}>Add set</Text>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </View>
              );
            })}
            </>
          )}
        </ScrollView>
      </View>

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
          hasRecording={!!weightModalData.showRecordingOptions}
          onSaveRecording={handleSaveRecordingPrefs}
        />
      )}
      {recordingOptionsModal && (
        <RecordingOptionsModal
          visible={!!recordingOptionsModal}
          onClose={() => setRecordingOptionsModal(null)}
          saveToLibrary={recordingOptionsModal.saveToLibrary}
          saveToCameraRoll={recordingOptionsModal.saveToCameraRoll}
          onUpdate={(saveToLibrary, saveToCameraRoll) => {
            updateSetRecordingFlags(recordingOptionsModal.exerciseId, recordingOptionsModal.setIndex, {
              saveToLibrary,
              saveToCameraRoll,
            });
            setRecordingOptionsModal((prev) => prev ? { ...prev, saveToLibrary, saveToCameraRoll } : null);
          }}
          exerciseName={recordingOptionsModal.exerciseName}
          setNumber={recordingOptionsModal.setIndex + 1}
        />
      )}

      {/* ── BOTTOM PANEL ── */}
      <View style={[styles.bottomPanel, { paddingBottom: Math.max(insets.bottom, SPACING.md) + 4 }]}>
        {/* Add Exercise — Gradient CTA */}
        <TouchableOpacity onPress={handleAddExercise} activeOpacity={0.85}>
          <LinearGradient
            colors={['rgba(124, 92, 255, 0.08)', 'rgba(124, 92, 255, 0.03)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.addExerciseGradient}
          >
            <View style={styles.addExerciseIconWrap}>
              <Plus size={14} color={COLORS.accent} strokeWidth={2.5} />
            </View>
            <Text style={styles.addExerciseText}>Add Exercise</Text>
            <ChevronRight size={16} color="rgba(255,255,255,0.5)" strokeWidth={1.5} />
          </LinearGradient>
        </TouchableOpacity>

        {/* Controls Row */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.controlDiscardButton}
            onPress={handleDiscardWorkout}
            activeOpacity={0.7}
          >
            <Trash2 size={15} color="#EF4444" strokeWidth={1.5} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlFinishButton}
            onPress={handleEndWorkout}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={['#7A55FF', '#633FE5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.controlFinishGradient}
            >
              <Flag size={14} color={COLORS.text} strokeWidth={1.5} />
              <Text style={styles.controlFinishLabel}>Finish</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 6,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
    gap: 5,
  },
  headerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  headerTimerPill: {
    minWidth: 76,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  timerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    color: COLORS.textSecondary,
    letterSpacing: 1.4,
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    color: COLORS.textTertiary,
    marginHorizontal: 1,
  },


  /* ── Rest Timer Bar ──────────────────────── */
  restTimerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: CARD_RADIUS,
    backgroundColor: 'rgba(32, 40, 46, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  restTimerProgress: {
    flex: 1,
  },
  restTimerTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
  },
  restTimerFill: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.accent,
  },
  restTimerText: {
    fontSize: 13,
    color: COLORS.accent,
    minWidth: 36,
    textAlign: 'right',
  },

  /* ── Empty State ─────────────────────────── */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.textTertiary,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  emptySubtext: {
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
    gap: 8,
  },
  scrollContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  /* ── Exercises Section Header ──────────── */
  exercisesSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    marginTop: 4,
  },
  exercisesSectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exercisesSectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 10.5,
    color: COLORS.text,
    letterSpacing: 2,
  },
  exercisesCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  /* ── Workout Summary ───────────────────── */
  summaryCardOuter: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  summaryCardGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  summaryCardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  summaryEyebrow: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8,
    color: COLORS.textTertiary,
    letterSpacing: 1.4,
    marginBottom: 5,
  },
  summaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  summaryMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  /* ── Exercise Card ──────────────────────── */
  exerciseCardOuter: {
    borderRadius: CARD_RADIUS,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  exerciseCardGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  exerciseCardGlassEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 10,
  },
  exerciseAccentLine: {
    width: 2,
    height: 30,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },
  exerciseCardHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  exerciseCardName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  exerciseCardMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
  },
  exerciseCardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Set Rows ───────────────────────────── */
  setsList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.055)',
  },
  setRowCurrent: {
    marginHorizontal: 5,
    marginVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.86)',
    borderBottomWidth: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(122, 85, 255, 0.07)',
  },
  setIndexText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 18,
    width: 24,
    textAlign: 'center',
  },
  setIndexTextCurrent: {
    color: COLORS.text,
  },
  setValueText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  setValueTextEmpty: {
    color: COLORS.textTertiary,
  },
  setRepsText: {
    width: 44,
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  currentSetText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    marginRight: 2,
  },
  setScoreRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 12, 14, 0.28)',
  },
  setScoreText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    lineHeight: 14,
  },
  setCompactIcon: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Add Set Row ────────────────────────── */
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
  },
  addSetRowText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },

  /* ── Bottom Panel ─────────────────────── */
  bottomPanel: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 10,
    backgroundColor: 'rgba(15, 20, 25, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
    gap: 8,
  },
  addExerciseGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 92, 255, 0.65)',
  },
  addExerciseIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addExerciseText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: 0,
    flex: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlDiscardButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlFinishButton: {
    flex: 1,
    height: 52,
    borderRadius: 13,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  controlFinishGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  controlFinishLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
});
