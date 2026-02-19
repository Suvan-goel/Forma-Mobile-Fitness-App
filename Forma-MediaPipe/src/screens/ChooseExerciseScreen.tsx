import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  ImageSourcePropType,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bookmark, Info, Search } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useExercises } from '../hooks';
import { LoadingSkeleton } from '../components/ui';
import { Exercise } from '../services/api';

const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  'Weightlifting': require('../assets/weightlifting_bg.png'),
  'Calisthenics': require('../assets/calisthenics_bg.png'),
  'Mobility & Flexibility': require('../assets/mobility&flexibility_bg.png'),
};
const DEFAULT_EXERCISE_IMAGE = require('../assets/sports_bg.png');

function getExerciseImage(exercise: Exercise): ImageSourcePropType {
  return CATEGORY_IMAGES[exercise.category] ?? DEFAULT_EXERCISE_IMAGE;
}

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

/** Strict filter order */
const FILTER_ORDER = ['all', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core'];
const FILTER_LABELS: Record<string, string> = {
  all: 'ALL',
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  legs: 'LEGS',
  core: 'CORE',
};

/* ── Filter Pill ─────────────────────────── */

const FilterPill = memo(({ id, isActive, onPress }: {
  id: string;
  isActive: boolean;
  onPress: (id: string) => void;
}) => (
  <TouchableOpacity
    style={[styles.filterPill, isActive && styles.filterPillActive]}
    onPress={() => onPress(id)}
    activeOpacity={0.7}
  >
    <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
      {FILTER_LABELS[id] || id.toUpperCase()}
    </Text>
  </TouchableOpacity>
));

/* ── Exercise Card ───────────────────────── */

const ExerciseCard = memo(({ exercise, muscleLabel, cardWidth, onPress }: {
  exercise: Exercise;
  muscleLabel: string;
  cardWidth: number;
  onPress: (exercise: Exercise) => void;
}) => (
  <TouchableOpacity
    style={[styles.cardOuter, { width: cardWidth }]}
    onPress={() => onPress(exercise)}
    activeOpacity={0.82}
  >
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.cardGradient}
    >
      <View style={styles.cardGlassEdge}>
        {/* Top icons */}
        <View style={styles.cardHeader}>
          <TouchableOpacity style={styles.cardIconBtn} activeOpacity={0.6}>
            <Bookmark size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.cardIconBtn} activeOpacity={0.6}>
            <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>

        {/* Image */}
        <View style={styles.imageWrap}>
          <Image
            source={getExerciseImage(exercise)}
            style={styles.exerciseImage}
            resizeMode="cover"
          />
        </View>

        {/* Text - flex so it fills remaining space below image */}
        <View style={styles.cardTextBlock}>
          <Text style={styles.cardName} numberOfLines={2}>{exercise.name}</Text>
          <Text style={styles.cardMuscle} numberOfLines={1}>{muscleLabel}</Text>
        </View>
      </View>
    </LinearGradient>
  </TouchableOpacity>
));

/* ── Main Screen ──────────────────────────── */

export const ChooseExerciseScreen: React.FC = () => {
  const navigation = useNavigation<ChooseExerciseNavigationProp>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('all');
  const { addExercise } = useCurrentWorkout();

  const { exercises: allExercises, muscleGroups, isLoading, filterByMuscleGroup } = useExercises();

  const cardWidth = (screenWidth - SPACING.screenHorizontal * 2 - 12) / 2;

  const handleSelectExercise = useCallback((exercise: Exercise) => {
    addExercise({ name: exercise.name, category: exercise.category });
    navigation.navigate('CurrentWorkout');
  }, [addExercise, navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleFilterPress = useCallback((id: string) => {
    setSelectedMuscleGroup(id);
  }, []);

  const filteredExercises = useMemo(
    () => filterByMuscleGroup(selectedMuscleGroup),
    [selectedMuscleGroup, filterByMuscleGroup]
  );

  const muscleNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    muscleGroups.forEach(m => { map[m.id] = m.name.toUpperCase(); });
    return map;
  }, [muscleGroups]);

  const renderExerciseCard = useCallback(({ item }: { item: Exercise }) => (
    <ExerciseCard
      exercise={item}
      muscleLabel={muscleNameMap[item.muscleGroup] || item.muscleGroup.toUpperCase()}
      cardWidth={cardWidth}
      onPress={handleSelectExercise}
    />
  ), [cardWidth, handleSelectExercise, muscleNameMap]);

  const keyExtractor = useCallback((item: Exercise, index: number) => `${item.name}-${index}`, []);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
            <ChevronLeft size={22} color="#FFFFFF" strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>EXERCISE LIBRARY</Text>
          <TouchableOpacity style={styles.headerIconBtn}>
            <Search size={20} color="#FFFFFF" strokeWidth={1.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingWrap}>
          <View style={styles.pillSkeletons}>
            {[1, 2, 3, 4, 5].map(i => (
              <LoadingSkeleton key={i} variant="text" height={32} style={{ width: 70, borderRadius: 16 }} />
            ))}
          </View>
          <View style={styles.cardSkeletons}>
            <LoadingSkeleton variant="card" height={200} width={cardWidth} />
            <LoadingSkeleton variant="card" height={200} width={cardWidth} />
            <LoadingSkeleton variant="card" height={200} width={cardWidth} />
            <LoadingSkeleton variant="card" height={200} width={cardWidth} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ─────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>EXERCISE LIBRARY</Text>
        <TouchableOpacity style={styles.headerIconBtn}>
          <Search size={20} color="#FFFFFF" strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      {/* ── Filter Pills ───────────────────────── */}
      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
          bounces={false}
        >
          {FILTER_ORDER.map(id => (
            <FilterPill
              key={id}
              id={id}
              isActive={selectedMuscleGroup === id}
              onPress={handleFilterPress}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Exercise Grid ──────────────────────── */}
      <FlatList
        data={filteredExercises}
        renderItem={renderExerciseCard}
        keyExtractor={keyExtractor}
        numColumns={2}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
      />
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 10,
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
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Filter Pills ──────────────────────────── */
  filterWrap: {
    height: 60,
    marginTop: 20,
    marginBottom: 16,
    overflow: 'visible',
  },
  filterScroll: {
    flex: 1,
    overflow: 'visible',
  },
  filterRow: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  filterPill: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  filterPillText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 2,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },

  /* ── Grid ───────────────────────────────── */
  gridContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 150,
  },
  gridRow: {
    gap: 12,
    marginBottom: 12,
  },

  /* ── Card (analytics style) ───────────────────────────────── */
  cardOuter: {
    height: 250,
    borderRadius: 22,
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
    flex: 1,
    borderRadius: 22,
  },
  cardGlassEdge: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardIconBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Image ──────────────────────────────── */
  imageWrap: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },

  /* ── Text Block ─────────────────────────── */
  cardTextBlock: {
    flex: 1,
    paddingHorizontal: 4,
    paddingBottom: 6,
    justifyContent: 'flex-end',
  },
  cardName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  cardMuscle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  /* ── Loading ─────────────────────────────── */
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  pillSkeletons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  cardSkeletons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});
