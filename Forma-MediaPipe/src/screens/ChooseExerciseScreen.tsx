import React from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  SectionList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
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

// Exercise data organized by category
const workoutExercises: { [key: string]: string[] } = {
  Weightlifting: [
    'Bench Press',
    'Squat',
    'Deadlift',
    'Overhead Press',
    'Barbell Row',
    'Bicep Curl',
    'Tricep Extension',
    'Leg Press',
  ],
  Calisthenics: [
    'Push-ups',
    'Pull-ups',
    'Dips',
    'Squats',
    'Lunges',
    'Plank',
    'Burpees',
    'Mountain Climbers',
  ],
  'Mobility & Flexibility': [
    'Hip Flexor Stretch',
    'Hamstring Stretch',
    'Shoulder Mobility',
    'Spinal Twist',
    'Pigeon Pose',
    'Downward Dog',
    'Cat-Cow Stretch',
    'Quad Stretch',
  ],
  Sport: [
    'Running',
    'Cycling',
    'Swimming',
    'Tennis',
    'Basketball',
    'Soccer',
    'Yoga',
    'Pilates',
  ],
};

// Convert to section list format
const exerciseSections = Object.entries(workoutExercises).map(([category, exercises]) => ({
  title: category,
  data: exercises,
}));

export const ChooseExerciseScreen: React.FC = () => {
  const navigation = useNavigation<ChooseExerciseNavigationProp>();
  const insets = useSafeAreaInsets();

  const handleSelectExercise = (exerciseName: string, category: string) => {
    navigation.navigate('Camera', {
      exerciseName,
      category,
      returnToCurrentWorkout: true,
    });
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Exercise</Text>
        <View style={styles.backButton} />
      </View>

      {/* Exercise List */}
      <SectionList
        sections={exerciseSections}
        keyExtractor={(item, index) => `${item}-${index}`}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        )}
        renderItem={({ item, section }) => (
          <TouchableOpacity
            style={styles.exerciseItem}
            onPress={() => handleSelectExercise(item, section.title)}
            activeOpacity={0.7}
          >
            <Text style={styles.exerciseName}>{item}</Text>
            <ChevronRight size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 80 },
        ]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
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
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  sectionHeader: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  exerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E2228',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  exerciseName: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    flex: 1,
  },
});
