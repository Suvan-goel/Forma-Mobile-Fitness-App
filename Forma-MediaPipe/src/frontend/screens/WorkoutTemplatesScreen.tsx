import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Heart, MoreHorizontal, Plus } from 'lucide-react-native';
import {
  CARD_SHADOW,
  COLORS,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_END,
  SCREEN_GRADIENT_START,
  SPACING,
} from '../constants/theme';
import { useAlert } from '../contexts/AlertContext';
import { useCustomTemplates } from '../../backend/hooks';
import type { CustomTemplate } from '../../backend/services/api';
import type { RecordStackParamList } from '../app/RootNavigator';

type WorkoutTemplatesNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'WorkoutTemplates'
>;

type TemplateTab = 'discover' | 'favourites';

interface TemplateExercise {
  name: string;
  category: string;
  targetSets: number;
  reps: string;
  rest: string;
}

interface WorkoutTemplate {
  id: string;
  name: string;
  description: string;
  focusTags: string[];
  estimatedDuration: string;
  lastUsed: string;
  volumeLabel: string;
  templateImage?: ImageSourcePropType;
  exercises: TemplateExercise[];
}

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
const FAVOURITE_TEMPLATES_STORAGE_KEY = 'forma:favourite-template-ids';

const getExerciseImage = (name: string): ImageSourcePropType => (
  EXERCISE_IMAGES[name] ?? DEFAULT_EXERCISE_IMAGE
);

const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'lower-body-strength',
    name: 'Lower Body Strength',
    description: 'Build lower body strength and muscle with compound lifts and unilateral work.',
    focusTags: ['Strength', 'Lower Body', 'Hypertrophy'],
    estimatedDuration: '~45 min',
    lastUsed: '15 sets · 1,250 kg',
    volumeLabel: 'Last used',
    templateImage: require('../assets/generated/templates/lower-body-strength.png'),
    exercises: [
      { name: 'Back Squat', category: 'Weightlifting', targetSets: 4, reps: '6-8', rest: '2 min' },
      { name: 'Romanian Deadlift', category: 'Weightlifting', targetSets: 3, reps: '8-10', rest: '2 min' },
      { name: 'Walking Lunge', category: 'Weightlifting', targetSets: 3, reps: '10/leg', rest: '90 sec' },
      { name: 'Leg Press', category: 'Weightlifting', targetSets: 3, reps: '10-12', rest: '2 min' },
    ],
  },
  {
    id: 'push-day',
    name: 'Push Day',
    description: 'Chest, shoulders, and triceps with a balanced pressing emphasis.',
    focusTags: ['Push', 'Upper Body', 'Strength'],
    estimatedDuration: '~40 min',
    lastUsed: 'May 12, 2025',
    volumeLabel: 'Last used',
    templateImage: require('../assets/generated/templates/push-day.png'),
    exercises: [
      { name: 'Push-Up', category: 'Calisthenics', targetSets: 4, reps: '8-12', rest: '90 sec' },
      { name: 'Standing Dumbbell Lateral Raises', category: 'Weightlifting', targetSets: 3, reps: '10-12', rest: '60 sec' },
      { name: 'Cable Pushdowns', category: 'Weightlifting', targetSets: 3, reps: '10-12', rest: '60 sec' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting', targetSets: 3, reps: '12-15', rest: '60 sec' },
    ],
  },
  {
    id: 'pull-day',
    name: 'Pull Day',
    description: 'Back and biceps with enough volume for posture and arm strength.',
    focusTags: ['Pull', 'Back', 'Biceps'],
    estimatedDuration: '~42 min',
    lastUsed: 'May 10, 2025',
    volumeLabel: 'Last used',
    templateImage: require('../assets/generated/templates/pull-day.png'),
    exercises: [
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting', targetSets: 4, reps: '8-10', rest: '90 sec' },
      { name: 'Cable Row', category: 'Weightlifting', targetSets: 3, reps: '8-10', rest: '90 sec' },
      { name: 'Barbell Curl', category: 'Weightlifting', targetSets: 3, reps: '10-12', rest: '60 sec' },
      { name: 'Machine Ab Crunches', category: 'Weightlifting', targetSets: 3, reps: '12-15', rest: '60 sec' },
    ],
  },
  {
    id: 'full-body',
    name: 'Full Body',
    description: 'A compact full-body session for busy training days.',
    focusTags: ['Full Body', 'Balanced', 'Conditioning'],
    estimatedDuration: '~50 min',
    lastUsed: 'May 9, 2025',
    volumeLabel: 'Last used',
    templateImage: require('../assets/generated/templates/full-body.png'),
    exercises: [
      { name: 'Back Squat', category: 'Weightlifting', targetSets: 3, reps: '6-8', rest: '2 min' },
      { name: 'Push-Up', category: 'Calisthenics', targetSets: 3, reps: '8-12', rest: '90 sec' },
      { name: 'Cable Row', category: 'Weightlifting', targetSets: 3, reps: '8-10', rest: '90 sec' },
      { name: 'Standing Dumbbell Lateral Raises', category: 'Weightlifting', targetSets: 3, reps: '10-12', rest: '60 sec' },
      { name: 'Barbell Curl', category: 'Weightlifting', targetSets: 2, reps: '10-12', rest: '60 sec' },
    ],
  },
];

const templateToRouteParams = (template: WorkoutTemplate) => ({
  templateName: template.name,
  description: template.description,
  exercises: template.exercises.map(ex => ({
    name: ex.name,
    category: ex.category,
    targetSets: ex.targetSets,
  })),
});

const estimateDuration = (exerciseCount: number): string => `~${Math.max(30, exerciseCount * 10)} min`;

const mapCustomTemplate = (template: CustomTemplate): WorkoutTemplate => {
  const totalSets = template.exercises.reduce((sum, ex) => sum + ex.targetSets, 0);
  const firstExerciseName = template.exercises[0]?.name ?? '';

  return {
    id: template.id,
    name: template.name,
    description: template.description || 'Your saved workout template.',
    focusTags: ['Custom', 'Saved'],
    estimatedDuration: estimateDuration(template.exercises.length),
    lastUsed: `${totalSets} sets`,
    volumeLabel: 'Planned',
    templateImage: getExerciseImage(firstExerciseName),
    exercises: template.exercises.map(ex => ({
      name: ex.name,
      category: ex.category,
      targetSets: ex.targetSets,
      reps: '8-12',
      rest: '90 sec',
    })),
  };
};

const TemplateCard: React.FC<{
  template: WorkoutTemplate;
  isFavourite: boolean;
  onPress: (template: WorkoutTemplate) => void;
  onFavouritePress: (template: WorkoutTemplate) => void;
  onMorePress?: (template: WorkoutTemplate) => void;
}> = ({ template, isFavourite, onPress, onFavouritePress, onMorePress }) => {
  const previewImages = template.exercises.slice(0, 4);

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(template)} activeOpacity={0.86}>
      <View style={styles.cardMainRow}>
        {template.templateImage ? (
          <View style={styles.templateImageRail}>
            <Image source={template.templateImage} style={styles.templateImage} resizeMode="contain" />
          </View>
        ) : (
          <View style={styles.imageRail}>
            <Image source={getExerciseImage(template.exercises[0]?.name)} style={styles.heroImage} resizeMode="cover" />
            <View style={styles.thumbRow}>
              {previewImages.slice(1, 4).map((exercise, index) => (
                <Image
                  key={`${template.id}-${exercise.name}-${index}`}
                  source={getExerciseImage(exercise.name)}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.cardCopy}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{template.name}</Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => onFavouritePress(template)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Heart
                size={17}
                color={isFavourite ? COLORS.accent : COLORS.textSecondary}
                fill={isFavourite ? COLORS.accent : 'transparent'}
                strokeWidth={2}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => onMorePress?.(template)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MoreHorizontal size={17} color={COLORS.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <Text style={styles.cardMeta} numberOfLines={1}>
            {template.exercises.length} exercises  ·  {template.estimatedDuration}
          </Text>
          <Text style={styles.cardSubmeta} numberOfLines={1}>
            {template.volumeLabel}  ·  {template.lastUsed}
          </Text>

          <View style={[styles.cardFooterRow, template.templateImage ? styles.cardFooterRowImageOnly : null]}>
            {!template.templateImage && (
              <View style={styles.miniThumbs}>
                {previewImages.slice(0, 3).map((exercise, index) => (
                  <Image
                    key={`${template.id}-mini-${exercise.name}-${index}`}
                    source={getExerciseImage(exercise.name)}
                    style={styles.miniThumb}
                    resizeMode="cover"
                  />
                ))}
              </View>
            )}
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.chooseButton}
            >
              <Text style={styles.chooseButtonText}>Choose</Text>
            </LinearGradient>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export const WorkoutTemplatesScreen: React.FC = () => {
  const navigation = useNavigation<WorkoutTemplatesNavigationProp>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { templates: customTemplates, deleteTemplate } = useCustomTemplates();
  const [activeTab, setActiveTab] = useState<TemplateTab>('discover');
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  const customTemplateCards = useMemo(
    () => customTemplates.map(mapCustomTemplate),
    [customTemplates],
  );

  const discoverTemplates = useMemo(
    () => [...WORKOUT_TEMPLATES, ...customTemplateCards],
    [customTemplateCards],
  );

  const favouriteTemplates = useMemo(
    () => discoverTemplates.filter(template => favouriteIds.has(template.id)),
    [discoverTemplates, favouriteIds],
  );

  const visibleTemplates = activeTab === 'favourites'
    ? favouriteTemplates
    : discoverTemplates;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(FAVOURITE_TEMPLATES_STORAGE_KEY)
      .then(value => {
        if (!mounted || !value) return;
        const ids = JSON.parse(value);
        if (Array.isArray(ids)) {
          setFavouriteIds(new Set(ids.filter(id => typeof id === 'string')));
        }
      })
      .catch(() => {
        // Favourites are non-critical; ignore storage read failures.
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectTemplate = useCallback((template: WorkoutTemplate) => {
    navigation.navigate('TemplatePreview', templateToRouteParams(template));
  }, [navigation]);

  const handleGoBack = useCallback(() => {
    navigation.navigate('RecordLanding');
  }, [navigation]);

  const handleCreateTemplate = useCallback(() => {
    navigation.navigate('CreateTemplate');
  }, [navigation]);

  const handleToggleFavourite = useCallback((template: WorkoutTemplate) => {
    setFavouriteIds(prev => {
      const next = new Set(prev);
      if (next.has(template.id)) {
        next.delete(template.id);
      } else {
        next.add(template.id);
      }

      AsyncStorage.setItem(FAVOURITE_TEMPLATES_STORAGE_KEY, JSON.stringify(Array.from(next))).catch(() => {
        // UI can still update even if persistence fails.
      });

      return next;
    });
  }, []);

  const handleMorePress = useCallback((template: WorkoutTemplate) => {
    const custom = customTemplates.find(item => item.id === template.id);
    if (!custom) return;

    showAlert(
      'Delete Template?',
      `Delete "${template.name}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(template.id) },
      ],
    );
  }, [customTemplates, deleteTemplate, showAlert]);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTitleRow}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack} activeOpacity={0.72}>
            <ChevronLeft size={24} color={COLORS.textSecondary} strokeWidth={1.7} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Templates</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={handleCreateTemplate} activeOpacity={0.75}>
          <Plus size={17} color={COLORS.accent} strokeWidth={2.3} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'discover' && styles.segmentActive]}
          onPress={() => setActiveTab('discover')}
          activeOpacity={0.82}
        >
          <Text style={[styles.segmentText, activeTab === 'discover' && styles.segmentTextActive]}>
            Discover
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'favourites' && styles.segmentActive]}
          onPress={() => setActiveTab('favourites')}
          activeOpacity={0.82}
        >
          <Text style={[styles.segmentText, activeTab === 'favourites' && styles.segmentTextActive]}>
            Favourites
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.list, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {visibleTemplates.length > 0 ? (
            visibleTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isFavourite={favouriteIds.has(template.id)}
                onPress={handleSelectTemplate}
                onFavouritePress={handleToggleFavourite}
                onMorePress={handleMorePress}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No favourites yet</Text>
              <Text style={styles.emptyText}>Tap the heart on a template to keep it here.</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </LinearGradient>
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
    paddingBottom: 14,
  },
  headerTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButton: {
    width: 34,
    height: 34,
    marginLeft: -9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
    letterSpacing: 0,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingLeft: 8,
  },
  newButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.accent,
    letterSpacing: 0,
  },
  segmentedControl: {
    height: 39,
    flexDirection: 'row',
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 14,
    padding: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(26, 32, 37, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  segmentActive: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 3,
  },
  segmentText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  segmentTextActive: {
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  list: {
    gap: 12,
  },
  card: {
    minHeight: 154,
    borderRadius: 8,
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  cardMainRow: {
    flexDirection: 'row',
    padding: 10,
    gap: 12,
  },
  imageRail: {
    width: 66,
    gap: 9,
  },
  templateImageRail: {
    width: 132,
    height: 132,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: COLORS.cardBackgroundLight,
  },
  templateImage: {
    width: '100%',
    height: '100%',
  },
  heroImage: {
    width: 66,
    height: 66,
    borderRadius: 7,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 6,
  },
  thumbImage: {
    width: 18,
    height: 42,
    borderRadius: 5,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  cardCopy: {
    flex: 1,
    minHeight: 132,
    justifyContent: 'flex-start',
  },
  cardTitleRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: {
    marginTop: 2,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  cardSubmeta: {
    marginTop: 7,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  cardFooterRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardFooterRowImageOnly: {
    justifyContent: 'flex-start',
  },
  miniThumbs: {
    flexDirection: 'row',
    gap: 7,
    paddingBottom: 2,
  },
  miniThumb: {
    width: 42,
    height: 34,
    borderRadius: 5,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  chooseButton: {
    minWidth: 88,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  chooseButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0,
  },
  emptyState: {
    minHeight: 164,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(31, 39, 45, 0.36)',
    paddingHorizontal: 18,
  },
  emptyTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  emptyText: {
    marginTop: 7,
    textAlign: 'center',
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
});
