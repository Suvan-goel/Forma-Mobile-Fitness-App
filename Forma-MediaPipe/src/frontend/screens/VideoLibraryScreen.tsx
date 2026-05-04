import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bookmark,
  Filter,
  Play,
} from 'lucide-react-native';
import {
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_VERTICAL_GAP,
  COLORS,
  FONTS,
  SPACING,
  getScoreColor,
} from '../constants/theme';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { MonoText } from '../components/typography/MonoText';
import { useAlert } from '../contexts/AlertContext';
import { useVideoLibrary } from '../../backend/hooks/useVideoLibrary';
import { useWorkouts } from '../../backend/hooks/useWorkouts';
import type { VideoRecord } from '../../backend/services/videoLibrary';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

let VideoComponent: any = null;
try {
  VideoComponent = require('expo-av').Video;
} catch {
  // expo-av Video not available
}

type FilterMode = 'all' | 'exercise' | 'workout' | 'date';
type DateRange = 'all' | 'today' | 'week' | 'month';

interface WorkoutGroup {
  id: string;
  name: string;
  date: string;
  exercises: string[];
  setCount: number;
}

const FILTER_TABS: { key: FilterMode; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'exercise', label: 'Exercise' },
  { key: 'workout', label: 'Workout' },
  { key: 'date', label: 'Date' },
];

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

const MOBILITY_TERMS = ['mobility', 'stretch', 'yoga', 'warmup', 'warm-up', 'activation'];
const RECOVERY_TERMS = ['recovery', 'cooldown', 'cool-down', 'rest', 'breathing'];

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const getCategory = (record: VideoRecord): 'Strength' | 'Mobility' | 'Recovery' => {
  const name = record.exerciseName.toLowerCase();
  if (MOBILITY_TERMS.some(term => name.includes(term))) return 'Mobility';
  if (RECOVERY_TERMS.some(term => name.includes(term))) return 'Recovery';
  return 'Strength';
};

const getDifficulty = (score: number) => {
  if (score >= 85) return 'Advanced';
  if (score >= 70) return 'Intermediate';
  return 'Beginner';
};

const getSubtitle = (record: VideoRecord) => {
  return `Set ${record.setNumber} · ${record.reps} reps`;
};

const VideoRow = memo(({
  item,
  workoutName,
  onPlay,
  onDelete,
}: {
  item: VideoRecord;
  workoutName: string;
  onPlay: (item: VideoRecord) => void;
  onDelete: (item: VideoRecord) => void;
}) => {
  const category = getCategory(item);
  const difficulty = getDifficulty(item.formScore);
  const scoreColor = getScoreColor(item.formScore);

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={() => onPlay(item)}
      onLongPress={() => onDelete(item)}
      style={styles.videoRow}
    >
      <View style={styles.thumbWrap}>
        {item.thumbnailPath ? (
          <Image source={{ uri: item.thumbnailPath }} style={styles.thumbnail} />
        ) : (
          <LinearGradient
            colors={['rgba(255,255,255,0.075)', 'rgba(255,255,255,0.025)']}
            style={[styles.thumbnail, styles.thumbnailPlaceholder]}
          >
            <Play size={20} color="rgba(255,255,255,0.76)" fill="rgba(255,255,255,0.76)" />
          </LinearGradient>
        )}
        <View style={styles.durationBadge}>
          <MonoText style={styles.durationText}>{formatDuration(item.durationSeconds)}</MonoText>
        </View>
      </View>

      <View style={styles.videoCopy}>
        <Text style={styles.videoTitle} numberOfLines={1}>{item.exerciseName}</Text>
        <Text style={styles.videoMetaLine} numberOfLines={1}>
          {formatDate(item.date)} · {workoutName}
        </Text>
        <Text style={styles.videoSubtitle} numberOfLines={1}>{getSubtitle(item)}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>{category}</Text>
          </View>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>{difficulty}</Text>
          </View>
          <View style={[styles.metaPill, styles.scorePill]}>
            <Text style={[styles.metaText, { color: scoreColor }]}>Form {item.formScore}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={() => onDelete(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.bookmarkButton}
      >
        <Bookmark size={20} color={COLORS.textSecondary} strokeWidth={1.7} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

export const VideoLibraryScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { showAlert } = useAlert();
  const {
    recordings,
    isLoading,
    refreshing,
    storageInfo,
    deleteRecording,
    refreshRecordings,
    pullToRefresh,
  } = useVideoLibrary();
  const { workouts } = useWorkouts();

  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<DateRange>('all');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useFocusEffect(
    useCallback(() => {
      refreshRecordings();
    }, [refreshRecordings]),
  );

  useEffect(() => {
    if (!isLoading) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [fadeAnim, isLoading, slideAnim]);

  const uniqueExercises = useMemo(() => {
    const names = new Set(recordings.map(record => record.exerciseName));
    return Array.from(names).sort();
  }, [recordings]);

  const workoutNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const workout of workouts) map.set(workout.id, workout.name);
    return map;
  }, [workouts]);

  const uniqueWorkouts = useMemo(() => {
    const workoutMap = new Map<string, { id: string; date: string; exercises: Set<string>; setCount: number }>();
    let unlinkedCount = 0;

    for (const record of recordings) {
      if (!record.workoutId) {
        unlinkedCount++;
        continue;
      }

      const existing = workoutMap.get(record.workoutId);
      if (existing) {
        existing.exercises.add(record.exerciseName);
        existing.setCount++;
        if (record.date < existing.date) existing.date = record.date;
      } else {
        workoutMap.set(record.workoutId, {
          id: record.workoutId,
          date: record.date,
          exercises: new Set([record.exerciseName]),
          setCount: 1,
        });
      }
    }

    const linked: WorkoutGroup[] = Array.from(workoutMap.values())
      .map(workout => ({
        ...workout,
        name: workoutNameMap.get(workout.id) || '',
        exercises: Array.from(workout.exercises),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return { linked, hasUnlinked: unlinkedCount > 0 };
  }, [recordings, workoutNameMap]);

  const filteredRecordings = useMemo(() => {
    let result = recordings;

    if (filterMode === 'exercise' && selectedExercise) {
      result = result.filter(record => record.exerciseName === selectedExercise);
    } else if (filterMode === 'workout' && selectedWorkoutId) {
      result = selectedWorkoutId === '__unlinked__'
        ? result.filter(record => !record.workoutId)
        : result.filter(record => record.workoutId === selectedWorkoutId);
    } else if (filterMode === 'date' && selectedDateRange !== 'all') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (selectedDateRange === 'today') {
        result = result.filter(record => new Date(record.date) >= startOfDay);
      } else if (selectedDateRange === 'week') {
        const weekAgo = new Date(startOfDay);
        weekAgo.setDate(weekAgo.getDate() - 7);
        result = result.filter(record => new Date(record.date) >= weekAgo);
      } else if (selectedDateRange === 'month') {
        const monthAgo = new Date(startOfDay);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        result = result.filter(record => new Date(record.date) >= monthAgo);
      }
    }

    return result;
  }, [filterMode, recordings, selectedDateRange, selectedExercise, selectedWorkoutId]);

  const handleFilterModeChange = useCallback((mode: FilterMode) => {
    setFilterMode(mode);
    setSelectedExercise(null);
    setSelectedWorkoutId(null);
    setSelectedDateRange('all');
  }, []);

  const handleDelete = useCallback((record: VideoRecord) => {
    showAlert(
      'Delete Recording',
      `Delete this ${record.exerciseName} recording?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteRecording(record.id),
        },
      ],
    );
  }, [deleteRecording, showAlert]);

  const handlePlay = useCallback((record: VideoRecord) => {
    setPlayingVideo(record);
  }, []);

  const getWorkoutNameForRecording = useCallback((record: VideoRecord) => {
    if (!record.workoutId) return 'Unlinked workout';
    return workoutNameMap.get(record.workoutId) || 'Saved workout';
  }, [workoutNameMap]);

  const renderItem = useCallback(({ item }: { item: VideoRecord }) => (
    <VideoRow
      item={item}
      workoutName={getWorkoutNameForRecording(item)}
      onPlay={handlePlay}
      onDelete={handleDelete}
    />
  ), [getWorkoutNameForRecording, handleDelete, handlePlay]);

  const header = (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTER_TABS.map(tab => {
          const isActive = filterMode === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => handleFilterModeChange(tab.key)}
              activeOpacity={0.78}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {filterMode === 'exercise' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.subFilterScroll}
          contentContainerStyle={styles.subFilterRow}
        >
          {uniqueExercises.map(name => (
            <TouchableOpacity
              key={name}
              style={[styles.subFilterPill, selectedExercise === name && styles.subFilterPillActive]}
              onPress={() => setSelectedExercise(prev => prev === name ? null : name)}
              activeOpacity={0.76}
            >
              <Text style={[styles.subFilterText, selectedExercise === name && styles.subFilterTextActive]} numberOfLines={1}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {filterMode === 'workout' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.subFilterScroll}
          contentContainerStyle={styles.subFilterRow}
        >
          {uniqueWorkouts.linked.map(workout => (
            <TouchableOpacity
              key={workout.id}
              style={[styles.subFilterPill, selectedWorkoutId === workout.id && styles.subFilterPillActive]}
              onPress={() => setSelectedWorkoutId(prev => prev === workout.id ? null : workout.id)}
              activeOpacity={0.76}
            >
              <Text style={[styles.subFilterText, selectedWorkoutId === workout.id && styles.subFilterTextActive]} numberOfLines={1}>
                {workout.name || formatDate(workout.date)}
              </Text>
            </TouchableOpacity>
          ))}
          {uniqueWorkouts.hasUnlinked && (
            <TouchableOpacity
              style={[styles.subFilterPill, selectedWorkoutId === '__unlinked__' && styles.subFilterPillActive]}
              onPress={() => setSelectedWorkoutId(prev => prev === '__unlinked__' ? null : '__unlinked__')}
              activeOpacity={0.76}
            >
              <Text style={[styles.subFilterText, selectedWorkoutId === '__unlinked__' && styles.subFilterTextActive]}>
                Unlinked
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {filterMode === 'date' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.subFilterScroll}
          contentContainerStyle={styles.subFilterRow}
        >
          {DATE_RANGES.map(range => (
            <TouchableOpacity
              key={range.value}
              style={[styles.subFilterPill, selectedDateRange === range.value && styles.subFilterPillActive]}
              onPress={() => setSelectedDateRange(range.value)}
              activeOpacity={0.76}
            >
              <Text style={[styles.subFilterText, selectedDateRange === range.value && styles.subFilterTextActive]}>
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>All Videos</Text>
        <Text style={styles.sectionCount}>
          {filteredRecordings.length} {filteredRecordings.length === 1 ? 'video' : 'videos'}
        </Text>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <Header onBack={() => navigation.goBack()} storageLabel={`${storageInfo.totalSizeMB}MB`} />
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={34} style={{ marginBottom: 18 }} />
          <LoadingSkeleton variant="card" height={94} style={{ marginBottom: 8 }} />
          <LoadingSkeleton variant="card" height={94} style={{ marginBottom: 8 }} />
          <LoadingSkeleton variant="card" height={94} />
        </View>
      </ScreenBackground>
    );
  }

  if (recordings.length === 0) {
    return (
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <Header onBack={() => navigation.goBack()} storageLabel={`${storageInfo.totalSizeMB}MB`} />
        <View style={styles.emptyWrap}>
          <EmptyState
            title="No recordings yet"
            message="Tap the video icon in the camera screen to record your sets"
            icon={Play}
          />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <Header onBack={() => navigation.goBack()} storageLabel={`${storageInfo.totalSizeMB}MB`} />

      <Animated.View style={[styles.contentWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <FlatList
          data={filteredRecordings}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, 22) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullToRefresh}
              tintColor={COLORS.accent}
              colors={[COLORS.accent]}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.filteredEmpty}>
              <EmptyState
                title="No matching recordings"
                message="Try another filter"
                icon={Filter}
              />
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={9}
        />
      </Animated.View>

      {playingVideo && VideoComponent && (
        <Modal
          visible={!!playingVideo}
          animationType="fade"
          onRequestClose={() => setPlayingVideo(null)}
        >
          <View style={styles.playerContainer}>
            <VideoComponent
              source={{ uri: playingVideo.videoPath }}
              style={styles.player}
              useNativeControls
              shouldPlay
              resizeMode="contain"
              onPlaybackStatusUpdate={(status: any) => {
                if (status.didJustFinish) setPlayingVideo(null);
              }}
            />
            <TouchableOpacity
              style={[styles.playerClose, { top: insets.top + 10 }]}
              onPress={() => setPlayingVideo(null)}
            >
              <Text style={styles.playerCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </ScreenBackground>
  );
};

const Header = memo(({ onBack, storageLabel }: { onBack: () => void; storageLabel: string }) => (
  <SettingsHeader
    title="VIDEO LIBRARY"
    onBack={onBack}
    rightSlot={(
      <View style={styles.storageBadge}>
        <MonoText style={styles.storageText}>{storageLabel}</MonoText>
      </View>
    )}
  />
));

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentWrap: {
    flex: 1,
  },
  storageBadge: {
    minWidth: 54,
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageText: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 14,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
  },
  filterScroll: {
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 4,
  },
  filterPill: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.065)',
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  filterText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  filterTextActive: {
    color: COLORS.text,
  },
  subFilterScroll: {
    marginBottom: 16,
  },
  subFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  subFilterPill: {
    maxWidth: 150,
    minHeight: 31,
    paddingHorizontal: 11,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
  },
  subFilterPillActive: {
    backgroundColor: 'rgba(122,85,255,0.16)',
    borderColor: 'rgba(122,85,255,0.34)',
  },
  subFilterText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.textTertiary,
  },
  subFilterTextActive: {
    color: COLORS.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  sectionCount: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.primary,
  },
  videoRow: {
    height: 94,
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  rowSeparator: {
    height: 8,
  },
  thumbWrap: {
    alignSelf: 'stretch',
    width: 118,
    height: '100%',
    borderTopLeftRadius: CARD_RADIUS,
    borderBottomLeftRadius: CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: CARD_RADIUS,
    borderBottomLeftRadius: CARD_RADIUS,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  durationText: {
    fontSize: 10,
    color: COLORS.text,
  },
  videoCopy: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 8,
    gap: 4,
  },
  videoTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  videoMetaLine: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    lineHeight: 15,
  },
  videoSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  scorePill: {
    backgroundColor: 'rgba(52,224,166,0.08)',
  },
  metaText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  bookmarkButton: {
    width: 30,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filteredEmpty: {
    paddingTop: 70,
  },
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  player: {
    flex: 1,
  },
  playerClose: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
});
