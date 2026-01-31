import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Target } from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';

type WorkoutDetailsScreenRouteProp = RouteProp<RootStackParamList, 'WorkoutDetails'>;
type WorkoutDetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WorkoutDetails'>;

interface Set {
  setNumber: number;
  reps: number;
  weight: number; // in lbs or kg
  formScore: number;
}

interface Exercise {
  id: string;
  name: string;
  sets: Set[];
}

interface WorkoutDetails {
  id: string;
  name: string;
  date: string;
  duration: string;
  exercises: Exercise[];
}

// Mock workout details data
const mockWorkoutDetails: { [key: string]: WorkoutDetails } = {
  '1': {
    id: '1',
    name: 'Push Day - Strength',
    date: 'Oct 24',
    duration: '45 min',
    exercises: [
      {
        id: '1',
        name: 'Bench Press',
        sets: [
          { setNumber: 1, reps: 8, weight: 225, formScore: 88 },
          { setNumber: 2, reps: 8, weight: 225, formScore: 87 },
          { setNumber: 3, reps: 6, weight: 225, formScore: 85 },
          { setNumber: 4, reps: 6, weight: 225, formScore: 86 },
        ],
      },
      {
        id: '2',
        name: 'Overhead Press',
        sets: [
          { setNumber: 1, reps: 8, weight: 135, formScore: 90 },
          { setNumber: 2, reps: 8, weight: 135, formScore: 89 },
          { setNumber: 3, reps: 6, weight: 135, formScore: 88 },
        ],
      },
      {
        id: '3',
        name: 'Incline Dumbbell Press',
        sets: [
          { setNumber: 1, reps: 10, weight: 70, formScore: 85 },
          { setNumber: 2, reps: 10, weight: 70, formScore: 84 },
          { setNumber: 3, reps: 8, weight: 70, formScore: 83 },
        ],
      },
    ],
  },
  '2': {
    id: '2',
    name: 'Leg Hypertrophy',
    date: 'Oct 22',
    duration: '60 min',
    exercises: [
      {
        id: '1',
        name: 'Barbell Squat',
        sets: [
          { setNumber: 1, reps: 12, weight: 185, formScore: 82 },
          { setNumber: 2, reps: 12, weight: 185, formScore: 83 },
          { setNumber: 3, reps: 10, weight: 185, formScore: 84 },
          { setNumber: 4, reps: 10, weight: 185, formScore: 85 },
        ],
      },
      {
        id: '2',
        name: 'Romanian Deadlift',
        sets: [
          { setNumber: 1, reps: 10, weight: 225, formScore: 88 },
          { setNumber: 2, reps: 10, weight: 225, formScore: 87 },
          { setNumber: 3, reps: 8, weight: 225, formScore: 89 },
        ],
      },
      {
        id: '3',
        name: 'Leg Press',
        sets: [
          { setNumber: 1, reps: 15, weight: 315, formScore: 80 },
          { setNumber: 2, reps: 15, weight: 315, formScore: 81 },
          { setNumber: 3, reps: 12, weight: 315, formScore: 82 },
        ],
      },
    ],
  },
  '3': {
    id: '3',
    name: 'Full Body Circuit',
    date: 'Oct 20',
    duration: '35 min',
    exercises: [
      {
        id: '1',
        name: 'Deadlift',
        sets: [
          { setNumber: 1, reps: 8, weight: 275, formScore: 85 },
          { setNumber: 2, reps: 8, weight: 275, formScore: 86 },
          { setNumber: 3, reps: 6, weight: 275, formScore: 84 },
        ],
      },
      {
        id: '2',
        name: 'Pull-ups',
        sets: [
          { setNumber: 1, reps: 10, weight: 0, formScore: 88 },
          { setNumber: 2, reps: 8, weight: 0, formScore: 87 },
          { setNumber: 3, reps: 8, weight: 0, formScore: 86 },
        ],
      },
      {
        id: '3',
        name: 'Dips',
        sets: [
          { setNumber: 1, reps: 12, weight: 0, formScore: 82 },
          { setNumber: 2, reps: 10, weight: 0, formScore: 83 },
          { setNumber: 3, reps: 10, weight: 0, formScore: 84 },
        ],
      },
    ],
  },
  '4': {
    id: '4',
    name: 'Morning Mobility',
    date: 'Oct 18',
    duration: '20 min',
    exercises: [
      {
        id: '1',
        name: 'Hip Flexor Stretch',
        sets: [
          { setNumber: 1, reps: 1, weight: 0, formScore: 75 },
          { setNumber: 2, reps: 1, weight: 0, formScore: 76 },
        ],
      },
      {
        id: '2',
        name: 'Shoulder Mobility',
        sets: [
          { setNumber: 1, reps: 10, weight: 0, formScore: 78 },
          { setNumber: 2, reps: 10, weight: 0, formScore: 79 },
        ],
      },
    ],
  },
  '5': {
    id: '5',
    name: 'Upper Body Focus',
    date: 'Sep 15',
    duration: '50 min',
    exercises: [
      {
        id: '1',
        name: 'Barbell Row',
        sets: [
          { setNumber: 1, reps: 8, weight: 185, formScore: 90 },
          { setNumber: 2, reps: 8, weight: 185, formScore: 91 },
          { setNumber: 3, reps: 6, weight: 185, formScore: 89 },
        ],
      },
      {
        id: '2',
        name: 'Lat Pulldown',
        sets: [
          { setNumber: 1, reps: 10, weight: 150, formScore: 88 },
          { setNumber: 2, reps: 10, weight: 150, formScore: 87 },
          { setNumber: 3, reps: 8, weight: 150, formScore: 89 },
        ],
      },
    ],
  },
  '6': {
    id: '6',
    name: 'Cardio Blast',
    date: 'Sep 10',
    duration: '30 min',
    exercises: [
      {
        id: '1',
        name: 'Running',
        sets: [
          { setNumber: 1, reps: 1, weight: 0, formScore: 78 },
        ],
      },
      {
        id: '2',
        name: 'Rowing',
        sets: [
          { setNumber: 1, reps: 500, weight: 0, formScore: 80 },
        ],
      },
    ],
  },
};

const ExerciseCard: React.FC<{ exercise: Exercise }> = ({ exercise }) => {
  return (
    <View style={styles.exerciseCard}>
      <Text style={styles.exerciseName}>{exercise.name}</Text>
      
      {/* Sets Table Header */}
      <View style={styles.setsHeader}>
        <Text style={styles.setsHeaderText}>Set</Text>
        <Text style={styles.setsHeaderText}>Reps</Text>
        <Text style={styles.setsHeaderText}>Weight</Text>
        <View style={styles.scoreColumn}>
          <Target size={12} color={COLORS.primary} />
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
  );
};

export const WorkoutDetailsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<WorkoutDetailsScreenNavigationProp>();
  const route = useRoute<WorkoutDetailsScreenRouteProp>();
  const { workoutId } = route.params;

  const workout = mockWorkoutDetails[workoutId];

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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{workout.name}</Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  placeholder: {
    width: 24 + SPACING.sm * 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: SPACING.md,
  },
  workoutInfo: {
    flexDirection: 'row',
    gap: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  infoItem: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  infoValue: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  exerciseCard: {
    ...CARD_STYLE,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  exerciseName: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  setsHeader: {
    flexDirection: 'row',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  setsHeaderText: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
    flex: 1,
    textAlign: 'center',
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
    borderBottomColor: COLORS.border,
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
    color: COLORS.primary,
  },
});



