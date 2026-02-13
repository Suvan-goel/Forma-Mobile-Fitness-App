import React from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, Video, Lightbulb, ChevronDown } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { RootStackParamList } from '../app/RootNavigator';

type WorkoutInfoRouteProp = RouteProp<RootStackParamList, 'WorkoutInfo'>;

const category = {
  title: 'Weightlifting',
  color: COLORS.primary,
};

const exercises = [
  'Bench Press',
  'Squat',
  'Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Bicep Curl',
  'Tricep Extension',
  'Leg Press',
];

// Day colors from logbook page (faded for backgrounds, full for icons)
const getDayColors = () => {
  return {
    sunday: { faded: 'rgba(236, 72, 153, 0.6)', full: 'rgba(236, 72, 153, 1)' }, // Pink/Magenta
    monday: { faded: 'rgba(245, 158, 11, 0.6)', full: 'rgba(245, 158, 11, 1)' }, // Orange/Amber
    tuesday: { faded: 'rgba(0, 172, 124, 0.6)', full: 'rgba(0, 172, 124, 1)' }, // Teal (primary)
    wednesday: { faded: 'rgba(0, 172, 124, 0.6)', full: 'rgba(0, 172, 124, 1)' }, // Teal (primary)
    thursday: { faded: 'rgba(139, 92, 246, 0.6)', full: 'rgba(139, 92, 246, 1)' }, // Purple
    friday: { faded: 'rgba(239, 68, 68, 0.6)', full: 'rgba(239, 68, 68, 1)' }, // Red
    saturday: { faded: 'rgba(59, 130, 246, 0.6)', full: 'rgba(59, 130, 246, 1)' }, // Blue
  };
};

const dayColors = getDayColors();

const recordingInstructions = [
  {
    icon: Video,
    title: 'Position Your Device',
    description: 'Place your phone or camera at a stable position where your full body or the exercise area is visible.',
    colors: dayColors.sunday, // Pink/Magenta
  },
  {
    icon: Lightbulb,
    title: 'Good Lighting',
    description: 'Ensure you have adequate lighting so the AI can accurately track your movements and form.',
    colors: dayColors.monday, // Orange/Amber
  },
  {
    icon: CheckCircle2,
    title: 'Clear Background',
    description: 'Use a clear, uncluttered background for better exercise detection and analysis.',
    colors: dayColors.tuesday, // Green
  },
];

export const WorkoutInfoScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<WorkoutInfoRouteProp>();
  const insets = useSafeAreaInsets();
  const color = category.color;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <ChevronDown size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { 
          paddingTop: SPACING.xs,
          paddingBottom: Math.max(insets.bottom, SPACING.xl) + 100 
        }]}
        showsVerticalScrollIndicator={false}
      >
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
              const iconColors = instruction.colors || { faded: color + '20', full: color };
              return (
                <View key={index} style={styles.instructionItem}>
                  <View style={[styles.instructionIconContainer, { backgroundColor: iconColors.faded }]}>
                    <InstructionIcon size={20} color={COLORS.text} />
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.md,
    zIndex: 10,
  },
  closeButton: {
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
    paddingBottom: 100,
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
});

