import React, { useState, useMemo } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bookmark, HelpCircle, Search } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useExercises } from '../hooks';
import { LoadingSkeleton } from '../components/ui';
import { Exercise, MuscleGroup } from '../services/api';

// Category-based images so each card shows an image matching its exercise type
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

export const ChooseExerciseScreen: React.FC = () => {
  const navigation = useNavigation<ChooseExerciseNavigationProp>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('all');
  const { addExercise } = useCurrentWorkout();

  // Fetch exercises from API service
  const { exercises: allExercises, muscleGroups, isLoading, filterByMuscleGroup } = useExercises();

  // Fixed card width so the last card in an odd row doesn't stretch full width
  const cardWidth = (screenWidth - SPACING.md * 2 - SPACING.md) / 2;

  const handleSelectExercise = (exercise: Exercise) => {
    addExercise({ name: exercise.name, category: exercise.category });
    navigation.navigate('CurrentWorkout');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  // Filter exercises by selected muscle group
  const filteredExercises = useMemo(
    () => filterByMuscleGroup(selectedMuscleGroup),
    [selectedMuscleGroup, filterByMuscleGroup]
  );

  const renderExerciseCard = ({ item }: { item: Exercise }) => (
    <TouchableOpacity
      style={[styles.exerciseCard, { width: cardWidth }]}
      onPress={() => handleSelectExercise(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.cardIconButton}>
          <Bookmark size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.cardIconButton}>
          <HelpCircle size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
      
      <View style={styles.exerciseImageContainer}>
        <Image
          source={getExerciseImage(item)}
          style={styles.exerciseImage}
          resizeMode="cover"
        />
      </View>
      
      <View style={styles.exerciseCardTextBlock}>
        <Text style={styles.exerciseCardName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.exerciseCardMuscle} numberOfLines={1}>
          {muscleGroups.find(m => m.id === item.muscleGroup)?.name || item.muscleGroup}
        </Text>
      </View>
    </TouchableOpacity>
  );

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
            <ChevronLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add exercises</Text>
          <TouchableOpacity style={styles.headerIconButton}>
            <Search size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <View style={styles.muscleGroupSkeletons}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <LoadingSkeleton key={i} variant="circle" height={50} />
            ))}
          </View>
          <View style={styles.cardSkeletons}>
            <LoadingSkeleton variant="card" height={180} width={cardWidth} />
            <LoadingSkeleton variant="card" height={180} width={cardWidth} />
            <LoadingSkeleton variant="card" height={180} width={cardWidth} />
            <LoadingSkeleton variant="card" height={180} width={cardWidth} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add exercises</Text>
        <TouchableOpacity style={styles.headerIconButton}>
          <Search size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Muscle Group Sliding Tab */}
      <View style={styles.muscleGroupTabWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.muscleGroupTab}
          style={styles.muscleGroupTabContainer}
        >
          {muscleGroups.map((group) => (
            <TouchableOpacity
              key={group.id}
              style={[
                styles.muscleGroupTabItem,
                selectedMuscleGroup === group.id && styles.muscleGroupTabItemActive,
              ]}
              onPress={() => setSelectedMuscleGroup(group.id)}
            >
              <Text style={styles.muscleGroupTabIcon}>{group.icon}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Exercises Subheading */}
      <View style={styles.subheadingContainer}>
        <Text style={styles.subheading}>
          {selectedMuscleGroup === 'all'
            ? 'All exercises'
            : muscleGroups.find(m => m.id === selectedMuscleGroup)?.name ?? 'Exercises'}
        </Text>
        <TouchableOpacity>
          <Bookmark size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Exercise Cards Grid */}
      <FlatList
        data={filteredExercises}
        renderItem={renderExerciseCard}
        keyExtractor={(item, index) => `${item.name}-${index}`}
        numColumns={2}
        contentContainerStyle={[
          styles.cardsContainer,
          { paddingBottom: Math.max(insets.bottom, SPACING.xl) },
        ]}
        columnWrapperStyle={styles.cardRow}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    padding: SPACING.screenHorizontal,
  },
  muscleGroupSkeletons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  cardSkeletons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
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
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muscleGroupTabWrapper: {
    height: 70,
    width: '100%',
  },
  muscleGroupTabContainer: {
    height: 70,
  },
  muscleGroupTab: {
    paddingHorizontal: SPACING.screenHorizontal,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muscleGroupTabItem: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
    overflow: 'hidden',
  },
  muscleGroupTabItemActive: {
    backgroundColor: COLORS.primary,
    opacity: 0.8,
  },
  muscleGroupTabIcon: {
    fontSize: 24,
  },
  subheadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
  },
  subheading: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  cardsContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
  },
  cardRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  exerciseCard: {
    ...CARD_STYLE,
    padding: SPACING.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  cardIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseImageContainer: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },
  exerciseCardTextBlock: {
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  exerciseCardName: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: 3,
  },
  exerciseCardMuscle: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
});
