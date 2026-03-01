import React, { useCallback, useState, useRef, useEffect, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  Platform,
  Animated,
  RefreshControl,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Trash2, Play, HardDrive, Film,
  Filter, X, Dumbbell, ChevronRight,
} from 'lucide-react-native';
import {
  COLORS, FONTS, SPACING,
  CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { MonoText } from '../components/typography/MonoText';
import { LoadingSkeleton, EmptyState } from '../components/ui';
import { useVideoLibrary } from '../../backend/hooks/useVideoLibrary';
import type { VideoRecord } from '../../backend/services/videoLibrary';

let VideoComponent: any = null;
try {
  VideoComponent = require('expo-av').Video;
} catch {
  // expo-av Video not available
}

// ── Types ────────────────────────────────────────────

type FilterMode = 'all' | 'exercise' | 'workout' | 'date';
type DateRange = 'all' | 'today' | 'week' | 'month';

interface WorkoutGroup {
  id: string;
  date: string;
  exercises: string[];
  setCount: number;
}

// ── Constants ────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatFullDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// ── Layout ───────────────────────────────────────────

const GRID_GAP = 10;
const CARD_WIDTH = (Dimensions.get('window').width - SPACING.screenHorizontal * 2 - GRID_GAP) / 2;
const THUMB_HEIGHT = CARD_WIDTH * 1.25;

// ── VideoCard Component ──────────────────────────────

const VideoCard = memo(({ item, onPlay, onDelete }: {
  item: VideoRecord;
  onPlay: (item: VideoRecord) => void;
  onDelete: (item: VideoRecord) => void;
}) => {
  const scoreColor = getScoreColor(item.formScore);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => onPlay(item)}
      onLongPress={() => onDelete(item)}
    >
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          {/* Thumbnail area */}
          <View style={styles.thumbWrap}>
            {item.thumbnailPath ? (
              <Image source={{ uri: item.thumbnailPath }} style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                <View style={styles.playIconWrap}>
                  <Play size={20} color="rgba(255,255,255,0.7)" strokeWidth={1.5} fill="rgba(255,255,255,0.7)" />
                </View>
              </View>
            )}
            {/* Duration + date badge */}
            <View style={styles.durationBadge}>
              <MonoText style={styles.durationText}>{formatFullDate(item.date)} · {formatDuration(item.durationSeconds)}</MonoText>
            </View>
            {/* Score badge */}
            <View style={[styles.scoreBadge, { backgroundColor: 'rgba(0, 0, 0, 0.65)' }]}>
              <MonoText style={[styles.scoreText, { color: scoreColor }]}>{item.formScore}</MonoText>
            </View>
          </View>

          {/* Info area */}
          <View style={styles.cardInfo}>
            <View style={styles.infoTopRow}>
              <Text style={styles.cardExercise} numberOfLines={1}>{item.exerciseName}</Text>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => onDelete(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Trash2 size={12} color="#EF4444" strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
            <View style={styles.statsRow}>
              <Text style={styles.statLabel}>REPS</Text>
              <MonoText style={styles.statValue}>{item.reps}</MonoText>
              <View style={styles.statDivider} />
              <Text style={styles.statLabel}>SET</Text>
              <MonoText style={styles.statValue}>{item.setNumber}</MonoText>
            </View>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

// ── Main Screen ──────────────────────────────────────

export const VideoLibraryScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const {
    recordings, isLoading, refreshing, storageInfo,
    deleteRecording, refreshRecordings, pullToRefresh,
  } = useVideoLibrary();

  // UI state
  const [playingVideo, setPlayingVideo] = useState<VideoRecord | null>(null);
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);

  // Filter state
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<DateRange>('all');

  // Animated entrance
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useFocusEffect(
    useCallback(() => {
      refreshRecordings();
    }, [refreshRecordings])
  );

  useEffect(() => {
    if (!isLoading && recordings.length > 0) {
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
    }
  }, [isLoading, recordings.length, fadeAnim, slideAnim]);

  // ── Derived data ──────────────────────────────────

  const uniqueExercises = useMemo(() => {
    const names = new Set(recordings.map(r => r.exerciseName));
    return Array.from(names).sort();
  }, [recordings]);

  const uniqueWorkouts = useMemo(() => {
    const workoutMap = new Map<string, { id: string; date: string; exercises: Set<string>; setCount: number }>();
    let unlinkedCount = 0;

    for (const r of recordings) {
      if (!r.workoutId) {
        unlinkedCount++;
        continue;
      }
      const existing = workoutMap.get(r.workoutId);
      if (existing) {
        existing.exercises.add(r.exerciseName);
        existing.setCount++;
        if (r.date < existing.date) existing.date = r.date;
      } else {
        workoutMap.set(r.workoutId, {
          id: r.workoutId,
          date: r.date,
          exercises: new Set([r.exerciseName]),
          setCount: 1,
        });
      }
    }

    const linked: WorkoutGroup[] = Array.from(workoutMap.values())
      .map(w => ({ ...w, exercises: Array.from(w.exercises) }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return { linked, hasUnlinked: unlinkedCount > 0 };
  }, [recordings]);

  const filteredRecordings = useMemo(() => {
    let result = recordings;

    if (filterMode === 'exercise' && selectedExercise) {
      result = result.filter(r => r.exerciseName === selectedExercise);
    } else if (filterMode === 'workout' && selectedWorkoutId) {
      if (selectedWorkoutId === '__unlinked__') {
        result = result.filter(r => !r.workoutId);
      } else {
        result = result.filter(r => r.workoutId === selectedWorkoutId);
      }
    } else if (filterMode === 'date' && selectedDateRange !== 'all') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (selectedDateRange === 'today') {
        result = result.filter(r => new Date(r.date) >= startOfDay);
      } else if (selectedDateRange === 'week') {
        const weekAgo = new Date(startOfDay);
        weekAgo.setDate(weekAgo.getDate() - 7);
        result = result.filter(r => new Date(r.date) >= weekAgo);
      } else if (selectedDateRange === 'month') {
        const monthAgo = new Date(startOfDay);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        result = result.filter(r => new Date(r.date) >= monthAgo);
      }
    }

    return result;
  }, [recordings, filterMode, selectedExercise, selectedWorkoutId, selectedDateRange]);

  const hasActiveFilter = filterMode !== 'all' && (
    (filterMode === 'exercise' && selectedExercise !== null) ||
    (filterMode === 'workout' && selectedWorkoutId !== null) ||
    (filterMode === 'date' && selectedDateRange !== 'all')
  );

  // ── Handlers ──────────────────────────────────────

  const handleDelete = useCallback((record: VideoRecord) => {
    Alert.alert(
      'Delete Recording',
      `Delete this ${record.exerciseName} recording?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteRecording(record.id),
        },
      ]
    );
  }, [deleteRecording]);

  const handlePlay = useCallback((record: VideoRecord) => {
    setPlayingVideo(record);
  }, []);

  const handleFilterModeChange = useCallback((mode: FilterMode) => {
    setFilterMode(mode);
    setSelectedExercise(null);
    setSelectedWorkoutId(null);
    setSelectedDateRange('all');
  }, []);

  const clearFilters = useCallback(() => {
    setFilterMode('all');
    setSelectedExercise(null);
    setSelectedWorkoutId(null);
    setSelectedDateRange('all');
  }, []);

  const getActiveFilterLabel = useCallback(() => {
    if (filterMode === 'exercise' && selectedExercise) return selectedExercise;
    if (filterMode === 'workout' && selectedWorkoutId) {
      if (selectedWorkoutId === '__unlinked__') return 'Unlinked';
      const workout = uniqueWorkouts.linked.find(w => w.id === selectedWorkoutId);
      return workout ? formatFullDate(workout.date) : 'Workout';
    }
    if (filterMode === 'date' && selectedDateRange !== 'all') {
      const range = DATE_RANGES.find(r => r.value === selectedDateRange);
      return range?.label ?? '';
    }
    return '';
  }, [filterMode, selectedExercise, selectedWorkoutId, selectedDateRange, uniqueWorkouts.linked]);

  const renderItem = useCallback(({ item }: { item: VideoRecord }) => (
    <VideoCard item={item} onPlay={handlePlay} onDelete={handleDelete} />
  ), [handlePlay, handleDelete]);

  // ── Loading state ─────────────────────────────────

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={22} color={COLORS.text} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.sectionLabelRow}>
              <Film size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>VIDEO LIBRARY</Text>
            </View>
          </View>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton variant="card" height={48} style={{ marginBottom: SPACING.md }} />
          <View style={styles.loadingGrid}>
            <LoadingSkeleton variant="card" height={THUMB_HEIGHT + 60} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={THUMB_HEIGHT + 60} style={{ flex: 1 }} />
          </View>
          <View style={[styles.loadingGrid, { marginTop: GRID_GAP }]}>
            <LoadingSkeleton variant="card" height={THUMB_HEIGHT + 60} style={{ flex: 1 }} />
            <LoadingSkeleton variant="card" height={THUMB_HEIGHT + 60} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    );
  }

  // ── Empty state (no recordings) ───────────────────

  if (recordings.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={22} color={COLORS.text} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.sectionLabelRow}>
              <Film size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>VIDEO LIBRARY</Text>
            </View>
          </View>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState
            title="No recordings yet"
            message="Tap the video icon in the camera screen to record your sets"
            icon={Play}
          />
        </View>
      </View>
    );
  }

  // ── Main content ──────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color={COLORS.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.sectionLabelRow}>
            <Film size={13} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionLabel}>VIDEO LIBRARY</Text>
          </View>
        </View>
        <View style={styles.storageBadge}>
          <HardDrive size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
          <MonoText style={styles.storageText}>
            {storageInfo.count} · {storageInfo.totalSizeMB}MB
          </MonoText>
        </View>
      </View>

      <Animated.View style={[styles.contentWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <FlatList
          data={filteredRecordings}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullToRefresh}
              tintColor={COLORS.accent}
              colors={[COLORS.accent]}
            />
          }
          removeClippedSubviews
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={7}
          ListHeaderComponent={
            <View>
              {/* ── Filter Tab Bar ─────────────────── */}
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.filterCard}
              >
                <View style={styles.filterCardEdge}>
                  <View style={styles.filterTabRow}>
                    {FILTER_TABS.map(tab => (
                      <TouchableOpacity
                        key={tab.key}
                        style={[styles.filterTab, filterMode === tab.key && styles.filterTabActive]}
                        onPress={() => handleFilterModeChange(tab.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.filterTabText, filterMode === tab.key && styles.filterTabTextActive]}>
                          {tab.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </LinearGradient>

              {/* ── Sub-filters ────────────────────── */}
              {filterMode === 'exercise' && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.subFilterScroll}
                  contentContainerStyle={styles.subFilterContent}
                >
                  {uniqueExercises.map(name => (
                    <TouchableOpacity
                      key={name}
                      style={[styles.subFilterPill, selectedExercise === name && styles.subFilterPillActive]}
                      onPress={() => setSelectedExercise(prev => prev === name ? null : name)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.subFilterPillText, selectedExercise === name && styles.subFilterPillTextActive]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {filterMode === 'workout' && (
                <TouchableOpacity
                  style={styles.selectWorkoutBtn}
                  onPress={() => setShowWorkoutModal(true)}
                  activeOpacity={0.7}
                >
                  <Dumbbell size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                  <Text style={styles.selectWorkoutBtnText} numberOfLines={1}>
                    {selectedWorkoutId
                      ? (selectedWorkoutId === '__unlinked__'
                        ? 'Unlinked Recordings'
                        : (() => {
                            const w = uniqueWorkouts.linked.find(wk => wk.id === selectedWorkoutId);
                            return w ? `${formatFullDate(w.date)} — ${w.exercises.join(', ')}` : 'Select Workout';
                          })())
                      : 'Select Workout'}
                  </Text>
                  <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
              )}

              {filterMode === 'date' && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.subFilterScroll}
                  contentContainerStyle={styles.subFilterContent}
                >
                  {DATE_RANGES.map(range => (
                    <TouchableOpacity
                      key={range.value}
                      style={[styles.subFilterPill, selectedDateRange === range.value && styles.subFilterPillActive]}
                      onPress={() => setSelectedDateRange(range.value)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.subFilterPillText, selectedDateRange === range.value && styles.subFilterPillTextActive]}>
                        {range.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* ── Active filter chip ─────────────── */}
              {hasActiveFilter && (
                <View style={styles.activeFilterRow}>
                  <View style={styles.activeFilterChip}>
                    <Text style={styles.activeFilterText}>{getActiveFilterLabel()}</Text>
                    <TouchableOpacity onPress={clearFilters} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <X size={12} color={COLORS.textSecondary} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.resultCount}>
                    {filteredRecordings.length} {filteredRecordings.length === 1 ? 'recording' : 'recordings'}
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="No matching recordings"
              message="Try adjusting your filters"
              icon={Filter}
            />
          }
        />
      </Animated.View>

      {/* ── Workout Selection Modal ────────────── */}
      <Modal
        visible={showWorkoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWorkoutModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowWorkoutModal(false)}
        >
          <View style={styles.selectionContainer} onStartShouldSetResponder={() => true}>
            <LinearGradient
              colors={['#1E1A2E', '#151020', '#0C0A14']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.selectionGradient}
            >
              <View style={styles.selectionEdge}>
                <View style={styles.selectionHeader}>
                  <View style={styles.sectionLabelRow}>
                    <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>SELECT WORKOUT</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowWorkoutModal(false)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <X size={16} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.selectionScroll}
                >
                  {uniqueWorkouts.linked.map(workout => (
                    <TouchableOpacity
                      key={workout.id}
                      style={[
                        styles.selectionItem,
                        selectedWorkoutId === workout.id && styles.selectionItemActive,
                      ]}
                      onPress={() => {
                        setSelectedWorkoutId(workout.id);
                        setShowWorkoutModal(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.selectionItemDate}>{formatFullDate(workout.date)}</Text>
                      <Text style={styles.selectionItemExercises} numberOfLines={1}>
                        {workout.exercises.join(', ')} — {workout.setCount} {workout.setCount === 1 ? 'set' : 'sets'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {uniqueWorkouts.hasUnlinked && (
                    <TouchableOpacity
                      style={[
                        styles.selectionItem,
                        selectedWorkoutId === '__unlinked__' && styles.selectionItemActive,
                      ]}
                      onPress={() => {
                        setSelectedWorkoutId('__unlinked__');
                        setShowWorkoutModal(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.selectionItemDate}>Unlinked Recordings</Text>
                      <Text style={styles.selectionItemExercises}>
                        Recordings not linked to a saved workout
                      </Text>
                    </TouchableOpacity>
                  )}
                  {uniqueWorkouts.linked.length === 0 && !uniqueWorkouts.hasUnlinked && (
                    <Text style={styles.selectionEmpty}>No workouts with recordings</Text>
                  )}
                </ScrollView>
              </View>
            </LinearGradient>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Video Playback Modal ──────────────── */}
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
    </View>
  );
};

// ── Styles ───────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  contentWrap: {
    flex: 1,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    width: 40,
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
  storageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  storageText: {
    fontSize: 10,
    color: COLORS.textTertiary,
  },

  /* ── Loading ─────────────────────────────── */
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xl,
  },

  /* ── Empty ───────────────────────────────── */
  emptyWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },

  /* ── Loading Grid ─────────────────────────── */
  loadingGrid: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },

  /* ── List ────────────────────────────────── */
  list: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },

  /* ── Filter Card ─────────────────────────── */
  filterCard: {
    borderRadius: 16,
    marginBottom: 12,
  },
  filterCardEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 4,
  },
  filterTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  filterTabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },

  /* ── Sub-filter pills ────────────────────── */
  subFilterScroll: {
    marginBottom: 10,
  },
  subFilterContent: {
    gap: 8,
  },
  subFilterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  subFilterPillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.40)',
  },
  subFilterPillText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  subFilterPillTextActive: {
    color: '#FFFFFF',
  },

  /* ── Workout selector button ─────────────── */
  selectWorkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  selectWorkoutBtnText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  /* ── Active filter chip ──────────────────── */
  activeFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.20)',
  },
  activeFilterText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  resultCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Video Card (Portrait) ──────────────── */
  card: {
    width: CARD_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  cardGradient: {
    borderRadius: 16,
  },
  cardEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  thumbWrap: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: THUMB_HEIGHT,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  durationText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  infoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  scoreBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  scoreText: {
    fontSize: 12,
    letterSpacing: -0.3,
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 3,
  },
  cardExercise: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statValue: {
    fontSize: 14,
    letterSpacing: -0.3,
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    letterSpacing: 0.8,
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginHorizontal: 2,
  },

  /* ── Workout Selection Modal ─────────────── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  selectionContainer: {
    maxHeight: '70%',
  },
  selectionGradient: {
    borderRadius: 22,
  },
  selectionEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 18,
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  selectionScroll: {
    maxHeight: 400,
  },
  selectionItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  selectionItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  selectionItemDate: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  selectionItemExercises: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  selectionEmpty: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: SPACING.xl,
  },

  /* ── Video Playback ──────────────────────── */
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
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playerCloseText: {
    fontSize: 15,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});
