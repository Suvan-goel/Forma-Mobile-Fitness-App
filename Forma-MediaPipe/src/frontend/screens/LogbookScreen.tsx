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
  ChevronLeft,
  Layers,
  Calendar,
  X,
  Check,
  BookOpen,
  Search,
  SlidersHorizontal,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS, SCREEN_GRADIENT_COLORS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor ,
  CARD_SHADOW
} from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useWorkouts, useDeleteWorkout } from '../../backend/hooks';
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
const WEEK_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WORKOUT_THUMBS = [
  require('../assets/exercises/barbell_squat.png'),
  require('../assets/exercises/barbell_curl.png'),
  require('../assets/exercises/cable_row.png'),
  require('../assets/exercises/push_up.png'),
  require('../assets/exercises/cable_lat_pulldowns.png'),
  require('../assets/exercises/leg_extensions.png'),
];

type LogbookListItem =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'workout'; key: string; session: WorkoutSession; index: number };

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
            colors={SCREEN_GRADIENT_COLORS}
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
const CARD_GAP = 9;
const ITEM_HEIGHT = CARD_INNER_HEIGHT + CARD_GAP;
const DELETE_AREA_WIDTH = 72;

const WorkoutCard: React.FC<WorkoutCardProps & { index: number }> = memo(({ session, onDelete, index }) => {
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

  const chips = [
    session.category,
    session.name.includes(' ') ? session.name.split(' ')[0] : session.name,
    `${session.totalReps} reps`,
  ].filter(Boolean).slice(0, 3) as string[];

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
              <View style={styles.cardLayout}>
                <View style={styles.workoutThumb}>
                  <Image
                    source={WORKOUT_THUMBS[index % WORKOUT_THUMBS.length]}
                    style={styles.workoutThumbImage}
                    resizeMode="cover"
                  />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{session.name}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaText}>{session.date}</Text>
                    </View>
                    <View style={styles.metaDot} />
                    <View style={styles.metaItem}>
                      <Text style={styles.metaText}>{session.duration}</Text>
                    </View>
                  </View>
                  <Text style={styles.exerciseSummary} numberOfLines={1}>
                    {session.totalSets} sets · {session.totalReps} reps
                  </Text>
                  <View style={styles.chipRow}>
                    {chips.map((chip) => (
                      <View key={chip} style={styles.exerciseChip}>
                        <Text style={styles.exerciseChipText} numberOfLines={1}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <View style={[styles.scoreBadge, { borderColor: getScoreColor(session.formScore) }]}>
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
  prev.index === next.index &&
  prev.onDelete === next.onDelete,
);

/* ── Main Screen ──────────────────────────── */

export const LogbookScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { onScroll } = useScroll();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'year' | 'month' | 'week' | null>(null);

  const { showAlert } = useAlert();
  const { workouts, isLoading, error, refetch } = useWorkouts();
  const { deleteWorkout } = useDeleteWorkout();
  useFocusEffect(
    React.useCallback(() => {
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
  const calendarBaseDate = selectedDate ?? filteredWorkouts[0]?.fullDate ?? new Date();
  const calendarWeekStart = new Date(calendarBaseDate);
  const calendarDay = calendarWeekStart.getDay();
  calendarWeekStart.setDate(calendarWeekStart.getDate() - calendarDay + (calendarDay === 0 ? -6 : 1));
  const visibleWeekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(calendarWeekStart);
    date.setDate(calendarWeekStart.getDate() + index);
    return date;
  });
  const selectedOrToday = selectedDate ?? new Date();
  const monthTitle = `${MONTH_NAMES[calendarBaseDate.getMonth()]} ${calendarBaseDate.getFullYear()}`;
  const groupedListItems: LogbookListItem[] = [];
  const groupedByDay = new Map<string, WorkoutSession[]>();
  filteredWorkouts.forEach((session) => {
    const key = session.fullDate.toDateString();
    const existing = groupedByDay.get(key) ?? [];
    existing.push(session);
    groupedByDay.set(key, existing);
  });
  Array.from(groupedByDay.entries()).forEach(([key, sessions]) => {
    const date = sessions[0].fullDate;
    const label = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).toUpperCase();
    groupedListItems.push({
      type: 'header',
      key: `header-${key}`,
      label,
      count: sessions.length,
    });
    sessions.forEach((session, index) => {
      groupedListItems.push({
        type: 'workout',
        key: session.id,
        session,
        index,
      });
    });
  });

  const handleDelete = useCallback(async (id: string) => {
    const success = await deleteWorkout(id);
    if (success) {
      refetch();
    } else {
      showAlert('Error', 'Failed to delete workout. Please try again.');
    }
  }, [deleteWorkout, refetch, showAlert]);

  const renderListItem = useCallback(({ item }: { item: LogbookListItem }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.dayGroupHeader}>
          <Text style={styles.dayGroupTitle}>{item.label}</Text>
          <Text style={styles.dayGroupCount}>
            {item.count} workout{item.count === 1 ? '' : 's'}
          </Text>
        </View>
      );
    }
    return <WorkoutCard session={item.session} index={item.index} onDelete={handleDelete} />;
  }, [handleDelete]);

  const keyExtractor = useCallback((item: LogbookListItem) => item.key, []);

  /* ── ListHeaderComponent — everything scrolls together ── */

  const ListHeader = useCallback(() => (
    <View>
      <View style={styles.monthNavRow}>
        <TouchableOpacity
          onPress={() => setOpenDropdown('month')}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={16} color={COLORS.textSecondary} strokeWidth={1.7} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOpenDropdown('month')}
          activeOpacity={0.7}
          style={styles.monthTitleButton}
        >
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <ChevronRight size={12} color={COLORS.textTertiary} strokeWidth={1.7} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setIsCalendarOpen(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Calendar size={16} color={COLORS.textSecondary} strokeWidth={1.7} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekCalendar}>
        {visibleWeekDays.map((date, index) => {
          const isSelected =
            selectedOrToday.getDate() === date.getDate() &&
            selectedOrToday.getMonth() === date.getMonth() &&
            selectedOrToday.getFullYear() === date.getFullYear();
          return (
            <TouchableOpacity
              key={date.toISOString()}
              style={styles.weekDayCell}
              onPress={() => handleDateSelect(date)}
              activeOpacity={0.75}
            >
              <Text style={styles.weekDayLabel}>{WEEK_DAY_LABELS[index]}</Text>
              <View style={[styles.weekDayNumberWrap, isSelected && styles.weekDayNumberSelected]}>
                <Text style={[styles.weekDayNumber, isSelected && styles.weekDayNumberTextSelected]}>
                  {date.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
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
  ), [selectedYear, selectedMonth, selectedWeek, selectedDate, hasActiveFilter, activeFilterMode, monthTitle, selectedOrToday, visibleWeekDays, handleDateSelect, navigation]);

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
      {/* ── LOGBOOK HEADER ─────── */}
      <View style={styles.header}>
        <Text style={styles.headerName}>LOGBOOK</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
            style={styles.headerIconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
        </View>
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
                colors={SCREEN_GRADIENT_COLORS}
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
            data={groupedListItems}
            renderItem={renderListItem}
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
    backgroundColor: 'transparent',
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

  /* ── Header ────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 5,
    paddingBottom: 10,
  },
  headerSubtitleText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
    marginTop: 1,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Calendar Strip ─────────────────────── */
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    marginTop: 4,
    marginBottom: 10,
  },
  monthTitleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  monthTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    letterSpacing: -0.1,
  },
  weekCalendar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  weekDayCell: {
    alignItems: 'center',
    gap: 6,
    width: 35,
  },
  weekDayLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textTertiary,
  },
  weekDayNumberWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDayNumberSelected: {
    backgroundColor: COLORS.accent,
  },
  weekDayNumber: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  weekDayNumberTextSelected: {
    fontFamily: FONTS.ui.bold,
    color: '#FFFFFF',
  },

  /* ── Active Filter Chip ─────────────────── */
  activeFilterRow: {
    marginBottom: 0,
    marginTop: 6,
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
    borderRadius: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  cardGradient: {
    flex: 1,
    borderRadius: 10,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardGlassEdge: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    padding: 10,
    alignItems: 'center',
  },
  cardLayout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  workoutThumb: {
    width: 58,
    height: 74,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  workoutThumbImage: {
    width: '100%',
    height: '100%',
  },
  cardContent: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
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
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  exerciseSummary: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  exerciseChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  exerciseChipText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 8.5,
    color: COLORS.textSecondary,
  },
  cardRight: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginLeft: 2,
  },
  scoreBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: COLORS.green,
    backgroundColor: 'rgba(16,23,28,0.45)',
  },
  scoreValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 17,
    textAlign: 'center',
  },

  /* ── List ────────────────────────────────── */
  listContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    gap: CARD_GAP,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: -2,
  },
  dayGroupTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.7,
  },
  dayGroupCount: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textTertiary,
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
        shadowColor: '#7C5CFF',
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
        shadowColor: '#7C5CFF',
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
        shadowColor: '#7C5CFF',
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
