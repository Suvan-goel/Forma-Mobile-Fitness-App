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
  Settings,
  X,
} from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS, CARD_STYLE, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { getWorkouts } from '../services/workoutStorage';
import { useScroll } from '../contexts/ScrollContext';
import { useWorkouts } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { WorkoutSession } from '../services/api';

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
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsOpen(false)}>
          <View style={styles.dropdownMenu}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {options.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.dropdownItem, selectedValue === option && styles.dropdownItemActive]}
                  onPress={() => { onSelect(option); setIsOpen(false); }}
                >
                  <Text style={[styles.dropdownItemText, selectedValue === option && styles.dropdownItemTextActive]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
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
}

/** Card height = content (~74px) + increased top/bottom padding (20px) + horizontal padding (16px); gap for getItemLayout */
const CARD_INNER_HEIGHT = 114;
const CARD_GAP = 14;
const ITEM_HEIGHT = CARD_INNER_HEIGHT + CARD_GAP;

const WorkoutCard: React.FC<WorkoutCardProps> = memo(({ session }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handlePress = useCallback(() => {
    navigation.navigate('WorkoutDetails', { workoutId: session.id });
  }, [navigation, session.id]);

  return (
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
                  <Text style={styles.metaText}>{session.totalSets} SETS</Text>
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
  );
}, (prev, next) => prev.session.id === next.session.id && prev.session.formScore === next.session.formScore);

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

  const { workouts: mockWorkoutSessions, isLoading, error, refetch } = useWorkouts();

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

  const getAllWorkouts = () => {
    const savedWorkouts: WorkoutSession[] = getWorkouts().map((w) => ({
      id: w.id, name: w.name, date: w.date, fullDate: w.fullDate,
      duration: w.duration, totalSets: w.totalSets, totalReps: w.totalReps,
      formScore: w.formScore, category: w.category,
    }));
    return [...savedWorkouts, ...mockWorkoutSessions].sort((a, b) => b.fullDate.getTime() - a.fullDate.getTime());
  };

  const getUniqueYears = () => {
    const years = new Set(getAllWorkouts().map((s) => s.fullDate.getFullYear().toString()));
    return ['All', ...Array.from(years).sort((a, b) => parseInt(b) - parseInt(a))];
  };

  const getUniqueMonths = () => {
    const months = new Set(
      getAllWorkouts().map((s) => `${MONTH_NAMES[s.fullDate.getMonth()]} ${s.fullDate.getFullYear()}`),
    );
    const sorted = Array.from(months).sort((a, b) => {
      const [mA, yA] = a.split(' ');
      const [mB, yB] = b.split(' ');
      const yd = parseInt(yB) - parseInt(yA);
      return yd !== 0 ? yd : MONTH_NAMES.indexOf(mB) - MONTH_NAMES.indexOf(mA);
    });
    return ['All', ...sorted];
  };

  const getUniqueWeeks = () => {
    const weeks = new Set(
      getAllWorkouts().map((s) => {
        const d = s.fullDate;
        const start = new Date(d);
        const day = start.getDay();
        start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} - ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      }),
    );
    const sorted = Array.from(weeks).sort((a, b) => parseInt(b.split(', ')[1]) - parseInt(a.split(', ')[1]));
    return ['All', ...sorted];
  };

  const getFilteredWorkouts = () => {
    let filtered = getAllWorkouts();
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
        const ws = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} - ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
        if (ws !== selectedWeek) return false;
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

  const renderWorkoutCard = useCallback(({ item }: { item: WorkoutSession }) => (
    <WorkoutCard session={item} />
  ), []);

  const keyExtractor = useCallback((item: WorkoutSession) => item.id, []);

  const handleSettingsPress = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  /* ── ListHeaderComponent — everything scrolls together ── */

  const ListHeader = useCallback(() => (
    <View>
      {/* ── WELCOME ROW ──────────────────────── */}
      <View style={styles.welcomeRow}>
        <View style={styles.welcomeLeft}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.welcomeLabel}>Welcome back,</Text>
            <Text style={styles.welcomeName}>Athlete</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress} activeOpacity={0.7}>
          <Settings size={20} color={COLORS.text} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* ── LOGBOOK TITLE ────────────────────── */}
      <View style={styles.titleBlock}>
        <Text style={styles.headerTitle}>LOGBOOK</Text>
        <Text style={styles.headerDate}>{formatHeaderDate()}</Text>
      </View>

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
  ), [selectedYear, selectedMonth, selectedWeek, selectedDate, handleSettingsPress]);

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
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Calendar Modal (rendered outside FlatList, portaled via Modal) */}
        <CalendarModal
          visible={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
          onSelectDate={handleDateSelect}
          selectedDate={selectedDate}
        />

        {filteredWorkouts.length === 0 ? (
          /* Empty state — still show header via ScrollView */
          <ScrollView
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: SPACING.screenHorizontal }}
          >
            <ListHeader />
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>
                {selectedDate ? 'No sessions' : 'No workouts yet'}
              </Text>
              <Text style={styles.emptyStateText}>
                {selectedDate
                  ? `Nothing recorded on ${formatSelectedDate()}`
                  : 'Complete a workout to see it here'}
              </Text>
            </View>
          </ScrollView>
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

  /* ── Welcome Row ─────────────────────────── */
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: SPACING.sm,
  },
  welcomeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  welcomeLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#A1A1AA',
  },
  welcomeName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Title Block ─────────────────────────── */
  titleBlock: {
    paddingTop: 8,
    paddingBottom: 20,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3F3F46',
    backgroundColor: '#000000',
  },
  filterPillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 14,
      },
      android: { elevation: 8 },
    }),
  },
  filterPillText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#71717A',
    letterSpacing: 0.5,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontFamily: FONTS.ui.bold,
  },
  calendarPill: {
    width: 36,
    height: 32,
    borderRadius: 16,
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

  /* ── Workout Card (matches Analytics card style) ────────────────────────── */
  cardOuter: {
    height: CARD_INNER_HEIGHT,
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
    paddingVertical: SPACING.lg,
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
    paddingTop: 60,
  },
  emptyStateTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 8,
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
    borderRadius: 16,
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

  /* ── Dropdown Menu ───────────────────────── */
  dropdownMenu: {
    ...CARD_STYLE,
    borderRadius: 20,
    padding: 8,
    minWidth: 200,
    maxWidth: 320,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  dropdownItemText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: '#FFFFFF',
  },
  dropdownItemTextActive: {
    color: '#FFFFFF',
    fontFamily: FONTS.ui.bold,
  },
});
