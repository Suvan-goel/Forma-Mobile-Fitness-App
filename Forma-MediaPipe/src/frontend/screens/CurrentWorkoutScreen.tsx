import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Modal,
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
  ChevronDown,
  ChevronUp,
  Video,
  FileText,
  Pause,
  Play,
  Check,
  Trash2,
  X,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_ELEVATED, CARD_GRADIENT_START, CARD_GRADIENT_END, CARD_RADIUS, CARD_VERTICAL_GAP, getScoreColor,
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

type ManualSetValues = {
  reps: number;
  weight?: number;
  unit: 'kg' | 'lbs';
};

type ManualSetModalProps = {
  visible: boolean;
  exerciseName: string;
  setNumber: number;
  initialUnit: 'kg' | 'lbs';
  onClose: () => void;
  onSubmit: (values: ManualSetValues) => void;
};

const cleanDecimalInput = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole, ...decimals] = cleaned.split('.');
  return decimals.length > 0 ? `${whole}.${decimals.join('')}` : whole;
};

const ManualSetModal = React.memo(({
  visible,
  exerciseName,
  setNumber,
  initialUnit,
  onClose,
  onSubmit,
}: ManualSetModalProps) => {
  const [repsInput, setRepsInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>(initialUnit);

  useEffect(() => {
    if (!visible) return;
    setRepsInput('');
    setWeightInput('');
    setUnit(initialUnit);
  }, [visible, initialUnit]);

  const reps = Number.parseInt(repsInput, 10);
  const weight = weightInput.trim().length > 0 ? Number.parseFloat(weightInput) : 0;
  const canSubmit = Number.isFinite(reps) && reps > 0 && Number.isFinite(weight) && weight >= 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      reps,
      weight: weight > 0 ? weight : undefined,
      unit,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.manualModalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.manualModalBackdropPressable} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity style={styles.manualModalCardOuter} activeOpacity={1} onPress={() => {}}>
            <LinearGradient
              colors={SCREEN_GRADIENT_COLORS as any}
              start={SCREEN_GRADIENT_START}
              end={SCREEN_GRADIENT_END}
              style={styles.manualModalGradient}
            >
              <View style={styles.manualModalEdge}>
                <View style={styles.manualModalHeader}>
                  <View>
                    <Text style={styles.manualModalTitle}>Manual Set</Text>
                    <Text style={styles.manualModalSubtitle} numberOfLines={1}>
                      {exerciseName} · Set {setNumber}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.manualModalClose}
                    onPress={onClose}
                    activeOpacity={0.72}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Close manual set"
                  >
                    <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
                  </TouchableOpacity>
                </View>

                <View style={styles.manualInfoRow}>
                  <FileText size={13} color={COLORS.accent} strokeWidth={1.7} />
                  <Text style={styles.manualInfoText}>
                    Tracks reps and weight only. No form feedback or recording will be attached.
                  </Text>
                </View>

                <View style={styles.manualInputsRow}>
                  <View style={styles.manualInputGroup}>
                    <Text style={styles.manualInputLabel}>REPS</Text>
                    <TextInput
                      style={styles.manualInput}
                      value={repsInput}
                      onChangeText={(value) => setRepsInput(value.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      returnKeyType="next"
                      placeholder="0"
                      placeholderTextColor="rgba(255, 255, 255, 0.22)"
                      autoFocus
                      selectTextOnFocus
                    />
                  </View>
                  <View style={styles.manualInputGroup}>
                    <Text style={styles.manualInputLabel}>WEIGHT</Text>
                    <View style={styles.manualWeightInputWrap}>
                      <TextInput
                        style={[styles.manualInput, styles.manualWeightInput]}
                        value={weightInput}
                        onChangeText={(value) => setWeightInput(cleanDecimalInput(value))}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={handleSubmit}
                        placeholder="0"
                        placeholderTextColor="rgba(255, 255, 255, 0.22)"
                        selectTextOnFocus
                      />
                      <Text style={styles.manualWeightUnit}>{unit}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.manualUnitRow}>
                  <TouchableOpacity
                    style={[styles.manualUnitButton, unit === 'kg' && styles.manualUnitButtonActive]}
                    onPress={() => setUnit('kg')}
                    activeOpacity={0.72}
                  >
                    <Text style={[styles.manualUnitText, unit === 'kg' && styles.manualUnitTextActive]}>kg</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.manualUnitButton, unit === 'lbs' && styles.manualUnitButtonActive]}
                    onPress={() => setUnit('lbs')}
                    activeOpacity={0.72}
                  >
                    <Text style={[styles.manualUnitText, unit === 'lbs' && styles.manualUnitTextActive]}>lbs</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.manualSubmitButton, !canSubmit && styles.manualSubmitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel="Add manual set"
                >
                  <Check size={16} color={COLORS.text} strokeWidth={2.4} />
                  <Text style={styles.manualSubmitText}>Add Manual Set</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
});

/* ── Main Screen ──────────────────────────── */

const TIMER_FONT_SIZE_MAX = 15;
const TIMER_FONT_SIZE_MIN = 14;
const LOWER_BODY_EXERCISE_PATTERN = /squat|deadlift|lunge|leg|calf|hamstring|quad|glute|hip/i;

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
    addSetToExercise,
    clearSets,
    updateSetWeight,
    updateSetRecordingFlags,
    removeExercise,
    removeSetFromExercise,
    setWorkoutInProgress,
    workoutElapsedSeconds: contextElapsed,
    setWorkoutElapsedSeconds,
    workoutPaused,
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
  const [manualSetModal, setManualSetModal] = useState<{
    exerciseId: string;
    exerciseName: string;
    setNumber: number;
    initialUnit: 'kg' | 'lbs';
  } | null>(null);
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null);
  const [restTimerPaused, setRestTimerPaused] = useState(false);
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

  const clearRestTimer = useCallback(() => {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    restIntervalRef.current = null;
    setRestTimerPaused(false);
    setRestSecondsLeft(null);
  }, []);

  const runRestTimer = useCallback((durationSeconds: number) => {
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    const endTime = Date.now() + durationSeconds * 1000;
    restIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRestSecondsLeft(remaining);
      if (remaining <= 0) {
        clearRestTimer();
      }
    }, 1000);
  }, [clearRestTimer]);

  const startRestTimer = useCallback(() => {
    if (!restTimerEnabled || restTimerDurationSeconds <= 0) return;
    setRestTimerPaused(false);
    setRestSecondsLeft(restTimerDurationSeconds);
    runRestTimer(restTimerDurationSeconds);
  }, [restTimerEnabled, restTimerDurationSeconds, runRestTimer]);

  const toggleRestTimerPaused = useCallback(() => {
    setRestTimerPaused((wasPaused) => {
      if (wasPaused) {
        const secondsToResume = restSecondsLeft ?? 0;
        if (secondsToResume > 0) {
          runRestTimer(secondsToResume);
          return false;
        }
        return wasPaused;
      }

      if (restIntervalRef.current) clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
      return true;
    });
  }, [restSecondsLeft, runRestTimer]);

  const handleDeleteRestTimer = useCallback(() => {
    showAlert(
      'Delete rest timer?',
      'Are you sure you want to delete this rest timer?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: clearRestTimer,
        },
      ]
    );
  }, [clearRestTimer, showAlert]);

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

  const handleOpenManualSet = useCallback((exercise: { id: string; name: string; sets: LoggedSet[] }) => {
    const mostRecentUnit = [...exercise.sets].reverse().find((set) => set.weightUnit)?.weightUnit ?? 'kg';
    setManualSetModal({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setNumber: exercise.sets.length + 1,
      initialUnit: mostRecentUnit,
    });
  }, []);

  const handleManualSetSubmit = useCallback((values: ManualSetValues) => {
    if (!manualSetModal) return;
    addSetToExercise(manualSetModal.exerciseId, {
      exerciseName: manualSetModal.exerciseName,
      reps: values.reps,
      weight: values.weight,
      weightUnit: values.unit,
      formScore: 0,
      repFeedback: [],
      repFormScores: [],
      isManual: true,
    });
    setExpandedExerciseIds((prev) => new Set(prev).add(manualSetModal.exerciseId));
    setManualSetModal(null);
    startRestTimer();
  }, [addSetToExercise, manualSetModal, startRestTimer]);

  const handleEndWorkout = useCallback(() => {
    const currentExercises = exercisesRef.current;
    const currentSets = currentExercises.flatMap((ex) => ex.sets);
    if (currentSets.length === 0) {
      showAlert('No sets recorded', 'Add at least one set before ending the workout.');
      return;
    }
    const totalSets = currentSets.length;
    const totalReps = currentSets.reduce((sum, set) => sum + set.reps, 0);
    const scoredSets = currentSets.filter((set) => !set.isManual && set.formScore > 0);
    const avgFormScore = scoredSets.length > 0
      ? Math.round(scoredSets.reduce((sum, set) => sum + set.formScore, 0) / scoredSets.length)
      : 0;
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
  const workoutTitle = exercises.length === 0
    ? 'Current Workout'
    : exercises.every((exercise) => LOWER_BODY_EXERCISE_PATTERN.test(exercise.name))
      ? 'Lower Body Strength'
      : 'Strength Workout';
  const activeRestExerciseId = restSecondsLeft !== null
    ? [...exercises].reverse().find((exercise) => exercise.sets.length > 0)?.id
    : null;


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
          <ChevronLeft size={23} color={COLORS.textSecondary} strokeWidth={1.7} />
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
          <CogIcon size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {/* ── CONTENT AREA ────────────────────── */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            exercises.length === 0
              ? styles.scrollContentEmpty
              : { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 146 },
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
                    {exercises.length} exercise{exercises.length === 1 ? '' : 's'}
                  </Text>
                </View>
              </LinearGradient>
            </View>

            {exercises.map((exercise, exerciseIndex) => {
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
                        onLongPress={() => handleDeleteExercise(exercise.id, exercise.name, exercise.sets.length)}
                        activeOpacity={0.7}
                      >
                        <MonoText bold style={styles.exerciseNumberText}>{exerciseIndex + 1}</MonoText>
                        <View style={styles.exerciseCardHeaderLeft}>
                          <Text style={styles.exerciseCardName}>{exercise.name}</Text>
                        </View>
                        <View style={styles.exerciseCardHeaderRight}>
                          <Text style={styles.exerciseCardMeta}>
                            {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}
                          </Text>
                          {isExpanded ? (
                            <ChevronUp size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                          ) : (
                            <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                          )}
                        </View>
                      </TouchableOpacity>

                      {/* Expanded Sets */}
                      {isExpanded && (
                        <View style={styles.setsList}>
                          {exercise.sets.map((set, setIndex) => {
                            const isCurrentSet = setIndex === exercise.sets.length - 1;
                            const isManualSet = set.isManual === true;
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
                                {isCurrentSet && !isManualSet ? <Text style={styles.currentSetText}>Current</Text> : null}
                                {isManualSet ? (
                                  <View style={styles.manualSetBadge}>
                                    <FileText size={10} color={COLORS.accent} strokeWidth={1.8} />
                                    <Text style={styles.manualSetBadgeText}>Manual</Text>
                                  </View>
                                ) : !isCurrentSet && (
                                  <View
                                    style={[styles.setScoreRing, { borderColor: getScoreColor(set.formScore) }]}
                                  >
                                    <MonoText bold style={[styles.setScoreText, { color: getScoreColor(set.formScore) }]}>
                                      {set.formScore}
                                    </MonoText>
                                  </View>
                                )}
                                {!isManualSet && (
                                  <TouchableOpacity
                                    style={styles.setNotesButton}
                                    onPress={() =>
                                      setNotesModalSet({
                                        set,
                                        setIndex: setIndex + 1,
                                        exerciseName: exercise.name,
                                      })
                                    }
                                    activeOpacity={0.72}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Open notes for ${exercise.name} set ${setIndex + 1}`}
                                  >
                                    <FileText size={13} color={COLORS.accent} strokeWidth={1.8} />
                                  </TouchableOpacity>
                                )}
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
                                  <ChevronRight size={13} color={COLORS.textTertiary} strokeWidth={1.5} />
                                )}
                              </TouchableOpacity>
                            );
                          })}
                          {restSecondsLeft !== null && activeRestExerciseId === exercise.id && (
                            <View style={styles.restTimerCard}>
                              <View style={styles.restTimerDial}>
                                <View
                                  style={[
                                    styles.restTimerDialProgress,
                                    { borderColor: COLORS.accent, opacity: Math.max(0.25, restSecondsLeft / restTimerDurationSeconds) },
                                  ]}
                                />
                                <MonoText bold style={styles.restTimerDialText}>
                                  {Math.floor(restSecondsLeft / 60)}:{(restSecondsLeft % 60).toString().padStart(2, '0')}
                                </MonoText>
                              </View>
                              <View style={styles.restTimerCopy}>
                                <Text style={styles.restTimerTitle}>Rest Timer</Text>
                                <Text style={styles.restTimerSubtitle}>
                                  {restTimerPaused ? 'Paused' : `${Math.round(restTimerDurationSeconds / 60)} min rest`}
                                </Text>
                              </View>
                              <View style={styles.restTimerActions}>
                                <TouchableOpacity
                                  style={[styles.restTimerActionButton, restTimerPaused && styles.restTimerPauseButtonActive]}
                                  onPress={toggleRestTimerPaused}
                                  activeOpacity={0.78}
                                  accessibilityRole="button"
                                  accessibilityLabel={restTimerPaused ? 'Resume rest timer' : 'Pause rest timer'}
                                >
                                  {restTimerPaused ? (
                                    <Play size={18} color={COLORS.text} fill={COLORS.text} strokeWidth={1.8} />
                                  ) : (
                                    <Pause size={18} color={COLORS.text} fill={COLORS.text} strokeWidth={1.6} />
                                  )}
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.restTimerActionButton, styles.restTimerDeleteButton]}
                                  onPress={handleDeleteRestTimer}
                                  activeOpacity={0.78}
                                  accessibilityRole="button"
                                  accessibilityLabel="Delete rest timer"
                                >
                                  <Trash2 size={17} color={COLORS.red} strokeWidth={1.8} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}
                        </View>
                      )}

                      {/* Add Set Row */}
                      <View style={styles.addSetRow}>
                        <TouchableOpacity
                          style={[styles.addSetAction, styles.addSetActionPrimary]}
                          onPress={() => handleAddSet(exercise)}
                          activeOpacity={0.74}
                          accessibilityRole="button"
                          accessibilityLabel={`Record set for ${exercise.name}`}
                        >
                          <Video size={13} color={COLORS.accent} strokeWidth={1.8} />
                          <Text style={styles.addSetActionText}>Record set</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.addSetAction}
                          onPress={() => handleOpenManualSet(exercise)}
                          activeOpacity={0.74}
                          accessibilityRole="button"
                          accessibilityLabel={`Manually add set for ${exercise.name}`}
                        >
                          <Plus size={13} color={COLORS.accent} strokeWidth={2.5} />
                          <Text style={styles.addSetActionText}>Manual</Text>
                        </TouchableOpacity>
                      </View>
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
      {manualSetModal && (
        <ManualSetModal
          visible={!!manualSetModal}
          exerciseName={manualSetModal.exerciseName}
          setNumber={manualSetModal.setNumber}
          initialUnit={manualSetModal.initialUnit}
          onClose={() => setManualSetModal(null)}
          onSubmit={handleManualSetSubmit}
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
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlFinishButton}
          onPress={handleEndWorkout}
          onLongPress={handleDiscardWorkout}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#7A55FF', '#633FE5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.controlFinishGradient}
          >
            <Text style={styles.controlFinishLabel}>Finish Workout</Text>
          </LinearGradient>
        </TouchableOpacity>
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 0,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 13,
    gap: 3,
  },
  headerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    lineHeight: 30,
    color: COLORS.text,
    letterSpacing: -0.15,
  },
  headerTimerPill: {
    minWidth: 92,
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
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
    paddingTop: CARD_VERTICAL_GAP,
    gap: CARD_VERTICAL_GAP,
  },
  scrollContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  /* ── Workout Summary ───────────────────── */
  summaryCardOuter: {
    borderRadius: 8,
    ...CARD_SHADOW,
  },
  summaryCardGradient: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  summaryCardEdge: {
    minHeight: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    paddingTop: 13,
    paddingBottom: 15,
  },
  summaryEyebrow: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  summaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  summaryMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textSecondary,
    marginTop: 2,
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
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 11,
  },
  exerciseNumberText: {
    width: 18,
    fontSize: 16,
    lineHeight: 20,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  exerciseCardHeaderLeft: {
    flex: 1,
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
    gap: 9,
  },

  /* ── Set Rows ───────────────────────────── */
  setsList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 9,
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
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 18,
    width: 18,
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
    minWidth: 48,
  },
  setValueTextEmpty: {
    color: COLORS.textTertiary,
  },
  setRepsText: {
    width: 34,
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
    width: 31,
    height: 31,
    borderRadius: 15.5,
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
  setNotesButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.24)',
  },
  manualSetBadge: {
    minWidth: 62,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.24)',
  },
  manualSetBadgeText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 0.2,
  },

  /* ── Rest Timer Card ────────────────────── */
  restTimerCard: {
    marginHorizontal: 9,
    marginTop: 8,
    marginBottom: 10,
    minHeight: 82,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
  },
  restTimerDial: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restTimerDialProgress: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  restTimerDialText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  restTimerCopy: {
    flex: 1,
    gap: 3,
  },
  restTimerTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  restTimerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  restTimerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  restTimerActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  restTimerPauseButtonActive: {
    backgroundColor: 'rgba(122, 85, 255, 0.18)',
    borderColor: 'rgba(122, 85, 255, 0.32)',
  },
  restTimerDeleteButton: {
    backgroundColor: 'rgba(240, 82, 82, 0.10)',
    borderColor: 'rgba(240, 82, 82, 0.18)',
  },

  /* ── Add Set Row ────────────────────────── */
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
  },
  addSetAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  addSetActionPrimary: {
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    borderColor: 'rgba(122, 85, 255, 0.24)',
  },
  addSetActionText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.1,
  },

  /* ── Manual Set Modal ───────────────────── */
  manualModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  manualModalBackdropPressable: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
  },
  manualModalCardOuter: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  manualModalGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  manualModalEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderTopColor: 'rgba(255, 255, 255, 0.11)',
    padding: 18,
    gap: 16,
  },
  manualModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  manualModalTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    lineHeight: 23,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  manualModalSubtitle: {
    marginTop: 3,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  manualModalClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  manualInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(122, 85, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.16)',
  },
  manualInfoText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  manualInputsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  manualInputGroup: {
    flex: 1,
    gap: 7,
  },
  manualInputLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
  },
  manualInput: {
    minHeight: 58,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontFamily: FONTS.mono.bold,
    fontSize: 22,
    color: COLORS.text,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  manualWeightInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  manualWeightInput: {
    paddingRight: 48,
  },
  manualWeightUnit: {
    position: 'absolute',
    right: 14,
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  manualUnitRow: {
    flexDirection: 'row',
    gap: 8,
  },
  manualUnitButton: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  manualUnitButtonActive: {
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
    borderColor: 'rgba(122, 85, 255, 0.34)',
  },
  manualUnitText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  manualUnitTextActive: {
    color: COLORS.accent,
  },
  manualSubmitButton: {
    minHeight: 48,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
  },
  manualSubmitButtonDisabled: {
    opacity: 0.45,
  },
  manualSubmitText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.1,
  },

  /* ── Bottom Panel ─────────────────────── */
  bottomPanel: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 10,
    backgroundColor: '#070A0D',
    gap: 10,
  },
  addExerciseGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 18,
    gap: 8,
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
  },
  controlFinishButton: {
    height: 50,
    borderRadius: 11,
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
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  controlFinishLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
});
