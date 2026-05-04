import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import {
  CARD_SHADOW,
  COLORS,
  FONTS,
  PAGE_TITLE_TEXT,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_END,
  SCREEN_GRADIENT_START,
  SPACING,
} from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import type { RecordStackParamList } from '../app/RootNavigator';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type TemplatePreviewNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'TemplatePreview'>;
type TemplatePreviewRouteProp = RouteProp<RecordStackParamList, 'TemplatePreview'>;

const EXERCISE_IMAGES: Record<string, ImageSourcePropType> = {
  'Push-Up': require('../assets/exercises/push_up.png'),
  'Cable Pushdowns': require('../assets/exercises/cable_pushdowns.png'),
  'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
  'Machine Ab Crunches': require('../assets/exercises/machine_ab_crunches.png'),
  'Barbell Squat': require('../assets/exercises/barbell_squat.png'),
  'Back Squat': require('../assets/exercises/barbell_squat.png'),
  'Romanian Deadlift': require('../assets/exercises/lying_leg_curl.png'),
  'Walking Lunge': require('../assets/exercises/leg_extensions.png'),
  'Leg Press': require('../assets/exercises/leg_extensions.png'),
  'Leg Extensions': require('../assets/exercises/leg_extensions.png'),
  'Lying Leg Curl': require('../assets/exercises/lying_leg_curl.png'),
  'Cable Lat Pulldowns': require('../assets/exercises/cable_lat_pulldowns.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises.png'),
  'Cable Row': require('../assets/exercises/cable_row.png'),
};

const DEFAULT_EXERCISE_IMAGE = require('../assets/sports_bg.png');

const PLAN_BY_EXERCISE: Record<string, { reps: string; rest: string }> = {
  'Back Squat': { reps: '6-8', rest: '2 min' },
  'Barbell Squat': { reps: '6-8', rest: '2 min' },
  'Romanian Deadlift': { reps: '8-10', rest: '2 min' },
  'Walking Lunge': { reps: '10/leg', rest: '90 sec' },
  'Leg Press': { reps: '10-12', rest: '2 min' },
  'Push-Up': { reps: '8-12', rest: '90 sec' },
  'Cable Pushdowns': { reps: '10-12', rest: '60 sec' },
  'Barbell Curl': { reps: '10-12', rest: '60 sec' },
  'Machine Ab Crunches': { reps: '12-15', rest: '60 sec' },
  'Leg Extensions': { reps: '10-12', rest: '75 sec' },
  'Lying Leg Curl': { reps: '10-12', rest: '75 sec' },
  'Cable Lat Pulldowns': { reps: '8-10', rest: '90 sec' },
  'Standing Dumbbell Lateral Raises': { reps: '10-12', rest: '60 sec' },
  'Cable Row': { reps: '8-10', rest: '90 sec' },
};

const getExerciseImage = (name: string): ImageSourcePropType => (
  EXERCISE_IMAGES[name] ?? DEFAULT_EXERCISE_IMAGE
);

const estimateDuration = (exerciseCount: number, totalSets: number): string => {
  const minutes = Math.max(35, Math.round(totalSets * 3.25 + exerciseCount * 2));
  return `~${minutes} min`;
};

const getTags = (templateName: string): string[] => {
  const lowerName = templateName.toLowerCase();
  if (lowerName.includes('lower') || lowerName.includes('leg')) return ['Strength', 'Lower Body', 'Hypertrophy'];
  if (lowerName.includes('push')) return ['Push', 'Upper Body', 'Strength'];
  if (lowerName.includes('pull')) return ['Pull', 'Back', 'Biceps'];
  return ['Strength', 'Full Body', 'Conditioning'];
};

const ExerciseRow: React.FC<{
  name: string;
  index: number;
  sets: number;
  reps: string;
  rest: string;
}> = ({ name, index, sets, reps, rest }) => (
  <View style={styles.exerciseRow}>
    <Text style={styles.exerciseIndex}>{index + 1}</Text>
    <View style={styles.exerciseNameCell}>
      <Image source={getExerciseImage(name)} style={styles.exerciseThumb} resizeMode="cover" />
      <Text style={styles.exerciseName} numberOfLines={2}>{name}</Text>
    </View>
    <Text style={styles.valueCell}>{sets}</Text>
    <Text style={styles.valueCell}>{reps}</Text>
    <Text style={styles.restCell}>{rest}</Text>
  </View>
);

export const TemplatePreviewScreen: React.FC = () => {
  const navigation = useNavigation<TemplatePreviewNavigationProp>();
  const route = useRoute<TemplatePreviewRouteProp>();
  const insets = useSafeAreaInsets();
  const { addExercise, clearSets } = useCurrentWorkout();

  const { templateName, description, exercises } = route.params;
  const totalSets = useMemo(
    () => exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0),
    [exercises],
  );
  const estimatedDuration = useMemo(
    () => estimateDuration(exercises.length, totalSets),
    [exercises.length, totalSets],
  );
  const tags = useMemo(() => getTags(templateName), [templateName]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleStartWorkout = useCallback(() => {
    clearSets();
    exercises.forEach(ex => {
      addExercise({ name: ex.name, category: ex.category });
    });
    navigation.navigate('CurrentWorkout');
  }, [addExercise, clearSets, exercises, navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 7 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity style={styles.headerIconButton} onPress={handleGoBack} activeOpacity={0.72}>
            <ChevronLeft size={24} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{templateName.toUpperCase()}</Text>
        </View>
        <Text style={styles.headerMeta}>
          {exercises.length} exercises  ·  {estimatedDuration}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 112) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.tableCard}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.exerciseHeaderText]}>Exercise</Text>
              <Text style={styles.tableHeaderText}>Sets</Text>
              <Text style={styles.tableHeaderText}>Reps</Text>
              <Text style={styles.tableHeaderText}>Rest</Text>
            </View>

            {exercises.map((exercise, index) => {
              const plan = PLAN_BY_EXERCISE[exercise.name] ?? { reps: '8-12', rest: '90 sec' };
              return (
                <ExerciseRow
                  key={`${exercise.name}-${index}`}
                  name={exercise.name}
                  index={index}
                  sets={exercise.targetSets}
                  reps={plan.reps}
                  rest={plan.rest}
                />
              );
            })}
          </View>

          <View style={styles.aboutCard}>
            <Text style={styles.aboutTitle}>About this template</Text>
            <Text style={styles.aboutText}>
              {description || 'Build strength and consistency with a focused session built around clean movement and repeatable volume.'}
            </Text>
            <View style={styles.tagRow}>
              {tags.map(tag => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      <View style={[styles.bottomPanel, { paddingBottom: getBottomOverlayPadding(insets.bottom, 10) }]}>
        <TouchableOpacity onPress={handleStartWorkout} activeOpacity={0.86}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>Start Workout</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 10,
  },
  headerTopRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'left',
    ...PAGE_TITLE_TEXT,
  },
  headerMeta: {
    marginTop: 2,
    marginLeft: 32,
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  tableCard: {
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  tableHeader: {
    height: 41,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 50,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.045)',
  },
  tableHeaderText: {
    width: 50,
    textAlign: 'center',
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  exerciseHeaderText: {
    flex: 1,
    width: undefined,
    textAlign: 'left',
  },
  exerciseRow: {
    minHeight: 81,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.038)',
  },
  exerciseIndex: {
    width: 30,
    textAlign: 'center',
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  exerciseNameCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exerciseThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  exerciseName: {
    flex: 1,
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    lineHeight: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  valueCell: {
    width: 50,
    textAlign: 'center',
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  restCell: {
    width: 50,
    textAlign: 'center',
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  aboutCard: {
    marginTop: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    paddingHorizontal: 13,
    paddingVertical: 14,
    ...CARD_SHADOW,
  },
  aboutTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  aboutText: {
    marginTop: 10,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 13,
  },
  tagPill: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.045)',
  },
  tagText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(7, 10, 13, 0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.045)',
  },
  startButton: {
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
});
