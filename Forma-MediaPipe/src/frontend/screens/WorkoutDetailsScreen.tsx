import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Platform, Animated, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronDown,
  Target,
  AlignLeft,
  Dumbbell,
  Video,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
  CARD_SHADOW
} from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useWorkoutDetails } from '../../backend/hooks';
import { useVideoLibrary } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { WorkoutExercise } from '../../backend/services/api';
import type { VideoRecord } from '../../backend/services/videoLibrary';
import { useAlert } from '../contexts/AlertContext';

let VideoComponent: any = null;
try {
  VideoComponent = require('expo-av').Video;
} catch {
  // expo-av Video not available
}

type WorkoutDetailsScreenRouteProp = RouteProp<RootStackParamList, 'WorkoutDetails'>;
type WorkoutDetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WorkoutDetails'>;

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

  const avgScore = Math.round(
    exercise.sets.reduce((sum, s) => sum + s.formScore, 0) / exercise.sets.length
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
            <Text style={styles.exerciseName} numberOfLines={1}>{exercise.name}</Text>
            <View style={styles.avgScoreBadge}>
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
                    <MonoText style={[styles.scoreText, { color: scoreColor }]}>
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
                    style={styles.colVideo}
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
                      size={14}
                      color={recording ? COLORS.accent : 'rgba(255,255,255,0.15)'}
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
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Loading...</Text>
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
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Error</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.errorContainer}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  if (!workout) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Workout Not Found</Text>
          <View style={styles.placeholder} />
        </View>
      </View>
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{workout.name}</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              WORKOUT SUMMARY — Compact inline card
              ═══════════════════════════════════════════ */}
          <LinearGradient
            colors={SCREEN_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.summaryCard}
          >
            <View style={styles.summaryEdge}>
              {/* Title row */}
              <View style={styles.summaryTitleRow}>
                <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
                <Text style={styles.summaryTitle}>WORKOUT SUMMARY</Text>
              </View>
              {/* Inline stats row */}
              <View style={styles.summaryStatsRow}>
                <View style={styles.summaryStat}>
                  <MonoText style={[styles.summaryScoreValue, { color: formScoreColor }]}>{avgFormScore}</MonoText>
                  <Text style={styles.summaryStatLabel}>form</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{workout.date}</Text>
                  <Text style={styles.summaryStatLabel}>date</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{workout.duration}</Text>
                  <Text style={styles.summaryStatLabel}>duration</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{totalSets}×{totalReps}</Text>
                  <Text style={styles.summaryStatLabel}>sets×reps</Text>
                </View>
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: FONTS.display.bold,
    color: COLORS.text,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginHorizontal: SPACING.sm,
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 160,
  },

  /* ── Summary Card ────────────────────────────── */
  summaryCard: {
    borderRadius: 16,
    marginTop: 14,
    marginBottom: 4,

    ...CARD_SHADOW,
},
  summaryEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  summaryScoreValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 18,
  },
  summaryStatValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  summaryStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* ── Section Headers ─────────────────────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
  },
  exerciseCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* ── Notes Card ──────────────────────────────── */
  notesOuter: {
    borderRadius: 18,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7C5CFF',
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
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    borderRadius: 18,
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#7C5CFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  cardGradient: {
    borderRadius: 18,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    padding: 16,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    gap: SPACING.md,
  },
  exerciseName: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  avgScoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  avgScoreText: {
    fontSize: 13,
    fontFamily: FONTS.mono.bold,
  },
  setsHeader: {
    flexDirection: 'row',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: SPACING.xs,
  },
  setsHeaderText: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  colSet: {
    width: 32,
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
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  setRowLast: {
    borderBottomWidth: 0,
  },
  setNumWrapper: {
    width: 32,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNumText: {
    fontSize: 12,
    fontFamily: FONTS.mono.regular,
    color: COLORS.textSecondary,
  },
  setCell: {
    fontSize: 14,
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
    fontSize: 14,
    fontFamily: FONTS.mono.bold,
    textAlign: 'center',
  },
  setNotesContainer: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
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
    width: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 15,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});
