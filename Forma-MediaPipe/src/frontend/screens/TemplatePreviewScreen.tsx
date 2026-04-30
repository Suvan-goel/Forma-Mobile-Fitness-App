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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Dumbbell, Layers, Play } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import type { RecordStackParamList } from '../app/RootNavigator';

type TemplatePreviewNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'TemplatePreview'>;
type TemplatePreviewRouteProp = RouteProp<RecordStackParamList, 'TemplatePreview'>;

/* ── Exercise Row ────────────────────────── */

const ExerciseRow: React.FC<{
  name: string;
  index: number;
  targetSets: number;
  isLast: boolean;
}> = ({ name, index, targetSets, isLast }) => (
  <View style={[styles.exerciseRow, isLast && styles.exerciseRowLast]}>
    <View style={styles.exerciseIndexBadge}>
      <Text style={styles.exerciseIndexText}>{index + 1}</Text>
    </View>
    <Text style={styles.exerciseRowName} numberOfLines={1}>{name}</Text>
    <View style={styles.exerciseSetsBadge}>
      <Text style={styles.exerciseSetsText}>{targetSets} sets</Text>
    </View>
  </View>
);

/* ── Main Screen ─────────────────────────── */

export const TemplatePreviewScreen: React.FC = () => {
  const navigation = useNavigation<TemplatePreviewNavigationProp>();
  const route = useRoute<TemplatePreviewRouteProp>();
  const insets = useSafeAreaInsets();
  const { addExercise, clearSets } = useCurrentWorkout();

  const { templateName, description, exercises } = route.params;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleStartWorkout = useCallback(() => {
    clearSets();
    exercises.forEach(ex => {
      addExercise({ name: ex.name, category: ex.category });
    });
    navigation.navigate('CurrentWorkout');
  }, [clearSets, addExercise, exercises, navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* ── Header ────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack} activeOpacity={0.7}>
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{templateName}</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── Summary Card ──────────── */}
          <LinearGradient
            colors={SCREEN_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.summaryCard}
          >
            <View style={styles.summaryEdge}>
              <View style={styles.summaryTitleRow}>
                <Layers size={12} color={COLORS.accent} strokeWidth={1.5} />
                <Text style={styles.summaryTitle}>TEMPLATE OVERVIEW</Text>
              </View>

              {description ? (
                <Text style={styles.descriptionText}>{description}</Text>
              ) : null}

              {/* Inline stats */}
              <View style={styles.summaryStatsRow}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{exercises.length}</Text>
                  <Text style={styles.summaryStatLabel}>exercises</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>
                    {exercises.reduce((sum, ex) => sum + ex.targetSets, 0)}
                  </Text>
                  <Text style={styles.summaryStatLabel}>total sets</Text>
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* ── Exercises Section ─────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>EXERCISES</Text>
            </View>
            <Text style={styles.exerciseCount}>{exercises.length}</Text>
          </View>

          <View style={styles.exerciseCardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.exerciseCardGradient}
            >
              <View style={styles.exerciseCardEdge}>
                {exercises.map((ex, i) => (
                  <ExerciseRow
                    key={`${ex.name}-${i}`}
                    name={ex.name}
                    index={i}
                    targetSets={ex.targetSets}
                    isLast={i === exercises.length - 1}
                  />
                ))}
              </View>
            </LinearGradient>
          </View>

        </Animated.View>
      </ScrollView>

      {/* ── Bottom CTA ────────────────── */}
      <View style={[styles.bottomPanel, { paddingBottom: Math.max(insets.bottom, SPACING.md) + 4 }]}>
        <TouchableOpacity onPress={handleStartWorkout} activeOpacity={0.85}>
          <LinearGradient
            colors={['#7C5CFF', '#6746E8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startButton}
          >
            <Play size={18} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
            <Text style={styles.startButtonText}>Start Workout</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* ── Header ──────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginHorizontal: SPACING.sm,
  },
  headerPlaceholder: {
    width: 40,
  },

  /* ── Scroll ──────────────────── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* ── Summary Card ────────────── */
  summaryCard: {
    borderRadius: 16,
    marginTop: 14,
    marginBottom: 4,

    ...CARD_SHADOW,
},
  summaryEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  descriptionText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  summaryStatValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  summaryStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* ── Section Header ──────────── */
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
  exerciseCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* ── Exercise Card ───────────── */
  exerciseCardOuter: {
    borderRadius: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#7C5CFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  exerciseCardGradient: {
    borderRadius: 18,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  exerciseCardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    padding: 4,
  },

  /* ── Exercise Row ────────────── */
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    gap: 12,
  },
  exerciseRowLast: {
    borderBottomWidth: 0,
  },
  exerciseIndexBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseIndexText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  exerciseRowName: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  exerciseSetsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  exerciseSetsText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },

  /* ── Bottom Panel ────────────── */
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 10,
  },
  startButtonText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
