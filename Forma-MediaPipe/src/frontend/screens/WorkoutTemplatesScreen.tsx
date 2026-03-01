import React, { useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Dumbbell, Layers, Zap } from 'lucide-react-native';
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
      { name: 'Barbell Squat', category: 'Calisthenics' },
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
    activeOpacity={0.85}
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
            <Text style={styles.focusTag}>{template.focusTag}</Text>
          </View>
          <View style={styles.cardTopRight}>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{template.exercises.length}</Text>
              <Text style={styles.countBadgeLabel}>EX</Text>
            </View>
            <ChevronRight size={16} color={COLORS.accent} strokeWidth={1.5} />
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
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
  }, [fadeAnim, slideAnim]);

  const handleSelectTemplate = useCallback((template: WorkoutTemplate) => {
    clearSets();
    template.exercises.forEach((ex) => {
      addExercise({ name: ex.name, category: ex.category });
    });
    navigation.navigate('CurrentWorkout');
  }, [addExercise, clearSets, navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* ── Header ──────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack} activeOpacity={0.7}>
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Templates</Text>
            <Text style={styles.headerSubtitle}>{WORKOUT_TEMPLATES.length} routines</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Hero Intro Card ─────────────────── */}
          <LinearGradient
            colors={['#1E1A2E', '#151020', '#0C0A14']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroEdge}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroIconWrap}>
                  <Layers size={18} color={COLORS.accent} strokeWidth={1.5} />
                </View>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.heroTitle}>Quick Start</Text>
                  <Text style={styles.heroSubtext}>
                    Select a template to pre-load exercises into your workout
                  </Text>
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* ── Section Header ──────────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ROUTINES</Text>
            </View>
            <View style={styles.templateCountPill}>
              <Zap size={10} color={COLORS.accent} strokeWidth={2} />
              <Text style={styles.templateCountText}>{WORKOUT_TEMPLATES.length}</Text>
            </View>
          </View>

          {/* ── Template List ────────────────────── */}
          <View style={styles.templateList}>
            {WORKOUT_TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onPress={handleSelectTemplate}
              />
            ))}
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    gap: 1,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
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
    paddingBottom: 160,
  },

  /* ── Hero Intro Card ─────────────────────── */
  heroCard: {
    borderRadius: 22,
    marginTop: 18,
  },
  heroEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  heroSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },

  /* ── Section Header ──────────────────────── */
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
  templateCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  templateCountText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.accent,
    letterSpacing: -0.3,
  },

  /* ── Template List ───────────────────────── */
  templateList: {
    gap: 10,
  },

  /* ── Card ─────────────────────────────── */
  cardOuter: {
    borderRadius: 18,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardGradient: {
    borderRadius: 18,
  },
  cardGlassEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
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
    gap: 4,
    marginRight: 12,
  },
  cardName: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    flexDirection: 'row',
    gap: 3,
  },
  countBadgeText: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.accent,
    lineHeight: 16,
  },
  countBadgeLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
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
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  chipText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
});
