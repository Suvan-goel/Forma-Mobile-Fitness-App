import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bookmark, HelpCircle, Search } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';

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

// Muscle groups for the sliding tab
const muscleGroups = [
  { id: 'all', name: 'All', icon: '💪' },
  { id: 'chest', name: 'Chest', icon: '🫁' },
  { id: 'back', name: 'Back', icon: '🦴' },
  { id: 'shoulders', name: 'Shoulders', icon: '💪' },
  { id: 'arms', name: 'Arms', icon: '💪' },
  { id: 'abs', name: 'Abs', icon: '🫁' },
  { id: 'legs', name: 'Legs', icon: '🦵' },
  { id: 'hamstrings', name: 'Hamstrings', icon: '🦵' },
  { id: 'glutes', name: 'Glutes', icon: '🍑' },
  { id: 'calves', name: 'Calves', icon: '🦵' },
];

// Exercise data organized by muscle group
interface Exercise {
  name: string;
  muscleGroup: string;
  category: string;
  image?: any; // Placeholder for exercise images
}

const allExercises: Exercise[] = [
  // Chest exercises
  { name: 'Bench Press', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Push-ups', muscleGroup: 'chest', category: 'Calisthenics' },
  { name: 'Chest Fly', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Dips', muscleGroup: 'chest', category: 'Calisthenics' },
  
  // Back exercises
  { name: 'Deadlift', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Barbell Row', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Pull-ups', muscleGroup: 'back', category: 'Calisthenics' },
  { name: 'Lat Pulldown', muscleGroup: 'back', category: 'Weightlifting' },
  
  // Shoulders
  { name: 'Overhead Press', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Lateral Raises', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Shoulder Mobility', muscleGroup: 'shoulders', category: 'Mobility & Flexibility' },
  
  // Arms
  { name: 'Bicep Curl', muscleGroup: 'arms', category: 'Weightlifting' },
  { name: 'Tricep Extension', muscleGroup: 'arms', category: 'Weightlifting' },
  { name: 'Hammer Curl', muscleGroup: 'arms', category: 'Weightlifting' },
  
  // Abs
  { name: 'Plank', muscleGroup: 'abs', category: 'Calisthenics' },
  { name: 'Crunches', muscleGroup: 'abs', category: 'Calisthenics' },
  { name: 'Leg Raises', muscleGroup: 'abs', category: 'Calisthenics' },
  
  // Legs
  { name: 'Squat', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Press', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Lunges', muscleGroup: 'legs', category: 'Calisthenics' },
  { name: 'Squats', muscleGroup: 'legs', category: 'Calisthenics' },
  
  // Hamstrings
  { name: 'Lever Lying Leg Curl', muscleGroup: 'hamstrings', category: 'Weightlifting' },
  { name: 'Barbell Stiff Legged Deadlift', muscleGroup: 'hamstrings', category: 'Weightlifting' },
  { name: 'Hamstring Stretch', muscleGroup: 'hamstrings', category: 'Mobility & Flexibility' },
  
  // Glutes
  { name: 'Sled 45° Leg Press', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Hip Thrust', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Glute Bridge', muscleGroup: 'glutes', category: 'Calisthenics' },
  
  // Calves
  { name: 'Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Standing Calf Raise', muscleGroup: 'calves', category: 'Weightlifting' },
];

export const ChooseExerciseScreen: React.FC = () => {
  const navigation = useNavigation<ChooseExerciseNavigationProp>();
  const insets = useSafeAreaInsets();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('all');

  const handleSelectExercise = (exercise: Exercise) => {
    navigation.navigate('Camera', {
      exerciseName: exercise.name,
      category: exercise.category,
      returnToCurrentWorkout: true,
      cameraSessionKey: Date.now(),
    });
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
      style={styles.exerciseCard}
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
      
      {/* Placeholder for exercise image - in real app, this would be an actual image */}
      <View style={styles.exerciseImagePlaceholder}>
        <Text style={styles.exerciseImageText}>{item.name.charAt(0)}</Text>
      </View>
      
      <Text style={styles.exerciseCardName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.exerciseCardMuscle} numberOfLines={1}>
        {muscleGroups.find(m => m.id === item.muscleGroup)?.name || item.muscleGroup}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
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
          <TouchableOpacity style={styles.muscleGroupTabItem}>
            <Text style={styles.muscleGroupTabIcon}>🔖</Text>
          </TouchableOpacity>
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

      {/* All Exercises Subheading */}
      <View style={styles.subheadingContainer}>
        <Text style={styles.subheading}>All exercises</Text>
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
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 80 },
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
    paddingHorizontal: SPACING.lg,
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
    paddingHorizontal: SPACING.md,
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  subheading: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  cardsContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  cardRow: {
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  exerciseCard: {
    width: '48%',
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
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
  exerciseImagePlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: COLORS.cardBackgroundLight,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  exerciseImageText: {
    fontSize: 32,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
  },
  exerciseCardName: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
    minHeight: 36,
  },
  exerciseCardMuscle: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
});
