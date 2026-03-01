import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  useWindowDimensions,
  Animated,
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
  Video,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../constants/theme';
import CogIcon from '../components/icons/CogIcon';
import PauseIcon from '../components/icons/PauseIcon';
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

/* ── Main Screen ──────────────────────────── */

const TIMER_FONT_SIZE_MAX = 48;
const TIMER_FONT_SIZE_MIN = 36;

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
    sets,
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
    setWorkoutPaused,
    pendingRecording,
    setPendingRecording,
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);
  const prevSetCountsRef = useRef<Map<string, number>>(new Map());
  const restIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { restTimerEnabled, restTimerDurationSeconds } = useCameraSettings();
  isPausedRef.current = workoutPaused;

  /* ── Entrance animation ──── */
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  /* ── Timer logic ──── */

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
        startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      }
      return next;
    });
  };

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
            showRecordingOptions: !!showWeightFor.hasRecording,
          });
        }
        navigation.setParams({ showWeightFor: undefined });
      }
    }, [route.params?.newSet, route.params?.showWeightFor, addSet, navigation, exercises, startRestTimer])
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
    if (!weightModalData) return;
    updateSetRecordingFlags(weightModalData.exerciseId, weightModalData.setIndex, { saveToLibrary, saveToCameraRoll });
  }, [weightModalData, updateSetRecordingFlags]);

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
            // Clean up all temp recording files
            for (const ex of exercises) {
              for (const s of ex.sets) {
                if (s.tempRecordingUrl) {
                  cleanupTempRecording(s.tempRecordingUrl).catch(() => {});
                }
              }
            }
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
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerIconButton} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={[styles.statusPill, workoutPaused && styles.statusPillPaused]}>
            <View style={[styles.statusDot, workoutPaused && styles.statusDotPaused]} />
            <Text style={[styles.statusText, workoutPaused && styles.statusTextPaused]}>
              {workoutPaused ? 'PAUSED' : 'ACTIVE'}
            </Text>
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

      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], flex: 1 }}>
        {/* ── TIMER HERO ──────────────────────── */}
        <View style={styles.timerBlock}>
          <View style={styles.timerDisplay}>
            {getTimerParts(elapsedSeconds).map((part, i) => (
              <MonoText
                key={i}
                bold={part !== ':'}
                style={part === ':'
                  ? [styles.timerColon, { fontSize: timerFontSize * 0.75, lineHeight: timerLineHeight }]
                  : [styles.timerDigit, { fontSize: timerFontSize, lineHeight: timerLineHeight }]
                }
              >
                {part}
              </MonoText>
            ))}
          </View>
          {totalSetsCount > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statChip}>
                <Layers size={11} color={COLORS.accent} strokeWidth={1.5} />
                <MonoText bold style={styles.statChipValue}>{totalSetsCount}</MonoText>
                <Text style={styles.statChipLabel}>sets</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statChip}>
                <Clock size={11} color={COLORS.accent} strokeWidth={1.5} />
                <MonoText bold style={styles.statChipValue}>{totalRepsCount}</MonoText>
                <Text style={styles.statChipLabel}>reps</Text>
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
                          {exercise.sets.map((set, setIndex) => (
                            <View key={setIndex} style={styles.setRow}>
                              <View style={styles.setIndexBadge}>
                                <MonoText bold style={styles.setIndexText}>{setIndex + 1}</MonoText>
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
                                  <MonoText bold style={[styles.setMetricValue, { color: getScoreColor(set.formScore) }]}>
                                    {set.formScore}
                                  </MonoText>
                                </View>
                              </View>
                              <View style={styles.setActions}>
                                {set.tempRecordingUrl && (
                                  <TouchableOpacity
                                    style={styles.setActionIcon}
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
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  >
                                    <Video
                                      size={13}
                                      color={set.saveRecordingToLibrary !== false ? COLORS.accent : COLORS.textTertiary}
                                      strokeWidth={1.5}
                                    />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                  style={styles.setActionIcon}
                                  onPress={() =>
                                    setNotesModalSet({
                                      set,
                                      setIndex: setIndex + 1,
                                      exerciseName: exercise.name,
                                    })
                                  }
                                  activeOpacity={0.7}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <FileText size={13} color={COLORS.accent} strokeWidth={1.5} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.setActionIcon}
                                  onPress={() => handleDeleteSet(exercise.id, exercise.name, setIndex)}
                                  activeOpacity={0.7}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <X size={13} color={COLORS.textTertiary} strokeWidth={2} />
                                </TouchableOpacity>
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
                        <Plus size={13} color={COLORS.accent} strokeWidth={2.5} />
                        <Text style={styles.addSetRowText}>Add set</Text>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </View>
              );
            })
          )}
        </ScrollView>
      </Animated.View>

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
        {/* Add Exercise */}
        <TouchableOpacity style={styles.addExerciseButton} onPress={handleAddExercise} activeOpacity={0.8}>
          <Plus size={15} color={COLORS.text} strokeWidth={2.5} />
          <Text style={styles.addExerciseText}>Add exercise</Text>
        </TouchableOpacity>

        {/* Controls Row */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.controlDiscardButton}
            onPress={handleDiscardWorkout}
            activeOpacity={0.7}
          >
            <Trash2 size={15} color={COLORS.textTertiary} strokeWidth={1.5} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlPauseButton, workoutPaused && styles.controlPauseButtonActive]}
            onPress={handlePausePress}
            activeOpacity={0.7}
          >
            {workoutPaused ? (
              <Play size={15} color={COLORS.text} strokeWidth={1.5} />
            ) : (
              <PauseIcon size={15} color={COLORS.textSecondary} />
            )}
            <Text style={[styles.controlPauseLabel, workoutPaused && styles.controlPauseLabelActive]}>
              {workoutPaused ? 'Resume' : 'Pause'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlFinishButton}
            onPress={handleEndWorkout}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.5)', 'rgba(124, 58, 237, 0.25)']}
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
    paddingBottom: 8,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.2)',
  },
  statusPillPaused: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#34D399',
  },
  statusDotPaused: {
    backgroundColor: COLORS.accent,
  },
  statusText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 10,
    color: '#34D399',
    letterSpacing: 1.5,
  },
  statusTextPaused: {
    color: COLORS.accent,
  },

  /* ── Timer Hero ─────────────────────────── */
  timerBlock: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  timerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    color: 'rgba(255, 255, 255, 0.25)',
    marginHorizontal: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statChipValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 16,
  },
  statChipLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  restTimerProgress: {
    flex: 1,
  },
  restTimerTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
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
    gap: 14,
  },
  scrollContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  /* ── Exercise Card ──────────────────────── */
  exerciseCardOuter: {
    borderRadius: 20,
    overflow: 'hidden',
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
    borderRadius: 20,
  },
  exerciseCardGlassEdge: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  exerciseAccentLine: {
    width: 3,
    height: 32,
    borderRadius: 1.5,
    backgroundColor: COLORS.accent,
  },
  exerciseCardHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  exerciseCardName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Set Rows ───────────────────────────── */
  setsList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 16,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  setIndexBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setIndexText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.accent,
    lineHeight: 14,
  },
  setMetrics: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  setMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  setMetricDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  setMetricLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
  },
  setMetricValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 20,
  },
  setMetricValueEmpty: {
    color: '#3F3F46',
  },
  setActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  setActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Add Set Row ────────────────────────── */
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
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
    paddingTop: 12,
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    gap: 10,
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  addExerciseText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlDiscardButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
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
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  controlPauseButtonActive: {
    borderColor: 'rgba(139, 92, 246, 0.2)',
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
  },
  controlPauseLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  controlPauseLabelActive: {
    color: COLORS.text,
  },
  controlFinishButton: {
    flex: 1.3,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
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
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  controlFinishLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
});
