import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Animated,
  Platform,
  PanResponder,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import {
  ChevronRight,
  Clock,
  Layers,
  Calendar,
  X,
  Check,
  BookOpen,
} from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useWorkouts, useDeleteWorkout, useUser } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { WorkoutSession } from '../../backend/services/api';

/* ── Helpers ──────────────────────────────── */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatHeaderDate = (): string => {
  const d = new Date();
  return `${MONTH_SHORT[d.getMonth()].toUpperCase()} ${d.getDate()} \u2022 TODAY`;
};

/* ── Calendar Modal ───────────────────────── */

const CalendarModal = ({
  visible,
  onClose,
  onSelectDate,
  selectedDate,
}: {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: Date) => void;
  selectedDate: Date | null;
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const days: (Date | null)[] = [];
    for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(prev.getMonth() + (direction === 'prev' ? -1 : 1));
      return d;
    });
  };

  const isSameDay = (a: Date | null, b: Date | null) =>
    !!a && !!b && a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  const isToday = (date: Date | null) => {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.calendarOuter} onStartShouldSetResponder={() => true}>
          <LinearGradient
            colors={['#1E1A2E', '#151020', '#0C0A14']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.calendarGradient}
          >
            <View style={styles.calendarEdge}>
              <View style={styles.calendarHeaderRow}>
                <View style={styles.calendarLabelRow}>
                  <Calendar size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.calendarLabel}>SELECT DATE</Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.calendarCloseBtn}
                  activeOpacity={0.7}
                >
                  <X size={16} color={COLORS.textSecondary} strokeWidth={1.5} />
                </TouchableOpacity>
              </View>
              <View style={styles.calendarDivider} />
              <View style={styles.calendarNavRow}>
                <TouchableOpacity onPress={() => navigateMonth('prev')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.calendarNavButton}>{'\u2039'}</Text>
                </TouchableOpacity>
                <Text style={styles.calendarTitle}>
                  {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </Text>
                <TouchableOpacity onPress={() => navigateMonth('next')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.calendarNavButton}>{'\u203A'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.calendarDaysHeader}>
                {DAY_NAMES.map((day) => (
                  <Text key={day} style={styles.calendarDayHeader}>{day}</Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {days.map((day, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.calendarDay,
                      day && isSameDay(day, selectedDate) && styles.calendarDaySelected,
                      !day && styles.calendarDayEmpty,
                      day && isToday(day) && !isSameDay(day, selectedDate) && styles.calendarDayToday,
                    ]}
                    onPress={() => day && onSelectDate(day)}
                    disabled={!day}
                  >
                    {day && (
                      <Text style={[
                        styles.calendarDayText,
                        isSameDay(day, selectedDate) && styles.calendarDayTextSelected,
                        isToday(day) && !isSameDay(day, selectedDate) && styles.calendarDayTextToday,
                      ]}>
                        {day.getDate()}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </LinearGradient>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};


/* ── Workout Card ─────────────────────────── */

interface WorkoutCardProps {
  session: WorkoutSession;
  onDelete: (id: string) => void;
}

const CARD_INNER_HEIGHT = 110;
const CARD_GAP = 12;
const ITEM_HEIGHT = CARD_INNER_HEIGHT + CARD_GAP;
const DELETE_AREA_WIDTH = 72;

const WorkoutCard: React.FC<WorkoutCardProps> = memo(({ session, onDelete }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpen = useRef(false);

  const closeSwipe = useCallback(() => {
    isSwipeOpen.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const { dx, dy } = gestureState;
        return Math.abs(dx) > Math.abs(dy) * 2 && Math.abs(dx) > 8;
      },
      onPanResponderGrant: () => {
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const newValue = startOffset + gestureState.dx;
        translateX.setValue(Math.min(0, Math.max(newValue, -DELETE_AREA_WIDTH)));
      },
      onPanResponderRelease: (_, gestureState) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const projected = startOffset + gestureState.dx;
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
    navigation.navigate('WorkoutDetails', { workoutId: session.id });
  }, [navigation, session.id, closeSwipe]);

  const handleDelete = useCallback(() => {
    closeSwipe();
    showAlert(
      'Delete Workout?',
      "This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(session.id) },
      ],
    );
  }, [onDelete, session.id, closeSwipe, showAlert]);

  return (
    <View style={styles.swipeContainer}>
      {/* Delete button revealed when card slides left */}
      <View style={styles.deleteArea}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.7}>
          <X size={18} color="#EF4444" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* Swipeable card */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.cardOuter}
          activeOpacity={0.82}
          onPress={handlePress}
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Purple accent line on the left */}
              <View style={styles.cardAccentLine} />

              <View style={styles.cardLayout}>
                <View style={styles.cardContent}>
                  <Text style={styles.cardDate}>
                    {session.date} {session.fullDate.getFullYear()}
                  </Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>{session.name}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Layers size={11} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.metaText}>{session.totalSets} {session.totalSets === 1 ? 'set' : 'sets'}</Text>
                    </View>
                    <View style={styles.metaDot} />
                    <View style={styles.metaItem}>
                      <Clock size={11} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.metaText}>{session.duration}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <View style={styles.scoreBadge}>
                    <MonoText style={[styles.scoreValue, { color: getScoreColor(session.formScore) }]}>{session.formScore}</MonoText>
                  </View>
                  <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}, (prev, next) =>
  prev.session.id === next.session.id &&
  prev.session.formScore === next.session.formScore &&
  prev.onDelete === next.onDelete,
);

/* ── Main Screen ──────────────────────────── */

export const LogbookScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { onScroll } = useScroll();
  const { user: profileUser } = useUser();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'year' | 'month' | 'week' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { showAlert } = useAlert();
  const { workouts, isLoading, error, refetch } = useWorkouts();
  const { deleteWorkout } = useDeleteWorkout();
  useFocusEffect(
    React.useCallback(() => {
      setRefreshKey((prev) => prev + 1);
      refetch();
    }, [refetch]),
  );

  useEffect(() => {
    if (!isLoading && !error && !hasAnimated.current) {
      hasAnimated.current = true;
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    }
  }, [isLoading, error, fadeAnim]);

  /* ── Data helpers ──── */

  const getUniqueYears = () => {
    const years = new Set(workouts.map((s) => s.fullDate.getFullYear().toString()));
    return ['All', ...Array.from(years).sort((a, b) => parseInt(b) - parseInt(a))];
  };

  const getUniqueMonths = () => {
    const months = new Set(
      workouts.map((s) => `${MONTH_NAMES[s.fullDate.getMonth()]} ${s.fullDate.getFullYear()}`),
    );
    const sorted = Array.from(months).sort((a, b) => {
      const [mA, yA] = a.split(' ');
      const [mB, yB] = b.split(' ');
      const yd = parseInt(yB) - parseInt(yA);
      return yd !== 0 ? yd : MONTH_NAMES.indexOf(mB) - MONTH_NAMES.indexOf(mA);
    });
    return ['All', ...sorted];
  };

  const formatWeekLabel = (start: Date, end: Date): string => {
    if (start.getMonth() === end.getMonth()) {
      return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  };

  const getUniqueWeeks = () => {
    const weekMap = new Map<string, number>();
    workouts.forEach((s) => {
      const d = s.fullDate;
      const start = new Date(d);
      const day = start.getDay();
      start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const label = formatWeekLabel(start, end);
      if (!weekMap.has(label)) weekMap.set(label, start.getTime());
    });
    const sorted = Array.from(weekMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
    return ['All', ...sorted];
  };

  const getFilteredWorkouts = () => {
    let filtered = [...workouts];
    if (selectedDate) {
      return filtered.filter(
        (s) =>
          s.fullDate.getDate() === selectedDate.getDate() &&
          s.fullDate.getMonth() === selectedDate.getMonth() &&
          s.fullDate.getFullYear() === selectedDate.getFullYear(),
      );
    }
    return filtered.filter((s) => {
      if (selectedYear && s.fullDate.getFullYear().toString() !== selectedYear) return false;
      if (selectedMonth) {
        const [mn, yr] = selectedMonth.split(' ');
        if (s.fullDate.getMonth() !== MONTH_NAMES.indexOf(mn) || s.fullDate.getFullYear().toString() !== yr)
          return false;
      }
      if (selectedWeek) {
        const d = s.fullDate;
        const start = new Date(d);
        const day = start.getDay();
        start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        if (formatWeekLabel(start, end) !== selectedWeek) return false;
      }
      return true;
    });
  };

  const handleFilterChange = (type: 'year' | 'month' | 'week', value: string | null) => {
    const v = value === 'All' ? null : value;
    if (type === 'year') { setSelectedYear(v); setSelectedMonth(null); setSelectedWeek(null); }
    else if (type === 'month') { setSelectedMonth(v); setSelectedWeek(null); }
    else { setSelectedWeek(v); }
    setSelectedDate(null);
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedWeek(null);
    setIsCalendarOpen(false);
  };

  const formatSelectedDate = () => {
    if (!selectedDate) return null;
    return `${MONTH_SHORT[selectedDate.getMonth()]} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`;
  };

  const filteredWorkouts = getFilteredWorkouts();
  const hasActiveFilter = selectedYear || selectedMonth || selectedWeek || selectedDate;
  const activeFilterMode = selectedDate ? 'date' : selectedWeek ? 'week' : selectedMonth ? 'month' : selectedYear ? 'year' : 'all';

  const handleDelete = useCallback(async (id: string) => {
    const success = await deleteWorkout(id);
    if (success) {
      refetch();
    } else {
      showAlert('Error', 'Failed to delete workout. Please try again.');
    }
  }, [deleteWorkout, refetch, showAlert]);

  const renderWorkoutCard = useCallback(({ item }: { item: WorkoutSession }) => (
    <WorkoutCard session={item} onDelete={handleDelete} />
  ), [handleDelete]);

  const keyExtractor = useCallback((item: WorkoutSession) => item.id, []);

  /* ── ListHeaderComponent — everything scrolls together ── */

  const ListHeader = useCallback(() => (
    <View>
      {/* ── DATE + COUNT ───────────────────────── */}
      <View style={styles.subHeaderRow}>
        <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
        <Text style={styles.workoutCount}>
          {filteredWorkouts.length} {filteredWorkouts.length === 1 ? 'session' : 'sessions'}
        </Text>
      </View>

      {/* ── FILTER TABS ───────────────────────── */}
      <View style={styles.filterTabRow}>
        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => { setSelectedYear(null); setSelectedMonth(null); setSelectedWeek(null); setSelectedDate(null); }}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterTabText, activeFilterMode === 'all' && styles.filterTabTextActive]}>All</Text>
          {activeFilterMode === 'all' && <View style={styles.filterUnderline} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => setOpenDropdown('week')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterTabText, activeFilterMode === 'week' && styles.filterTabTextActive]}>Week</Text>
          {activeFilterMode === 'week' && <View style={styles.filterUnderline} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => setOpenDropdown('month')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterTabText, activeFilterMode === 'month' && styles.filterTabTextActive]}>Month</Text>
          {activeFilterMode === 'month' && <View style={styles.filterUnderline} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => setOpenDropdown('year')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterTabText, activeFilterMode === 'year' && styles.filterTabTextActive]}>Year</Text>
          {activeFilterMode === 'year' && <View style={styles.filterUnderline} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => setIsCalendarOpen(true)}
          activeOpacity={0.7}
        >
          <Calendar size={14} color={activeFilterMode === 'date' ? '#FFFFFF' : COLORS.textTertiary} strokeWidth={1.5} />
          {activeFilterMode === 'date' && <View style={styles.filterUnderline} />}
        </TouchableOpacity>
      </View>

      {/* ── ACTIVE FILTER CHIP ────────────────── */}
      {hasActiveFilter && (
        <View style={styles.activeFilterRow}>
          <View style={styles.activeFilterChip}>
            {activeFilterMode === 'date' && <Calendar size={11} color={COLORS.accent} strokeWidth={1.5} />}
            <Text style={styles.activeFilterText}>
              {selectedDate ? formatSelectedDate() : selectedWeek || selectedMonth || selectedYear}
            </Text>
            <TouchableOpacity
              onPress={() => { setSelectedYear(null); setSelectedMonth(null); setSelectedWeek(null); setSelectedDate(null); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={12} color={COLORS.textTertiary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  ), [selectedYear, selectedMonth, selectedWeek, selectedDate, workouts, filteredWorkouts.length]);

  /* ── Loading ──── */
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <View style={{ marginBottom: 28 }}>
            <LoadingSkeleton variant="text" height={38} style={{ width: 180, marginBottom: SPACING.sm }} />
            <LoadingSkeleton variant="text" height={12} style={{ width: 120 }} />
          </View>
          <LoadingSkeleton variant="card" height={110} style={{ marginBottom: 12 }} />
          <LoadingSkeleton variant="card" height={110} style={{ marginBottom: 12 }} />
          <LoadingSkeleton variant="card" height={110} style={{ marginBottom: 12 }} />
          <LoadingSkeleton variant="card" height={110} />
        </View>
      </View>
    );
  }

  /* ── Error ──── */
  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorWrap}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── LOGBOOK HEADER (fixed) ────────────────── */}
      <View style={styles.fixedHeader}>
        <Text style={styles.headerTitle}>LOGBOOK</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.avatarButton}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.avatarPlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Calendar Modal */}
        <CalendarModal
          visible={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
          onSelectDate={handleDateSelect}
          selectedDate={selectedDate}
        />

        {/* Filter Selection Modal */}
        <Modal visible={!!openDropdown} transparent animationType="fade" onRequestClose={() => setOpenDropdown(null)}>
          <TouchableOpacity style={styles.selectionOverlay} activeOpacity={1} onPress={() => setOpenDropdown(null)}>
            <View style={styles.selectionContainer} onStartShouldSetResponder={() => true}>
              <LinearGradient
                colors={['#1E1A2E', '#151020', '#0C0A14']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.selectionGradient}
              >
                <View style={styles.selectionEdge}>
                  <View style={styles.selectionHeader}>
                    <View style={styles.selectionLabelRow}>
                      <Layers size={13} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.selectionTitle}>
                        {openDropdown === 'year' ? 'SELECT YEAR' : openDropdown === 'month' ? 'SELECT MONTH' : 'SELECT WEEK'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setOpenDropdown(null)}
                      style={styles.selectionCloseBtn}
                      activeOpacity={0.7}
                    >
                      <X size={16} color={COLORS.textSecondary} strokeWidth={1.5} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.selectionDivider} />
                  <ScrollView showsVerticalScrollIndicator={false} style={styles.selectionScroll}>
                    {(openDropdown === 'year' ? getUniqueYears() : openDropdown === 'month' ? getUniqueMonths() : getUniqueWeeks()).map((option) => {
                      const currentValue = openDropdown === 'year' ? selectedYear : openDropdown === 'month' ? selectedMonth : selectedWeek;
                      const isSelected = currentValue === option || (option === 'All' && !currentValue);
                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.selectionItem, isSelected && styles.selectionItemActive]}
                          onPress={() => { if (openDropdown) handleFilterChange(openDropdown, option); setOpenDropdown(null); }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.selectionItemText, isSelected && styles.selectionItemTextActive]}>
                            {option}
                          </Text>
                          {isSelected && (
                            <View style={styles.selectionCheckWrap}>
                              <Check size={14} color={COLORS.accent} strokeWidth={2.5} />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </Modal>

        {filteredWorkouts.length === 0 ? (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: SPACING.screenHorizontal }}>
              <ListHeader />
            </View>
            <View style={[StyleSheet.absoluteFill, styles.emptyState]} pointerEvents="none">
              <View style={styles.emptyIconWrap}>
                <BookOpen size={28} color={COLORS.textTertiary} strokeWidth={1.2} />
              </View>
              <Text style={styles.emptyStateTitle}>
                {selectedDate ? 'No sessions' : 'No workouts yet'}
              </Text>
              <Text style={styles.emptyStateText}>
                {selectedDate
                  ? `Nothing recorded on ${formatSelectedDate()}`
                  : 'Complete a workout to see it here'}
              </Text>
            </View>
          </View>
        ) : (
          <FlatList
            data={filteredWorkouts}
            renderItem={renderWorkoutCard}
            keyExtractor={keyExtractor}
            ListHeaderComponent={ListHeader}
            contentContainerStyle={[styles.listContent, { paddingBottom: 200 }]}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            removeClippedSubviews={true}
            initialNumToRender={5}
            maxToRenderPerBatch={5}
            windowSize={5}
          />
        )}
      </Animated.View>
    </View>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.xl,
  },
  errorWrap: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },

  /* ── Fixed Header ────────────────────────── */
  fixedHeader: {
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 38,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 44,
  },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#52525B',
    letterSpacing: 2.5,
  },
  workoutCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: '#52525B',
    letterSpacing: 0.5,
  },
  avatarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    marginTop: 6,
  },
  avatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarGradient: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#000000',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },

  /* ── Filter Tabs ─────────────────────────── */
  filterTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginBottom: 4,
    marginTop: 12,
    gap: 20,
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

  /* ── Active Filter Chip ─────────────────── */
  activeFilterRow: {
    marginBottom: 12,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
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

  /* ── Swipe-to-Delete ─────────────────────── */
  swipeContainer: {
    height: CARD_INNER_HEIGHT,
  },
  deleteArea: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 12,
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Workout Card ────────────────────────── */
  cardOuter: {
    height: CARD_INNER_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardGradient: {
    flex: 1,
    borderRadius: 16,
  },
  cardGlassEdge: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: SPACING.lg,
    paddingLeft: 0,
    paddingRight: SPACING.md,
    alignItems: 'center',
  },
  cardAccentLine: {
    width: 3,
    height: 36,
    borderRadius: 1.5,
    marginLeft: 14,
    marginRight: 14,
    backgroundColor: COLORS.accent,
  },
  cardLayout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardContent: {
    flex: 1,
    gap: 3,
  },
  cardDate: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: '#52525B',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#3F3F46',
  },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 0.3,
  },
  cardRight: {
    alignItems: 'center',
    gap: 10,
    marginLeft: SPACING.md,
  },
  scoreBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    minWidth: 44,
  },
  scoreValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 19,
    textAlign: 'center',
  },

  /* ── List ────────────────────────────────── */
  listContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    gap: CARD_GAP,
  },

  /* ── Empty State ─────────────────────────── */
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#52525B',
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ── Calendar Modal ──────────────────────── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarOuter: {
    width: '88%',
    maxWidth: 380,
  },
  calendarGradient: {
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  calendarEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  calendarLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  calendarLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  calendarCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDivider: {
    height: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    marginBottom: 16,
  },
  calendarNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  calendarNavButton: {
    fontSize: 26,
    fontFamily: FONTS.display.medium,
    color: COLORS.accent,
    paddingHorizontal: 12,
  },
  calendarTitle: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  calendarDaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.sm,
  },
  calendarDayHeader: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: '#3F3F46',
    width: 40,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  calendarDay: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 3,
  },
  calendarDayEmpty: {
    opacity: 0,
  },
  calendarDaySelected: {
    backgroundColor: COLORS.accent,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
      },
    }),
  },
  calendarDayToday: {
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  calendarDayText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: '#A1A1AA',
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontFamily: FONTS.ui.bold,
  },
  calendarDayTextToday: {
    color: COLORS.accent,
  },

  /* ── Selection Modal ────────────────────── */
  selectionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionContainer: {
    width: '88%',
    maxWidth: 380,
  },
  selectionGradient: {
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  selectionEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  selectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectionTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  selectionCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionDivider: {
    height: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    marginBottom: 12,
  },
  selectionScroll: {
    maxHeight: 340,
  },
  selectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    marginVertical: 2,
  },
  selectionItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  selectionItemText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  selectionItemTextActive: {
    color: '#FFFFFF',
    fontFamily: FONTS.display.semibold,
  },
  selectionCheckWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
