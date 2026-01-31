import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, Video, Lightbulb, Dumbbell, Activity, Move, Award, ChevronLeft } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { RootStackParamList } from '../app/RootNavigator';

type WorkoutExercisesRouteProp = RouteProp<RootStackParamList, 'WorkoutExercises'>;

const iconMap: { [key: string]: any } = {
  'Weightlifting': Dumbbell,
  'Calisthenics': Activity,
  'Mobility & Flexibility': Move,
  'Sport': Award,
};

// Exercise data for each workout type
const workoutExercises: { [key: string]: string[] } = {
  'Weightlifting': [
    'Bench Press',
    'Squat',
    'Deadlift',
    'Overhead Press',
    'Barbell Row',
    'Bicep Curl',
    'Tricep Extension',
    'Leg Press',
  ],
  'Calisthenics': [
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
  'Sport': [
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

const recordingInstructions = [
  {
    icon: Video,
    title: 'Position Your Device',
    description: 'Place your phone or camera at a stable position where your full body or the exercise area is visible.',
  },
  {
    icon: Lightbulb,
    title: 'Good Lighting',
    description: 'Ensure you have adequate lighting so the AI can accurately track your movements and form.',
  },
  {
    icon: CheckCircle2,
    title: 'Clear Background',
    description: 'Use a clear, uncluttered background for better exercise detection and analysis.',
  },
];

export const WorkoutExercisesScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<WorkoutExercisesRouteProp>();
  const insets = useSafeAreaInsets();
  const { category, color, iconName } = route.params;
  const Icon = iconMap[iconName] || Dumbbell;
  const navBarMargin = insets.bottom > 0 ? insets.bottom - 20 : 0;
  const footerHeight = 80 + navBarMargin + 20;

  const exercises = workoutExercises[category] || [];

  const handleStartWorkout = () => {
    navigation.navigate('Camera', { category });
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      {/* Back Button */}
      <View style={[styles.topBar, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          activeOpacity={0.7}
        >
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
            <Icon size={32} color={color} />
          </View>
          <Text style={styles.headerTitle}>{category}</Text>
        </View>

        {/* Supported Exercises Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Supported Exercises</Text>
          <View style={styles.exercisesList}>
            {exercises.map((exercise, index) => (
              <View key={index} style={styles.exerciseItem}>
                <CheckCircle2 size={18} color={color} />
                <Text style={styles.exerciseName}>{exercise}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Recording Instructions Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recording Tips</Text>
          <View style={styles.instructionsList}>
            {recordingInstructions.map((instruction, index) => {
              const InstructionIcon = instruction.icon;
              return (
                <View key={index} style={styles.instructionItem}>
                  <View style={[styles.instructionIconContainer, { backgroundColor: color + '20' }]}>
                    <InstructionIcon size={20} color={color} />
                  </View>
                  <View style={styles.instructionContent}>
                    <Text style={styles.instructionTitle}>{instruction.title}</Text>
                    <Text style={styles.instructionDescription}>{instruction.description}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Start Workout Button */}
      <View style={[styles.buttonContainer, { 
        bottom: 0, 
        paddingTop: Math.max(insets.bottom, SPACING.md),
        paddingBottom: Math.max(insets.bottom, SPACING.md)
      }]}>
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: color }]}
          onPress={handleStartWorkout}
          activeOpacity={0.8}
        >
          <Text style={styles.startButtonText}>Start Workout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
    paddingRight: SPACING.md,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    flex: 1,
    flexWrap: 'wrap',
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  exercisesList: {
    ...CARD_STYLE,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  exerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  exerciseName: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  instructionsList: {
    gap: SPACING.md,
  },
  instructionItem: {
    flexDirection: 'row',
    ...CARD_STYLE,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  instructionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionContent: {
    flex: 1,
    gap: 4,
  },
  instructionTitle: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  instructionDescription: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  buttonContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  startButton: {
    borderRadius: 40,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});

