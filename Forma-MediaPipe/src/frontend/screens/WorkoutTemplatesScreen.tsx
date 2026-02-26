import React, { useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Dumbbell } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import type { RecordStackParamList } from '../app/RootNavigator';

type WorkoutTemplatesNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'WorkoutTemplates'
>;

/* ── Template Data ──────────────────────── */

interface TemplateExercise {
  name: string;
  category: string;
}

interface WorkoutTemplate {
  id: string;
  name: string;
  focusTag: string;
  description: string;
  exercises: TemplateExercise[];
}

const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'push-press',
    name: 'Push & Press',
    focusTag: 'CHEST · SHOULDERS · TRICEPS',
    description: 'Upper body pushing power with shoulder isolation.',
    exercises: [
      { name: 'Push-Up', category: 'Calisthenics' },
      { name: 'Standing Dumbbell Lateral Raises', category: 'Weightlifting' },
      { name: 'Cable Pushdowns', category: 'Weightlifting' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting' },
    ],
  },
  {
    id: 'pull-curl',
    name: 'Pull & Curl',
    focusTag: 'BACK · BICEPS · CORE',
    description: 'Build a strong back and thick biceps.',
    exercises: [
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting' },
      { name: 'Cable Row', category: 'Weightlifting' },
      { name: 'Barbell Curl', category: 'Weightlifting' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting' },
    ],
  },
  {
    id: 'leg-day',
    name: 'Leg Day',
    focusTag: 'QUADS · HAMSTRINGS · CORE',
    description: 'Complete lower body strength and isolation.',
    exercises: [
      { name: 'Barbell Squat', category: 'Weightlifting' },
      { name: 'Leg Extensions', category: 'Weightlifting' },
      { name: 'Lying Leg Curl', category: 'Weightlifting' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting' },
    ],
  },
  {
    id: 'upper-body-blast',
    name: 'Upper Body Blast',
    focusTag: 'CHEST · BACK · SHOULDERS · ARMS',
    description: 'Balanced push-pull superset for full upper body.',
    exercises: [
      { name: 'Push-Up', category: 'Calisthenics' },
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting' },
      { name: 'Standing Dumbbell Lateral Raises', category: 'Weightlifting' },
      { name: 'Cable Row', category: 'Weightlifting' },
      { name: 'Barbell Curl', category: 'Weightlifting' },
      { name: 'Cable Pushdowns', category: 'Weightlifting' },
    ],
  },
  {
    id: 'full-body-power',
    name: 'Full Body Power',
    focusTag: 'FULL BODY',
    description: 'Hit every muscle group in a single session.',
    exercises: [
      { name: 'Barbell Squat', category: 'Weightlifting' },
      { name: 'Push-Up', category: 'Calisthenics' },
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting' },
      { name: 'Cable Row', category: 'Weightlifting' },
      { name: 'Barbell Curl', category: 'Weightlifting' },
      { name: 'Leg Extensions', category: 'Weightlifting' },
      { name: 'Lying Leg Curl', category: 'Weightlifting' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting' },
    ],
  },
];

/* ── Exercise Chip ──────────────────────── */

const ExerciseChip: React.FC<{ name: string }> = ({ name }) => (
  <View style={styles.chip}>
    <Text style={styles.chipText} numberOfLines={1}>{name}</Text>
  </View>
);

/* ── Template Card ──────────────────────── */

const TemplateCard: React.FC<{
  template: WorkoutTemplate;
  onPress: (template: WorkoutTemplate) => void;
}> = ({ template, onPress }) => (
  <TouchableOpacity
    style={styles.cardOuter}
    onPress={() => onPress(template)}
    activeOpacity={0.82}
  >
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.cardGradient}
    >
      <View style={styles.cardGlassEdge}>
        {/* ── Top Row: name + count badge ── */}
        <View style={styles.cardTopRow}>
          <View style={styles.cardTitleBlock}>
            <Text style={styles.cardName}>{template.name}</Text>
            <View style={styles.focusTagRow}>
              <Text style={styles.focusTag}>{template.focusTag}</Text>
            </View>
          </View>
          <View style={styles.cardTopRight}>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{template.exercises.length}</Text>
              <Text style={styles.countBadgeLabel}>EX</Text>
            </View>
            <ChevronRight size={18} color={COLORS.accent} strokeWidth={1.5} />
          </View>
        </View>

        {/* ── Description ── */}
        <Text style={styles.cardDescription}>{template.description}</Text>

        {/* ── Exercise Chips ── */}
        <View style={styles.chipsRow}>
          {template.exercises.map((ex) => (
            <ExerciseChip key={ex.name} name={ex.name} />
          ))}
        </View>
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

/* ── Main Screen ────────────────────────── */

export const WorkoutTemplatesScreen: React.FC = () => {
  const navigation = useNavigation<WorkoutTemplatesNavigationProp>();
  const insets = useSafeAreaInsets();
  const { addExercise, clearSets } = useCurrentWorkout();

  const handleSelectTemplate = useCallback((template: WorkoutTemplate) => {
    // Clear any previous workout state before loading template
    clearSets();
    // Add all template exercises to the workout context
    template.exercises.forEach((ex) => {
      addExercise({ name: ex.name, category: ex.category });
    });
    // Navigate to the active workout screen
    navigation.navigate('CurrentWorkout');
  }, [addExercise, clearSets, navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>TEMPLATES</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Subtitle ─────────────────────── */}
      <View style={styles.subtitleBlock}>
        <Dumbbell size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
        <Text style={styles.subtitle}>Select a template to pre-load exercises</Text>
      </View>

      {/* ── Template List ────────────────── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {WORKOUT_TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onPress={handleSelectTemplate}
          />
        ))}
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Header ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 2,
  },
  headerSpacer: {
    width: 36,
  },

  /* ── Subtitle ─────────────────────────── */
  subtitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
    paddingBottom: 20,
  },
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },

  /* ── Scroll ─────────────────────────────── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 14,
  },

  /* ── Card ─────────────────────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
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
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20,
    gap: 10,
  },

  /* ── Card Top Row ─────────────────────── */
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardTitleBlock: {
    flex: 1,
    gap: 5,
    marginRight: 12,
  },
  cardName: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  focusTagRow: {
    flexDirection: 'row',
  },
  focusTag: {
    fontFamily: FONTS.ui.bold,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 1.5,
  },
  cardTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    flexDirection: 'row',
    gap: 3,
  },
  countBadgeText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.accent,
    lineHeight: 16,
  },
  countBadgeLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 1,
    lineHeight: 16,
  },

  /* ── Description ─────────────────────── */
  cardDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0.1,
    lineHeight: 18,
  },

  /* ── Exercise Chips ─────────────────── */
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  chipText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
});
