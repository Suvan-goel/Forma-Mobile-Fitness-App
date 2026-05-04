/**
 * TutorialsScreen — Browse exercise guides (read-only mode of the exercise library).
 * Accessed from UserProfileScreen. Tapping a card opens the ExerciseGuide.
 * No Info (?) button on cards — the card tap itself opens the guide.
 */

import React, { useState, useMemo, useCallback, memo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  ImageSourcePropType,
  TextInput,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bookmark, Search, X } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_VERTICAL_GAP,
  CARD_SHADOW
} from '../constants/theme';
import { useExercises } from '../../backend/hooks/useExercises';
import { useFavouriteExercises } from '../../backend/hooks/useFavouriteExercises';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { Exercise } from '../../backend/services/api';
import { EXERCISE_SETUP_DATA } from '../constants/exerciseGuideData';
import { ExerciseRegistry } from '../../utils/exercises';
import '../../utils/exercises/definitions/register';
import type { RootStackParamList } from '../app/RootNavigator';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type TutorialsNavigationProp = NativeStackNavigationProp<RootStackParamList>;

/* ── Category Images ─────────────────────────────── */

const CATEGORY_IMAGES: Record<string, ImageSourcePropType> = {
  'Weightlifting': require('../assets/weightlifting_bg.png'),
  'Calisthenics': require('../assets/calisthenics_bg.png'),
  'Mobility & Flexibility': require('../assets/mobility&flexibility_bg.png'),
};
const DEFAULT_EXERCISE_IMAGE = require('../assets/sports_bg.png');

const EXERCISE_IMAGE_MAP: Record<string, ImageSourcePropType> = {
  'Push-Up': require('../assets/exercises/push_up.png'),
  'Cable Pushdowns': require('../assets/exercises/cable_pushdowns.png'),
  'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
  'Machine Ab Crunches': require('../assets/exercises/machine_ab_crunches.png'),
  'Barbell Squat': require('../assets/exercises/barbell_squat.png'),
  'Leg Extensions': require('../assets/exercises/leg_extensions.png'),
  'Lying Leg Curl': require('../assets/exercises/lying_leg_curl.png'),
  'Cable Lat Pulldowns': require('../assets/exercises/cable_lat_pulldowns.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises.png'),
  'Cable Row': require('../assets/exercises/cable_row.png'),
};

function getExerciseImage(exercise: Exercise): ImageSourcePropType {
  return EXERCISE_IMAGE_MAP[exercise.name] ?? CATEGORY_IMAGES[exercise.category] ?? DEFAULT_EXERCISE_IMAGE;
}

/* ── Filter Pills ────────────────────────────────── */

const FILTER_ORDER = ['all', 'favourites', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core'];
const FILTER_LABELS: Record<string, string> = {
  favourites: 'FAVOURITES',
  all: 'ALL',
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  legs: 'LEGS',
  core: 'CORE',
};

const FilterTab = memo(({ id, isActive, onPress }: {
  id: string;
  isActive: boolean;
  onPress: (id: string) => void;
}) => (
  <TouchableOpacity
    style={styles.filterTab}
    onPress={() => onPress(id)}
    activeOpacity={0.7}
  >
    <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
      {FILTER_LABELS[id] || id.toUpperCase()}
    </Text>
    {isActive && <View style={styles.filterUnderline} />}
  </TouchableOpacity>
));

/* ── Exercise Card (Tutorials variant — no Info button) ─── */

const TutorialCard = memo(({ exercise, muscleLabel, cardWidth, cardHeight, onPress, isFavourited, onToggleFavourite }: {
  exercise: Exercise;
  muscleLabel: string;
  cardWidth: number;
  cardHeight: number;
  onPress: (exercise: Exercise) => void;
  isFavourited: boolean;
  onToggleFavourite: (name: string) => void;
}) => (
  <TouchableOpacity
    style={[styles.cardOuter, { width: cardWidth, height: cardHeight }]}
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
        {/* Header — bookmark only (Info icon removed for Tutorials mode) */}
        <View style={styles.cardHeader}>
          <TouchableOpacity
            style={styles.cardIconBtn}
            activeOpacity={0.6}
            onPress={() => onToggleFavourite(exercise.name)}
          >
            <Bookmark
              size={16}
              color={isFavourited ? '#7A55FF' : COLORS.textTertiary}
              fill={isFavourited ? '#7A55FF' : 'transparent'}
              strokeWidth={1.5}
            />
          </TouchableOpacity>
        </View>

        {/* Exercise image */}
        <View style={styles.imageWrap}>
          <Image
            source={getExerciseImage(exercise)}
            style={styles.exerciseImage}
            resizeMode="contain"
          />
        </View>

        {/* Text */}
        <View style={styles.cardTextBlock}>
          <Text style={styles.cardName} numberOfLines={2}>{exercise.name}</Text>
          <Text style={styles.cardMuscle} numberOfLines={1}>{muscleLabel}</Text>
        </View>

        <View style={styles.cardSpacer} />
      </View>
    </LinearGradient>
  </TouchableOpacity>
));

/* ── Main Screen ─────────────────────────────────── */

export const TutorialsScreen: React.FC = () => {
  const navigation = useNavigation<TutorialsNavigationProp>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const { exercises: allExercises, muscleGroups, isLoading, filterByMuscleGroup } = useExercises();
  const { isFavourite, toggleFavourite } = useFavouriteExercises();

  const cardWidth = (screenWidth - SPACING.screenHorizontal * 2 - 12) / 2;
  const imageSize = cardWidth - 16;
  const textBlockHeight = 60;
  const bottomPadding = 24;
  const cardHeight = 32 + imageSize + 8 + textBlockHeight + bottomPadding;

  /* Tap card → navigate to ExerciseGuide (same logic as handleInfoPress in ChooseExerciseScreen) */
  const handleSelectExercise = useCallback((exercise: Exercise) => {
    const def = ExerciseRegistry.has(exercise.name) ? ExerciseRegistry.get(exercise.name) : null;
    const viewMap = { front: 'FRONT', side: 'SIDE', any: 'ANY' } as const;
    const viewType = def ? viewMap[def.requiredView] : 'SIDE';
    const setup = EXERCISE_SETUP_DATA[exercise.name] ?? {
      keySetup: 'Position camera to capture full body',
      reasonText: 'Ensures all key joints are visible for tracking.',
      cameraTips: [
        'Place the phone far enough away to keep your whole body in frame.',
        'Set the camera around hip to chest height depending on the movement.',
        'Avoid bright lights or windows directly behind you so your outline stays clear.',
      ],
    };
    navigation.navigate('ExerciseGuide', {
      exerciseName: exercise.name,
      category: exercise.category,
      viewType,
      keySetup: setup.keySetup,
      reasonText: setup.reasonText,
      cameraTips: setup.cameraTips,
    });
  }, [navigation]);

  const handleGoBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleFilterPress = useCallback((id: string) => setSelectedMuscleGroup(id), []);

  const handleToggleSearch = useCallback(() => {
    setShowSearch(prev => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  }, []);

  const filteredExercises = useMemo(() => {
    let result: Exercise[];
    if (selectedMuscleGroup === 'favourites') {
      result = allExercises.filter(ex => isFavourite(ex.name));
    } else {
      result = filterByMuscleGroup(selectedMuscleGroup);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        ex => ex.name.toLowerCase().includes(q) || ex.muscleGroup.toLowerCase().includes(q),
      );
    }
    return result;
  }, [selectedMuscleGroup, filterByMuscleGroup, allExercises, isFavourite, searchQuery]);

  const muscleNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    muscleGroups.forEach(m => { map[m.id] = m.name.toUpperCase(); });
    return map;
  }, [muscleGroups]);

  const renderCard = useCallback(({ item }: { item: Exercise }) => (
    <TutorialCard
      exercise={item}
      muscleLabel={muscleNameMap[item.muscleGroup] || item.muscleGroup.toUpperCase()}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      onPress={handleSelectExercise}
      isFavourited={isFavourite(item.name)}
      onToggleFavourite={toggleFavourite}
    />
  ), [cardWidth, cardHeight, handleSelectExercise, muscleNameMap, isFavourite, toggleFavourite]);

  const keyExtractor = useCallback((item: Exercise, index: number) => `${item.name}-${index}`, []);

  if (isLoading) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <SettingsHeader
          title="TUTORIALS"
          onBack={handleGoBack}
          rightSlot={(
            <TouchableOpacity style={styles.headerIconBtn}>
              <Search size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
            </TouchableOpacity>
          )}
        />
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
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader
        title="TUTORIALS"
        onBack={handleGoBack}
        rightSlot={(
          <TouchableOpacity style={styles.headerIconBtn} onPress={handleToggleSearch}>
            {showSearch
              ? <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
              : <Search size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
            }
          </TouchableOpacity>
        )}
      />

      {/* ── Subtitle ────────────────────────────── */}
      {!showSearch && (
        <Text style={styles.headerSubtitle}>TAP AN EXERCISE FOR INSTRUCTIONS</Text>
      )}

      {/* ── Search Bar ──────────────────────────── */}
      {showSearch && (
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Search size={15} color={COLORS.textTertiary} strokeWidth={1.5} style={styles.searchIcon} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search exercises..."
              placeholderTextColor={COLORS.textTertiary}
              autoFocus
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.6} style={styles.searchClear}>
                <X size={14} color={COLORS.textTertiary} strokeWidth={2} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Filter Pills ────────────────────────── */}
      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
          bounces={false}
        >
          {FILTER_ORDER.map(id => (
            <FilterTab
              key={id}
              id={id}
              isActive={selectedMuscleGroup === id}
              onPress={handleFilterPress}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Exercise Grid ────────────────────────── */}
      <FlatList
        data={filteredExercises}
        renderItem={renderCard}
        keyExtractor={keyExtractor}
        numColumns={2}
        contentContainerStyle={[
          styles.gridContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 112) },
        ]}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {selectedMuscleGroup === 'favourites'
                ? 'No favourites yet.\nTap the bookmark on any exercise to save it here.'
                : 'No exercises found.'}
            </Text>
          </View>
        }
      />
    </ScreenBackground>
  );
};

/* ── Styles ──────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* Header */
  headerIconBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Subtitle */
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 4,
    textAlign: 'center',
  },

  /* Search */
  searchRow: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 8,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackgroundLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0,
  },
  searchClear: {
    paddingLeft: 8,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Filter Tabs */
  filterWrap: {
    height: 36,
    marginTop: 16,
    marginBottom: 12,
  },
  filterScroll: {},
  filterRow: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 20,
    alignItems: 'center',
  },
  filterTab: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  filterTabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  filterUnderline: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },

  /* Grid */
  gridContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  gridRow: {
    gap: 12,
    marginBottom: CARD_VERTICAL_GAP,
  },

  /* Card */
  cardOuter: {
    borderRadius: 19,
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    flex: 1,
    borderRadius: 19,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardGlassEdge: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderTopColor: 'rgba(255, 255, 255, 0.105)',
    padding: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 4,
  },
  cardIconBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.0)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },
  cardSpacer: {
    flex: 1,
    minHeight: 20,
  },
  cardTextBlock: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 14,
  },
  cardName: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
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

  /* Empty */
  emptyWrap: {
    flex: 1,
    paddingTop: 60,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 22,
  },

  /* Loading */
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
