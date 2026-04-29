import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Dumbbell, Layers, Plus, Sparkles, X, Zap } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useAlert } from '../contexts/AlertContext';
import { useWorkoutPreferences, useCustomTemplates } from '../../backend/hooks';
import type { CustomTemplate } from '../../backend/services/api';
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

/* ── Frequency → Recommended Template IDs ─ */

const RECOMMENDED_BY_FREQUENCY: Record<string, string[]> = {
  '1-2': ['full-body-power', 'upper-body-blast'],
  '3-4': ['push-press', 'pull-curl', 'leg-day'],
  '5+': ['push-press', 'pull-curl', 'leg-day', 'upper-body-blast', 'full-body-power'],
};

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

/* ── Custom Template Card (swipe-to-delete) ── */

const DELETE_AREA_WIDTH = 72;

const CustomTemplateCard: React.FC<{
  template: CustomTemplate;
  onPress: (template: CustomTemplate) => void;
  onDelete: (id: string) => void;
}> = ({ template, onPress, onDelete }) => {
  const { showAlert } = useAlert();
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpen = useRef(false);

  const closeSwipe = useCallback(() => {
    isSwipeOpen.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 2 && Math.abs(gs.dx) > 8,
      onPanResponderGrant: () => {
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const newValue = startOffset + gs.dx;
        translateX.setValue(Math.min(0, Math.max(newValue, -DELETE_AREA_WIDTH)));
      },
      onPanResponderRelease: (_, gs) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const projected = startOffset + gs.dx;
        const shouldOpen = projected < -(DELETE_AREA_WIDTH / 2);
        isSwipeOpen.current = shouldOpen;
        Animated.spring(translateX, {
          toValue: shouldOpen ? -DELETE_AREA_WIDTH : 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      },
    })
  ).current;

  const handlePress = useCallback(() => {
    if (isSwipeOpen.current) {
      closeSwipe();
      return;
    }
    onPress(template);
  }, [template, onPress, closeSwipe]);

  const handleDelete = useCallback(() => {
    closeSwipe();
    showAlert(
      'Delete Template?',
      `Delete "${template.name}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(template.id) },
      ],
    );
  }, [closeSwipe, showAlert, template.name, template.id, onDelete]);

  return (
    <View style={styles.customSwipeContainer}>
      <View style={styles.customDeleteArea}>
        <TouchableOpacity style={styles.customDeleteButton} onPress={handleDelete} activeOpacity={0.7}>
          <X size={18} color="#EF4444" strokeWidth={2} />
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={styles.cardOuter}
          onPress={handlePress}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              <View style={styles.cardTopRow}>
                <View style={styles.cardTitleBlock}>
                  <Text style={styles.cardName}>{template.name}</Text>
                  {template.description ? (
                    <Text style={styles.focusTag} numberOfLines={1}>{template.description.toUpperCase()}</Text>
                  ) : null}
                </View>
                <View style={styles.cardTopRight}>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{template.exercises.length}</Text>
                    <Text style={styles.countBadgeLabel}>EX</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.accent} strokeWidth={1.5} />
                </View>
              </View>
              <View style={styles.chipsRow}>
                {template.exercises.map((ex) => (
                  <ExerciseChip key={ex.id} name={ex.name} />
                ))}
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

/* ── Main Screen ────────────────────────── */

export const WorkoutTemplatesScreen: React.FC = () => {
  const navigation = useNavigation<WorkoutTemplatesNavigationProp>();
  const insets = useSafeAreaInsets();
  const { prefs } = useWorkoutPreferences();
  const { templates: customTemplates, isLoading: templatesLoading, deleteTemplate } = useCustomTemplates();
  const { showAlert } = useAlert();
  const [showAll, setShowAll] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const recommendedIds = RECOMMENDED_BY_FREQUENCY[prefs.weeklyTrainingTarget] ?? RECOMMENDED_BY_FREQUENCY['3-4'];

  const recommended = useMemo(
    () => WORKOUT_TEMPLATES.filter((t) => recommendedIds.includes(t.id)),
    [recommendedIds],
  );
  const remaining = useMemo(
    () => WORKOUT_TEMPLATES.filter((t) => !recommendedIds.includes(t.id)),
    [recommendedIds],
  );

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
    navigation.navigate('TemplatePreview', {
      templateName: template.name,
      description: template.description,
      exercises: template.exercises.map(ex => ({ name: ex.name, category: ex.category, targetSets: 3 })),
    });
  }, [navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleToggleShowAll = useCallback(() => {
    setShowAll((prev) => !prev);
  }, []);

  const handleSelectCustomTemplate = useCallback((template: CustomTemplate) => {
    navigation.navigate('TemplatePreview', {
      templateName: template.name,
      description: template.description,
      exercises: template.exercises.map(ex => ({
        name: ex.name,
        category: ex.category,
        targetSets: ex.targetSets,
      })),
    });
  }, [navigation]);

  const handleDeleteCustomTemplate = useCallback(async (id: string) => {
    await deleteTemplate(id);
  }, [deleteTemplate]);

  const handleCreateTemplate = useCallback(() => {
    navigation.navigate('CreateTemplate');
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
            <Text style={styles.headerSubtitle}>{WORKOUT_TEMPLATES.length + customTemplates.length} routines</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── My Templates Section ──────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Layers size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>MY TEMPLATES</Text>
            </View>
            <TouchableOpacity
              style={styles.seeAllBtn}
              activeOpacity={0.7}
              onPress={handleCreateTemplate}
            >
              <Plus size={11} color={COLORS.accent} strokeWidth={2} />
              <Text style={styles.seeAllText}>Create</Text>
            </TouchableOpacity>
          </View>

          {customTemplates.length === 0 ? (
            <TouchableOpacity style={styles.emptyCustomCard} onPress={handleCreateTemplate} activeOpacity={0.7}>
              <Text style={styles.emptyCustomText}>Create your first custom template</Text>
              <Text style={styles.emptyCustomLink}>Create</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.templateList}>
              {customTemplates.map((template) => (
                <CustomTemplateCard
                  key={template.id}
                  template={template}
                  onPress={handleSelectCustomTemplate}
                  onDelete={handleDeleteCustomTemplate}
                />
              ))}
            </View>
          )}

          {/* ── Recommended Section ─────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Sparkles size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>RECOMMENDED</Text>
            </View>
            <View style={styles.templateCountPill}>
              <Zap size={10} color={COLORS.accent} strokeWidth={2} />
              <Text style={styles.templateCountText}>{recommended.length}</Text>
            </View>
          </View>

          <View style={styles.templateList}>
            {recommended.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onPress={handleSelectTemplate}
              />
            ))}
          </View>

          {/* ── All Routines Section ────────────── */}
          {remaining.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>ALL ROUTINES</Text>
                </View>
                <TouchableOpacity
                  style={styles.seeAllBtn}
                  activeOpacity={0.7}
                  onPress={handleToggleShowAll}
                >
                  <Text style={styles.seeAllText}>{showAll ? 'Hide' : 'See All'}</Text>
                  <ChevronRight
                    size={11}
                    color={COLORS.accent}
                    strokeWidth={2}
                    style={showAll ? { transform: [{ rotate: '90deg' }] } : undefined}
                  />
                </TouchableOpacity>
              </View>

              {showAll && (
                <View style={styles.templateList}>
                  {remaining.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onPress={handleSelectTemplate}
                    />
                  ))}
                </View>
              )}
            </>
          )}

        </Animated.View>
      </ScrollView>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    paddingTop: 4,
    paddingBottom: 160,
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
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.accent,
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
        shadowColor: '#7C5CFF',
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

  /* ── Custom Template Swipe-to-Delete ────── */
  customSwipeContainer: {
    overflow: 'hidden',
    borderRadius: 18,
  },
  customDeleteArea: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 12,
  },
  customDeleteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Empty Custom Templates ────────────── */
  emptyCustomCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderStyle: 'dashed',
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyCustomText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  emptyCustomLink: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.accent,
  },
});
