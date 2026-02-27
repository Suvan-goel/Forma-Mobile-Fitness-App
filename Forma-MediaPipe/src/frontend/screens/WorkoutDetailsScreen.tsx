import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronDown, Target, Clock, Calendar, Layers, AlignLeft } from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useWorkoutDetails } from '../../backend/hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { WorkoutExercise } from '../../backend/services/api';

type WorkoutDetailsScreenRouteProp = RouteProp<RootStackParamList, 'WorkoutDetails'>;
type WorkoutDetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WorkoutDetails'>;

const ExerciseCard: React.FC<{ exercise: WorkoutExercise }> = ({ exercise }) => {
  const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});

  const toggleSetNotes = (setNumber: number) => {
    setExpandedSets((prev) => ({ ...prev, [setNumber]: !prev[setNumber] }));
  };

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
        <View style={styles.cardGlassEdge}>
          {/* Exercise header row */}
          <View style={styles.exerciseHeader}>
            <Text style={styles.exerciseName} numberOfLines={1}>{exercise.name}</Text>
            <View style={[styles.avgScoreBadge, { backgroundColor: `${avgScoreColor}18` }]}>
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
          </View>

          {/* Sets */}
          {exercise.sets.map((set) => {
            const scoreColor = getScoreColor(set.formScore);
            return (
              <View key={set.setNumber}>
                <TouchableOpacity
                  style={styles.setRow}
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

  const { workout, isLoading, error, refetch } = useWorkoutDetails(workoutId);

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Loading...</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: SPACING.md }} />
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
            <ChevronLeft size={24} color={COLORS.text} />
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
            <ChevronLeft size={24} color={COLORS.text} />
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 200 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Strip */}
        <View style={styles.statsStrip}>
          <View style={styles.statChip}>
            <Calendar size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
            <Text style={styles.statChipValue}>{workout.date}</Text>
            <Text style={styles.statChipLabel}>Date</Text>
          </View>
          <View style={styles.statStripDivider} />
          <View style={styles.statChip}>
            <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
            <Text style={styles.statChipValue}>{workout.duration}</Text>
            <Text style={styles.statChipLabel}>Duration</Text>
          </View>
          <View style={styles.statStripDivider} />
          <View style={styles.statChip}>
            <Layers size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
            <Text style={styles.statChipValue}>{totalSets} · {totalReps}</Text>
            <Text style={styles.statChipLabel}>Sets · Reps</Text>
          </View>
          <View style={styles.statStripDivider} />
          <View style={styles.statChip}>
            <Target size={12} color={formScoreColor} strokeWidth={1.5} />
            <MonoText style={[styles.statChipValue, { color: formScoreColor }]}>{avgFormScore}</MonoText>
            <Text style={styles.statChipLabel}>Avg Form</Text>
          </View>
        </View>

        {/* Notes Card */}
        {workout.notes && (
          <View style={styles.notesCardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.notesCardGradient}
            >
              <View style={styles.notesCardGlass}>
                <View style={styles.notesAccentBar} />
                <View style={styles.notesContent}>
                  <View style={styles.notesHeaderRow}>
                    <AlignLeft size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.notesLabel}>Notes</Text>
                  </View>
                  <Text style={styles.notesText}>{workout.notes}</Text>
                </View>
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Exercises */}
        {workout.exercises.map((exercise) => (
          <ExerciseCard key={exercise.id} exercise={exercise} />
        ))}
      </ScrollView>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xs,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  placeholder: {
    width: 24 + SPACING.sm * 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 12,
  },

  /* ── Stats strip ── */
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  statChip: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  statChipValue: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  statChipLabel: {
    fontSize: 9,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  statStripDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* ── Notes card ── */
  notesCardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  notesCardGradient: {
    borderRadius: 19,
  },
  notesCardGlass: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  notesAccentBar: {
    width: 3,
    backgroundColor: COLORS.accent,
    borderTopLeftRadius: 19,
    borderBottomLeftRadius: 19,
  },
  notesContent: {
    flex: 1,
    paddingVertical: SPACING.lg,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.lg,
    gap: SPACING.sm,
  },
  notesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notesLabel: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  notesText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },

  /* ── Exercise cards ── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 14,
      },
      android: { elevation: 5 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
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
    fontSize: 17,
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
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
  },
  setNotesText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});
