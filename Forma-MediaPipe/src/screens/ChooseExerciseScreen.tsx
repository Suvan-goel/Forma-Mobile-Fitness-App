import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  ImageSourcePropType,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bookmark, HelpCircle, Search } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';

// Category-based images so each card shows an image matching its exercise type
const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  'Weightlifting': require('../assets/weightlifting_bg.png'),
  'Calisthenics': require('../assets/calisthenics_bg.png'),
  'Mobility & Flexibility': require('../assets/mobility&flexibility_bg.png'),
};
const DEFAULT_EXERCISE_IMAGE = require('../assets/sports_bg.png');

function getExerciseImage(exercise: Exercise): ImageSourcePropType {
  return CATEGORY_IMAGES[exercise.category] ?? DEFAULT_EXERCISE_IMAGE;
}

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: any } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; returnToCurrentWorkout: true };
};

type ChooseExerciseNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'ChooseExercise'
>;

// Muscle groups for the sliding tab (only these categories)
const muscleGroups = [
  { id: 'all', name: 'All', icon: '💪' },
  { id: 'chest', name: 'Chest', icon: '🫁' },
  { id: 'back', name: 'Back', icon: '🦴' },
  { id: 'shoulders', name: 'Shoulders', icon: '💪' },
  { id: 'biceps', name: 'Biceps', icon: '💪' },
  { id: 'triceps', name: 'Triceps', icon: '💪' },
  { id: 'legs', name: 'Legs', icon: '🦵' },
  { id: 'glutes', name: 'Glutes', icon: '🍑' },
  { id: 'calves', name: 'Calves', icon: '🦵' },
  { id: 'core', name: 'Core', icon: '🫁' },
];

// Exercise data organized by muscle group
interface Exercise {
  name: string;
  muscleGroup: string;
  category: string;
  image?: any;
}

const allExercises: Exercise[] = [
  // Chest
  { name: 'Barbell Bench Press', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Incline Dumbbell Press', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Dumbbell Chest Fly (flat or incline)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Weighted Dips (chest-leaning)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Cable Fly (mid–low or high–low)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Push-Ups (standard / deficit / weighted)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Incline Barbell Bench Press', muscleGroup: 'chest', category: 'Weightlifting' },
  // Back
  { name: 'Deadlift', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Pull-Ups / Weighted Pull-Ups', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Barbell Row', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Lat Pulldown', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Seated Cable Row', muscleGroup: 'back', category: 'Weightlifting' },
  // Shoulders (Deltoids)
  { name: 'Overhead Barbell Press', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Lateral Raises', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Rear Delt Fly (dumbbell or cable)', muscleGroup: 'shoulders', category: 'Weightlifting' },
  // Biceps
  { name: 'Barbell Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Incline Dumbbell Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Hammer Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Preacher Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Cable Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  // Triceps
  { name: 'Close-Grip Bench Press', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Skull Crushers (EZ-bar)', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Cable Pushdowns', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Overhead Triceps Extension', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Weighted Dips', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Diamond Push-Ups', muscleGroup: 'triceps', category: 'Weightlifting' },
  // Legs (Quads, Hamstrings, Glutes)
  { name: 'Back Squat', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Romanian Deadlift', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Press', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Walking Lunges', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Curl (machine)', muscleGroup: 'legs', category: 'Weightlifting' },
  // Glutes
  { name: 'Barbell Hip Thrust', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Sumo Deadlift', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Cable Kickbacks', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Step-Ups', muscleGroup: 'glutes', category: 'Weightlifting' },
  // Calves
  { name: 'Standing Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Seated Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Donkey Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Single-Leg Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Leg Press Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  // Core (Abs & Obliques)
  { name: 'Hanging Leg Raises', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Cable Crunches', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Ab Wheel Rollouts', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Russian Twists (weighted)', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Planks (weighted)', muscleGroup: 'core', category: 'Weightlifting' },
];

export const ChooseExerciseScreen: React.FC = () => {
  const navigation = useNavigation<ChooseExerciseNavigationProp>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('all');
  const { addExercise } = useCurrentWorkout();

  // Fixed card width so the last card in an odd row doesn't stretch full width
  const cardWidth = (screenWidth - SPACING.md * 2 - SPACING.md) / 2;

  const handleSelectExercise = (exercise: Exercise) => {
    addExercise({ name: exercise.name, category: exercise.category });
    navigation.navigate('CurrentWorkout');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  // Filter exercises by selected muscle group
  const filteredExercises = selectedMuscleGroup === 'all'
    ? allExercises
    : allExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);

  const renderExerciseCard = ({ item }: { item: Exercise }) => (
    <TouchableOpacity
      style={[styles.exerciseCard, { width: cardWidth }]}
      onPress={() => handleSelectExercise(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.cardIconButton}>
          <Bookmark size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.cardIconButton}>
          <HelpCircle size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.exerciseImageContainer}>
        <Image
          source={getExerciseImage(item)}
          style={styles.exerciseImage}
          resizeMode="cover"
        />
      </View>
      
      <View style={styles.exerciseCardTextBlock}>
        <Text style={styles.exerciseCardName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.exerciseCardMuscle} numberOfLines={1}>
          {muscleGroups.find(m => m.id === item.muscleGroup)?.name || item.muscleGroup}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add exercises</Text>
        <TouchableOpacity style={styles.headerIconButton}>
          <Search size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Muscle Group Sliding Tab */}
      <View style={styles.muscleGroupTabWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.muscleGroupTab}
          style={styles.muscleGroupTabContainer}
        >
          {muscleGroups.map((group) => (
            <TouchableOpacity
              key={group.id}
              style={[
                styles.muscleGroupTabItem,
                selectedMuscleGroup === group.id && styles.muscleGroupTabItemActive,
              ]}
              onPress={() => setSelectedMuscleGroup(group.id)}
            >
              <Text style={styles.muscleGroupTabIcon}>{group.icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Exercises Subheading */}
      <View style={styles.subheadingContainer}>
        <Text style={styles.subheading}>
          {selectedMuscleGroup === 'all'
            ? 'All exercises'
            : muscleGroups.find(m => m.id === selectedMuscleGroup)?.name ?? 'Exercises'}
        </Text>
        <TouchableOpacity>
          <Bookmark size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Exercise Cards Grid */}
      <FlatList
        data={filteredExercises}
        renderItem={renderExerciseCard}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        numColumns={2}
        contentContainerStyle={[
          styles.cardsContainer,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) },
        ]}
        columnWrapperStyle={styles.cardRow}
        showsVerticalScrollIndicator={false}
      />
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
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muscleGroupTabWrapper: {
    height: 70,
    width: '100%',
  },
  muscleGroupTabContainer: {
    height: 70,
  },
  muscleGroupTab: {
    paddingHorizontal: SPACING.screenHorizontal,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muscleGroupTabItem: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
    overflow: 'hidden',
  },
  muscleGroupTabItemActive: {
    backgroundColor: COLORS.primary,
    opacity: 0.8,
  },
  muscleGroupTabIcon: {
    fontSize: 24,
  },
  subheadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
  },
  subheading: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  cardsContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
  },
  cardRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  exerciseCard: {
    backgroundColor: 'transparent',
    borderRadius: 16,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  cardIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseImageContainer: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },
  exerciseCardTextBlock: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  exerciseCardName: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: 3,
  },
  exerciseCardMuscle: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
});
