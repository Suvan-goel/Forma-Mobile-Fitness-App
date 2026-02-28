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
} from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS, CARD_STYLE, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
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

  const days = getDaysInMonth(currentMonth);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.calendarContainer} onStartShouldSetResponder={() => true}>
          <View style={styles.calendarHeader}>
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
                ]}
                onPress={() => day && onSelectDate(day)}
                disabled={!day}
              >
                {day && (
                  <Text style={[styles.calendarDayText, isSameDay(day, selectedDate) && styles.calendarDayTextSelected]}>
                    {day.getDate()}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.calendarCloseButton} onPress={onClose}>
            <Text style={styles.calendarCloseButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

/* ── Dropdown Pill (Year/Month/Week) ──────── */

const DropdownPill = ({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: string[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const displayValue = selectedValue || label;

  return (
    <>
      <TouchableOpacity
        style={[styles.filterPill, selectedValue && styles.filterPillActive]}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.filterPillText, selectedValue && styles.filterPillTextActive]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {displayValue}
        </Text>
      </TouchableOpacity>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setIsOpen(false)}>
          <View style={styles.dropdownSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.dropdownHandleWrap}>
              <View style={styles.dropdownHandle} />
            </View>
            <Text style={styles.dropdownTitle}>{label}</Text>
            <View style={styles.dropdownDivider} />
            <ScrollView showsVerticalScrollIndicator={false} style={styles.dropdownScroll}>
              {options.map((option) => {
                const isSelected = selectedValue === option || (option === 'All' && !selectedValue);
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                    onPress={() => { onSelect(option); setIsOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]}>
                      {option}
                    </Text>
                    {isSelected && (
                      <View style={styles.dropdownCheckWrap}>
                        <Check size={16} color={COLORS.accent} strokeWidth={2.5} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

/* ── Workout Card (LinearGradient surface) ── */

interface WorkoutCardProps {
  session: WorkoutSession;
  onDelete: (id: string) => void;
}

/** Card height = content (~74px) + increased top/bottom padding (20px) + horizontal padding (16px); gap for getItemLayout */
const CARD_INNER_HEIGHT = 122;
const CARD_GAP = 14;
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
          <X size={20} color="#EF4444" strokeWidth={2} />
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
                <View style={styles.cardContent}>
                  <Text style={styles.cardDate}>
                    {session.date} {session.fullDate.getFullYear()}
                  </Text>
                  <Text style={styles.cardTitle}>{session.name}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Layers size={12} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.metaText}>{session.totalSets} {session.totalSets === 1 ? 'SET' : 'SETS'}</Text>
                    </View>
                    <View style={styles.metaDot} />
                    <View style={styles.metaItem}>
                      <Clock size={12} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.metaText}>{session.duration}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <View style={styles.scoreBadge}>
                    <MonoText style={styles.scoreValue}>{session.formScore}</MonoText>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
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
      {/* ── FILTER ROW ───────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScrollView}
        nestedScrollEnabled
      >
        <TouchableOpacity
          style={[styles.calendarPill, selectedDate && styles.filterPillActive]}
          onPress={() => setIsCalendarOpen(true)}
          activeOpacity={0.7}
        >
          <Calendar size={15} color={selectedDate ? '#FFFFFF' : '#71717A'} strokeWidth={1.5} />
        </TouchableOpacity>

        <DropdownPill label="Year" options={getUniqueYears()} selectedValue={selectedYear} onSelect={(v) => handleFilterChange('year', v)} />
        <DropdownPill label="Month" options={getUniqueMonths()} selectedValue={selectedMonth} onSelect={(v) => handleFilterChange('month', v)} />
        <DropdownPill label="Week" options={getUniqueWeeks()} selectedValue={selectedWeek} onSelect={(v) => handleFilterChange('week', v)} />
      </ScrollView>

      {/* ── SELECTED DATE CHIP ────────────────── */}
      {selectedDate && (
        <View style={styles.dateChipRow}>
          <View style={styles.dateChip}>
            <Text style={styles.dateChipText}>{formatSelectedDate()}</Text>
            <TouchableOpacity
              onPress={() => { setSelectedDate(null); setSelectedYear(null); setSelectedMonth(null); setSelectedWeek(null); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={13} color="#71717A" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  ), [selectedYear, selectedMonth, selectedWeek, selectedDate, workouts]);

  /* ── Loading ──── */
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <View style={{ marginBottom: 30 }}>
            <LoadingSkeleton variant="text" height={40} style={{ width: 200, marginBottom: SPACING.sm }} />
            <LoadingSkeleton variant="text" height={12} style={{ width: 130 }} />
          </View>
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: 14 }} />
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: 14 }} />
          <LoadingSkeleton variant="card" height={120} style={{ marginBottom: 14 }} />
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
        <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Calendar Modal (rendered outside FlatList, portaled via Modal) */}
        <CalendarModal
          visible={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
          onSelectDate={handleDateSelect}
          selectedDate={selectedDate}
        />

        {filteredWorkouts.length === 0 ? (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: SPACING.screenHorizontal }}>
              <ListHeader />
            </View>
            <View style={[StyleSheet.absoluteFill, styles.emptyState]} pointerEvents="none">
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
    paddingBottom: 8,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 46,
  },
  headerDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 3,
    marginTop: 6,
  },

  /* ── Filter Row ──────────────────────────── */
  filterScrollView: {
    maxHeight: 46,
    marginBottom: SPACING.md,
    marginHorizontal: -SPACING.screenHorizontal,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 8,
    alignItems: 'center',
    paddingVertical: 4,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#000000',
  },
  filterPillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderColor: 'rgba(139, 92, 246, 0.45)',
  },
  filterPillText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#71717A',
    letterSpacing: 0.5,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  calendarPill: {
    width: 36,
    height: 32,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Selected Date Chip ──────────────────── */
  dateChipRow: {
    paddingBottom: SPACING.sm,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  dateChipText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 1,
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
    width: 48,
    height: 82,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
    }),
  },

  /* ── Workout Card (matches Analytics card style) ────────────────────────── */
  cardOuter: {
    height: CARD_INNER_HEIGHT,
    borderRadius: 19,
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
    borderRadius: 19,
  },
  cardGlassEdge: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.md,
    alignItems: 'flex-start',
  },
  cardLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  cardContent: {
    flex: 1,
    gap: 5,
  },
  cardDate: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  cardTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.textTertiary,
  },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  cardRight: {
    alignItems: 'center',
    gap: 12,
    marginLeft: SPACING.md,
  },
  scoreBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderWidth: 1,
    borderColor: COLORS.accent,
    minWidth: 46,
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
    gap: 14,
  },

  /* ── Empty State ─────────────────────────── */
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyStateTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: '#71717A',
    textAlign: 'center',
  },

  /* ── Calendar Modal ──────────────────────── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarContainer: {
    ...CARD_STYLE,
    borderRadius: 24,
    padding: SPACING.xl,
    width: '88%',
    maxWidth: 380,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 30,
      },
      android: { elevation: 12 },
    }),
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  calendarNavButton: {
    fontSize: 28,
    fontFamily: FONTS.display.medium,
    color: COLORS.accent,
    paddingHorizontal: 12,
  },
  calendarTitle: {
    fontSize: 16,
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
    color: '#52525B',
    width: 40,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: SPACING.lg,
  },
  calendarDay: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },
    }),
  },
  calendarDayText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: '#FFFFFF',
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontFamily: FONTS.ui.bold,
  },
  calendarCloseButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 19,
    paddingVertical: 14,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  calendarCloseButtonText: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  /* ── Dropdown Bottom Sheet ──────────────── */
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  dropdownSheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 40,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.25,
        shadowRadius: 30,
      },
      android: { elevation: 12 },
    }),
  },
  dropdownHandleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dropdownHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  dropdownTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#A1A1AA',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 14,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginHorizontal: 20,
  },
  dropdownScroll: {
    maxHeight: 340,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  dropdownItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    marginVertical: 2,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  dropdownItemText: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: '#A1A1AA',
  },
  dropdownItemTextActive: {
    color: '#FFFFFF',
    fontFamily: FONTS.display.semibold,
  },
  dropdownCheckWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
