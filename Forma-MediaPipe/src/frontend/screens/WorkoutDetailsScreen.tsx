import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Platform, Animated, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronDown,
  Target,
  AlignLeft,
  Dumbbell,
  Video,
  Calendar,
  Clock,
  Layers,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import {
  COLORS,
  SPACING,
  FONTS,
  PAGE_TITLE_TEXT,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_VERTICAL_GAP,
  getScoreColor,
  CARD_SHADOW
} from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useWorkoutDetails } from '../../backend/hooks/useWorkouts';
import { useVideoLibrary } from '../../backend/hooks/useVideoLibrary';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { WorkoutExercise } from '../../backend/services/api';
import type { VideoRecord } from '../../backend/services/videoLibrary';
import { useAlert } from '../contexts/AlertContext';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

let VideoComponent: any = null;
try {
  VideoComponent = require('expo-av').Video;
} catch {
  // expo-av Video not available
}

type WorkoutDetailsScreenRouteProp = RouteProp<RootStackParamList, 'WorkoutDetails'>;
type WorkoutDetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WorkoutDetails'>;

const SUMMARY_RING_SIZE = 82;
const SUMMARY_RING_STROKE = 7;

const getScoreStatus = (score: number): string => {
  if (score >= 90) return 'Excellent form';
  if (score >= 75) return 'Solid session';
  if (score >= 50) return 'Needs attention';
  return 'Technique focus';
};

const getScoreHint = (score: number): string => {
  if (score >= 90) return 'Clean reps and strong consistency across your sets.';
  if (score >= 75) return 'Good work overall. Keep prioritizing control and range.';
  if (score >= 50) return 'There is progress here, with room to tighten execution.';
  return 'Review the set feedback and keep the next session technique-led.';
};

const getScoreTint = (score: number): string => {
  if (score >= 90) return 'rgba(52, 224, 166, 0.10)';
  if (score >= 75) return 'rgba(122, 85, 255, 0.12)';
  if (score >= 50) return 'rgba(236, 161, 58, 0.12)';
  return 'rgba(217, 111, 80, 0.12)';
};

const ScoreRing: React.FC<{ score: number; color: string }> = ({ score, color }) => {
  const radius = (SUMMARY_RING_SIZE - SUMMARY_RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <View style={styles.scoreRing}>
      <Svg width={SUMMARY_RING_SIZE} height={SUMMARY_RING_SIZE}>
        <Circle
          cx={SUMMARY_RING_SIZE / 2}
          cy={SUMMARY_RING_SIZE / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.055)"
          strokeWidth={SUMMARY_RING_STROKE}
          fill="transparent"
        />
        <Circle
          cx={SUMMARY_RING_SIZE / 2}
          cy={SUMMARY_RING_SIZE / 2}
          r={radius}
          stroke={color}
          strokeWidth={SUMMARY_RING_STROKE}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SUMMARY_RING_SIZE / 2} ${SUMMARY_RING_SIZE / 2})`}
        />
      </Svg>
      <View style={styles.scoreRingValueWrap} pointerEvents="none">
        <MonoText style={[styles.scoreRingValue, { color }]}>{score}</MonoText>
        <Text style={styles.scoreRingUnit}>FORM</Text>
      </View>
    </View>
  );
};

interface ExerciseCardProps {
  exercise: WorkoutExercise;
  recordings: VideoRecord[];
  onPlayRecording: (record: VideoRecord) => void;
}

const ExerciseCard: React.FC<ExerciseCardProps> = ({ exercise, recordings, onPlayRecording }) => {
  const { showAlert } = useAlert();
  const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});

  const toggleSetNotes = (setNumber: number) => {
    setExpandedSets((prev) => ({ ...prev, [setNumber]: !prev[setNumber] }));
  };

  const getRecordingForSet = (setNumber: number): VideoRecord | undefined =>
    recordings.find((r) => r.exerciseName === exercise.name && r.setNumber === setNumber);

  const totalReps = exercise.sets.reduce((sum, s) => sum + s.reps, 0);
  const avgScore = Math.round(
    exercise.sets.length > 0
      ? exercise.sets.reduce((sum, s) => sum + s.formScore, 0) / exercise.sets.length
      : 0
  );
  const avgScoreColor = getScoreColor(avgScore);

  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          {/* Exercise header row */}
          <View style={styles.exerciseHeader}>
            <View style={styles.exerciseTitleBlock}>
              <Text style={styles.exerciseName} numberOfLines={1}>{exercise.name}</Text>
              <Text style={styles.exerciseMeta}>
                {exercise.sets.length} set{exercise.sets.length === 1 ? '' : 's'} · {totalReps} reps
              </Text>
            </View>
            <View style={[styles.avgScoreBadge, { backgroundColor: getScoreTint(avgScore) }]}>
              <Target size={10} color={avgScoreColor} strokeWidth={1.5} />
              <MonoText style={[styles.avgScoreText, { color: avgScoreColor }]}>{avgScore}</MonoText>
            </View>
          </View>

          {/* Sets Table Header */}
          <View style={styles.setsHeader}>
            <Text style={[styles.setsHeaderText, styles.colSet]}>Set</Text>
            <Text style={[styles.setsHeaderText, styles.colReps]}>Reps</Text>
            <Text style={[styles.setsHeaderText, styles.colWeight]}>Weight</Text>
            <Text style={[styles.setsHeaderText, styles.colScore]}>Form</Text>
            <View style={styles.colVideo} />
          </View>

          {/* Sets */}
          {exercise.sets.map((set, idx) => {
            const scoreColor = getScoreColor(set.formScore);
            const isLast = idx === exercise.sets.length - 1;
            const recording = getRecordingForSet(set.setNumber);
            return (
              <View key={set.setNumber}>
                <TouchableOpacity
                  style={[styles.setRow, isLast && !set.notes && styles.setRowLast]}
                  activeOpacity={set.notes ? 0.6 : 1}
                  onPress={() => set.notes ? toggleSetNotes(set.setNumber) : undefined}
                >
                  <View style={styles.setNumWrapper}>
                    <Text style={styles.setNumText}>{set.setNumber}</Text>
                  </View>
                  <Text style={[styles.setCell, styles.colReps]}>{set.reps}</Text>
                  <Text style={[styles.setCell, styles.colWeight]}>
                    {set.weight > 0 ? `${set.weight} lbs` : '—'}
                  </Text>
                  <View style={[styles.scoreCellRow, styles.colScore]}>
                    <MonoText style={[styles.scoreText, { color: scoreColor, backgroundColor: getScoreTint(set.formScore) }]}>
                      {set.formScore}
                    </MonoText>
                    {set.notes && (
                      <ChevronDown
                        size={11}
                        color={COLORS.textTertiary}
                        strokeWidth={1.5}
                        style={expandedSets[set.setNumber] ? { transform: [{ rotate: '180deg' }] } : undefined}
                      />
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.videoButton, !recording && styles.videoButtonDisabled]}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => {
                      if (recording) {
                        onPlayRecording(recording);
                      } else {
                        showAlert('No Recording', 'Set recording was not saved for this set.');
                      }
                    }}
                  >
                    <Video
                      size={13}
                      color={recording ? COLORS.accent : 'rgba(255, 255, 255, 0.12)'}
                      strokeWidth={1.5}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
                {set.notes && expandedSets[set.setNumber] && (
                  <View style={styles.setNotesContainer}>
                    <Text style={styles.setNotesText}>{set.notes}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </LinearGradient>
    </View>
  );
};

export const WorkoutDetailsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<WorkoutDetailsScreenNavigationProp>();
  const route = useRoute<WorkoutDetailsScreenRouteProp>();
  const { workoutId } = route.params;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const { workout, isLoading, error, refetch } = useWorkoutDetails(workoutId);
  const { getRecordingsForWorkout } = useVideoLibrary();
  const [workoutRecordings, setWorkoutRecordings] = useState<VideoRecord[]>([]);
  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);

  // Fetch recordings for this workout
  useEffect(() => {
    if (workoutId) {
      getRecordingsForWorkout(workoutId).then(setWorkoutRecordings).catch(() => {});
    }
  }, [workoutId, getRecordingsForWorkout]);

  const handlePlayRecording = useCallback((record: VideoRecord) => {
    setPlayingVideo(record);
  }, []);

  useEffect(() => {
    if (workout) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [workout, fadeAnim, slideAnim]);

  // Loading state
  if (isLoading) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>LOADING...</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <LoadingSkeleton variant="card" height={160} style={{ marginBottom: SPACING.md }} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: SPACING.md }}>
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={110} style={{ flex: 1 }} />
          </View>
          <LoadingSkeleton variant="card" height={200} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={200} />
        </View>
      </ScreenBackground>
    );
  }

  // Error state
  if (error) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>ERROR</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.errorContainer}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </ScreenBackground>
    );
  }

  if (!workout) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>WORKOUT NOT FOUND</Text>
          <View style={styles.placeholder} />
        </View>
      </ScreenBackground>
    );
  }

  // Compute aggregate stats from exercises
  const totalSets = workout.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  const totalReps = workout.exercises.reduce(
    (sum, ex) => ex.sets.reduce((s2, set) => s2 + set.reps, sum), 0
  );
  const allScores = workout.exercises.flatMap((ex) => ex.sets.map((s) => s.formScore));
  const avgFormScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;
  const formScoreColor = getScoreColor(avgFormScore);
  const summaryStats = [
    { label: 'Duration', value: workout.duration, icon: Clock, color: COLORS.green },
    { label: 'Exercises', value: `${workout.exercises.length}`, icon: Dumbbell, color: COLORS.accent },
    { label: 'Sets', value: `${totalSets}`, icon: Layers, color: COLORS.yellow },
    { label: 'Reps', value: `${totalReps}`, icon: Target, color: COLORS.textSecondary },
  ];

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{workout.name.toUpperCase()}</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 160) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              WORKOUT SUMMARY - readiness-style card
              ═══════════════════════════════════════════ */}
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.summaryCard}
          >
            <View style={styles.summaryEdge}>
              <View style={styles.summaryHeaderRow}>
                <View style={styles.summaryTitleRow}>
                  <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.summaryTitle}>WORKOUT SUMMARY</Text>
                </View>
                <View style={styles.summaryDatePill}>
                  <Calendar size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
                  <Text style={styles.summaryDatePillText}>{workout.date}</Text>
                </View>
              </View>

              <View style={styles.summaryMain}>
                <ScoreRing score={avgFormScore} color={formScoreColor} />
                <View style={styles.summaryCopy}>
                  <Text style={[styles.summaryStatus, { color: formScoreColor }]}>
                    {getScoreStatus(avgFormScore)}
                  </Text>
                  <Text style={styles.summaryHint}>
                    {getScoreHint(avgFormScore)}
                  </Text>
                </View>
              </View>

              <View style={styles.summaryStatsGrid}>
                {summaryStats.map(({ label, value, icon: Icon, color }) => (
                  <View key={label} style={styles.summaryStatTile}>
                    <Icon size={13} color={color} strokeWidth={1.5} />
                    <View style={styles.summaryStatTextWrap}>
                      <Text style={styles.summaryStatLabel}>{label}</Text>
                      <Text style={styles.summaryStatValue} numberOfLines={1}>{value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              NOTES — Accent card (if present)
              ═══════════════════════════════════════════ */}
          {workout.notes && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <AlignLeft size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>NOTES</Text>
                </View>
              </View>

              <View style={styles.notesOuter}>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.notesGradient}
                >
                  <View style={styles.notesEdge}>
                    <View style={styles.notesAccentBar} />
                    <Text style={styles.notesText}>{workout.notes}</Text>
                  </View>
                </LinearGradient>
              </View>
            </>
          )}

          {/* ═══════════════════════════════════════════
              EXERCISES — Section with cards
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>EXERCISES</Text>
            </View>
            <Text style={styles.exerciseCount}>{workout.exercises.length}</Text>
          </View>

          {workout.exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              recordings={workoutRecordings}
              onPlayRecording={handlePlayRecording}
            />
          ))}

        </Animated.View>
      </ScrollView>

      {/* Video Playback Modal */}
      {playingVideo && VideoComponent && (
        <Modal
          visible={!!playingVideo}
          animationType="fade"
          onRequestClose={() => setPlayingVideo(null)}
        >
          <View style={styles.playerContainer}>
            <VideoComponent
              source={{ uri: playingVideo.videoPath }}
              style={styles.player}
              useNativeControls
              shouldPlay
              resizeMode="contain"
              onPlaybackStatusUpdate={(status: any) => {
                if (status.didJustFinish) setPlayingVideo(null);
              }}
            />
            <TouchableOpacity
              style={[styles.playerClose, { top: insets.top + 10 }]}
              onPress={() => setPlayingVideo(null)}
            >
              <Text style={styles.playerCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },

  /* ── Header ──────────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    ...PAGE_TITLE_TEXT,
    textAlign: 'center',
    marginHorizontal: SPACING.sm,
  },
  placeholder: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* ── Summary Card ────────────────────────────── */
  summaryCard: {
    borderRadius: CARD_RADIUS,
    marginTop: 8,
    marginBottom: CARD_VERTICAL_GAP,
    ...CARD_SHADOW,
    overflow: 'hidden',
  },
  summaryEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 16,
    gap: 16,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },
  summaryDatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  summaryDatePillText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  summaryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scoreRing: {
    width: SUMMARY_RING_SIZE,
    height: SUMMARY_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingValueWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingValue: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 21,
    lineHeight: 25,
  },
  scoreRingUnit: {
    fontFamily: FONTS.ui.bold,
    fontSize: 8,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },
  summaryCopy: {
    flex: 1,
    gap: 5,
  },
  summaryStatus: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    lineHeight: 24,
  },
  summaryHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
  },
  summaryStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryStatTile: {
    width: '48%',
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.032)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  summaryStatTextWrap: {
    flex: 1,
    gap: 1,
  },
  summaryStatValue: {
    fontFamily: FONTS.display.regular,
    fontSize: 14.5,
    color: COLORS.text,
  },
  summaryStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  /* ── Section Headers ─────────────────────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 10,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 11,
    color: COLORS.text,
    letterSpacing: 2,
  },
  exerciseCount: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* ── Notes Card ──────────────────────────────── */
  notesOuter: {
    borderRadius: 18,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  notesGradient: {
    borderRadius: 18,
  },
  notesEdge: {
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  notesAccentBar: {
    width: 3,
    backgroundColor: COLORS.accent,
  },
  notesText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 21,
    padding: 16,
  },

  /* ── Exercise Cards ──────────────────────────── */
  cardOuter: {
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
    ...CARD_SHADOW,
  },
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 14,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
    gap: 12,
  },
  exerciseTitleBlock: {
    flex: 1,
    gap: 3,
  },
  exerciseName: {
    fontSize: 17,
    fontFamily: FONTS.display.regular,
    color: COLORS.text,
  },
  exerciseMeta: {
    fontSize: 11.5,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  avgScoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  avgScoreText: {
    fontSize: 13,
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
  },
  setsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: SPACING.xs,
  },
  setsHeaderText: {
    fontSize: 9.5,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  colSet: {
    width: 36,
    textAlign: 'center',
  },
  colReps: {
    flex: 1,
    textAlign: 'center',
  },
  colWeight: {
    flex: 1.4,
    textAlign: 'center',
  },
  colScore: {
    flex: 1,
    textAlign: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.035)',
  },
  setRowLast: {
    borderBottomWidth: 0,
  },
  setNumWrapper: {
    width: 32,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNumText: {
    fontSize: 12,
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    color: COLORS.textSecondary,
  },
  setCell: {
    fontSize: 14.5,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    textAlign: 'center',
  },
  scoreCellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreText: {
    minWidth: 36,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 13.5,
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  setNotesContainer: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
    borderRadius: 8,
    marginBottom: 4,
  },
  setNotesText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  /* ── Video column ──────────────────────────── */
  colVideo: {
    width: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  videoButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
  },
  videoButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
  },

  /* ── Video Player Modal ────────────────────── */
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center' as const,
  },
  player: {
    flex: 1,
  },
  playerClose: {
    position: 'absolute' as const,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
});
