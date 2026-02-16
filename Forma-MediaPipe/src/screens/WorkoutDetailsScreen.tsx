import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Target } from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { useWorkoutDetails } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { WorkoutExercise } from '../services/api';

type WorkoutDetailsScreenRouteProp = RouteProp<RootStackParamList, 'WorkoutDetails'>;
type WorkoutDetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WorkoutDetails'>;

const CARD_GRADIENT_COLORS: [string, string, string] = ['#1A1A1A', '#0F0F0F', '#0A0A0A'];

const ExerciseCard: React.FC<{ exercise: WorkoutExercise }> = ({ exercise }) => {
  return (
    <View style={styles.cardOuter}>
      <LinearGradient
        colors={CARD_GRADIENT_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardGradient}
      >
        <View style={styles.cardGlassEdge}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>

          {/* Sets Table Header */}
          <View style={styles.setsHeader}>
            <Text style={styles.setsHeaderText}>Set</Text>
            <Text style={styles.setsHeaderText}>Reps</Text>
            <Text style={styles.setsHeaderText}>Weight</Text>
            <View style={styles.scoreColumn}>
              <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.setsHeaderText}>Form</Text>
            </View>
          </View>

          {/* Sets */}
          {exercise.sets.map((set) => (
            <View key={set.setNumber} style={styles.setRow}>
              <Text style={styles.setCell}>{set.setNumber}</Text>
              <Text style={styles.setCell}>{set.reps}</Text>
              <Text style={styles.setCell}>
                {set.weight > 0 ? `${set.weight} lbs` : '-'}
              </Text>
              <MonoText style={[styles.setCell, styles.scoreCell]}>
                {set.formScore}
              </MonoText>
            </View>
          ))}
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
        {/* Workout Info */}
        <View style={styles.workoutInfo}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Date</Text>
            <Text style={styles.infoValue}>{workout.date}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Duration</Text>
            <Text style={styles.infoValue}>{workout.duration}</Text>
          </View>
        </View>

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
    marginBottom: SPACING.sm,
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
    gap: 14,
  },
  workoutInfo: {
    flexDirection: 'row',
    gap: SPACING.xl,
    marginBottom: SPACING.md,
  },
  infoItem: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: SPACING.xs,
  },
  infoValue: {
    fontSize: 16,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  /* ── Gradient exercise cards (match Logbook / app cards) ── */
  cardOuter: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: SPACING.md,
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
  cardGradient: {
    borderRadius: 22,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
  },
  exerciseName: {
    fontSize: 18,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: SPACING.md,
  },
  setsHeader: {
    flexDirection: 'row',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: SPACING.sm,
  },
  setsHeaderText: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  scoreColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
  },
  setRow: {
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  setCell: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  scoreCell: {
    fontFamily: FONTS.mono.bold,
    color: COLORS.accent,
  },
});



