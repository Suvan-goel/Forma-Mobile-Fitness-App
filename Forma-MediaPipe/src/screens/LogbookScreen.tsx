import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import { ChevronRight, Clock, Dumbbell, Zap, ChevronDown, Calendar, Target } from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { getWorkouts, SavedWorkout } from '../services/workoutStorage';

// Dropdown Pill Component
const DropdownPill = ({ 
  label, 
  options, 
  selectedValue, 
  onSelect 
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
        style={[styles.tabPill, selectedValue && styles.tabPillActive]} 
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        <Text 
          style={[styles.tabPillText, selectedValue && styles.tabPillTextActive]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {displayValue}
        </Text>
        <ChevronDown size={14} color={selectedValue ? COLORS.text : COLORS.textSecondary} style={{ marginLeft: 4, flexShrink: 0 }} />
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          <View style={styles.dropdownMenu}>
            {options.map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.dropdownItem,
                  selectedValue === option && styles.dropdownItemActive
                ]}
                onPress={() => {
                  onSelect(option);
                  setIsOpen(false);
                }}
              >
                <Text style={[
                  styles.dropdownItemText,
                  selectedValue === option && styles.dropdownItemTextActive
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// Simple Calendar Component
const CalendarModal = ({ 
  visible, 
  onClose, 
  onSelectDate, 
  selectedDate 
}: { 
  visible: boolean; 
  onClose: () => void; 
  onSelectDate: (date: Date) => void;
  selectedDate: Date | null;
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    // Add all days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };
  
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };
  
  const isSameDay = (date1: Date | null, date2: Date | null) => {
    if (!date1 || !date2) return false;
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
  };
  
  const days = getDaysInMonth(currentMonth);
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.calendarContainer} onStartShouldSetResponder={() => true}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={() => navigateMonth('prev')}>
              <Text style={styles.calendarNavButton}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.calendarTitle}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </Text>
            <TouchableOpacity onPress={() => navigateMonth('next')}>
              <Text style={styles.calendarNavButton}>›</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.calendarDaysHeader}>
            {dayNames.map(day => (
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
                  !day && styles.calendarDayEmpty
                ]}
                onPress={() => day && onSelectDate(day)}
                disabled={!day}
              >
                {day && (
                  <Text style={[
                    styles.calendarDayText,
                    isSameDay(day, selectedDate) && styles.calendarDayTextSelected
                  ]}>
                    {day.getDate()}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
          
          <TouchableOpacity 
            style={styles.calendarCloseButton}
            onPress={onClose}
          >
            <Text style={styles.calendarCloseButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

interface WorkoutSession {
  id: string;
  name: string;
  date: string;
  fullDate: Date;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
  effortScore: number;
  category?: string;
}

const mockWorkoutSessions: WorkoutSession[] = [
  {
    id: '1',
    name: 'Push Day - Strength',
    date: 'Oct 24',
    fullDate: new Date(2024, 9, 24), // October 24, 2024
    duration: '45 min',
    totalSets: 15,
    totalReps: 120,
    formScore: 87,
    effortScore: 92,
  },
  {
    id: '2',
    name: 'Leg Hypertrophy',
    date: 'Oct 22',
    fullDate: new Date(2024, 9, 22), // October 22, 2024
    duration: '60 min',
    totalSets: 18,
    totalReps: 210,
    formScore: 85,
    effortScore: 88,
  },
  {
    id: '3',
    name: 'Full Body Circuit',
    date: 'Oct 20',
    fullDate: new Date(2024, 9, 20), // October 20, 2024
    duration: '35 min',
    totalSets: 12,
    totalReps: 300,
    formScore: 82,
    effortScore: 85,
  },
  {
    id: '4',
    name: 'Morning Mobility',
    date: 'Oct 18',
    fullDate: new Date(2024, 9, 18), // October 18, 2024
    duration: '20 min',
    totalSets: 8,
    totalReps: 50,
    formScore: 75,
    effortScore: 70,
  },
  {
    id: '5',
    name: 'Upper Body Focus',
    date: 'Sep 15',
    fullDate: new Date(2024, 8, 15), // September 15, 2024
    duration: '50 min',
    totalSets: 16,
    totalReps: 180,
    formScore: 90,
    effortScore: 88,
  },
  {
    id: '6',
    name: 'Cardio Blast',
    date: 'Sep 10',
    fullDate: new Date(2024, 8, 10), // September 10, 2024
    duration: '30 min',
    totalSets: 10,
    totalReps: 200,
    formScore: 78,
    effortScore: 85,
  },
];

interface WorkoutCardProps {
  session: WorkoutSession;
}

// Get category color and display name
const getCategoryInfo = (category?: string): { color: string; name: string } | null => {
  if (!category) return null;
  
  const categoryMap: { [key: string]: { color: string; name: string } } = {
    'Weightlifting': { color: COLORS.primary, name: 'Weightlifting' },
    'Calisthenics': { color: COLORS.orange, name: 'Calisthenics' },
    'Mobility & Flexibility': { color: '#8B5CF6', name: 'Mobility & Flexibility' },
    'Sport': { color: '#10B981', name: 'Sport' },
  };
  
  return categoryMap[category] || null;
};

const WorkoutCard: React.FC<WorkoutCardProps> = ({ session }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const categoryInfo = getCategoryInfo(session.category);
  
  const handlePress = () => {
    navigation.navigate('WorkoutDetails', { workoutId: session.id });
  };

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={handlePress}>
      <View style={styles.cardContent}>
        {/* Date */}
        <Text style={styles.dateText}>
          {session.date} {session.fullDate.getFullYear()}
        </Text>

        {/* Workout Info */}
        <Text style={styles.workoutName}>{session.name}</Text>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Dumbbell size={14} color={COLORS.textSecondary} />
            <Text style={styles.statText}>{session.totalSets} sets</Text>
          </View>
          <View style={styles.statItem}>
            <Clock size={14} color={COLORS.textSecondary} />
            <Text style={styles.statText}>{session.duration}</Text>
          </View>
          <View style={styles.statItem}>
            <Target size={14} color={COLORS.primary} />
            <MonoText style={styles.scoreText}>{session.formScore}</MonoText>
          </View>
          <View style={styles.statItem}>
            <Zap size={14} color={COLORS.primary} />
            <MonoText style={styles.scoreText}>{session.effortScore}</MonoText>
          </View>
        </View>
      </View>

      {/* Chevron */}
      <ChevronRight size={20} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );
};

export const LogbookScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Refresh workouts when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      // Force re-render by updating refresh key
      setRefreshKey(prev => prev + 1);
    }, [])
  );

  // Get all workouts (saved + mock) - helper function
  const getAllWorkouts = () => {
    const savedWorkouts: WorkoutSession[] = getWorkouts().map(workout => ({
      id: workout.id,
      name: workout.name,
      date: workout.date,
      fullDate: workout.fullDate,
      duration: workout.duration,
      totalSets: workout.totalSets,
      totalReps: workout.totalReps,
      formScore: workout.formScore,
      effortScore: workout.effortScore,
      category: workout.category,
    }));
    
    // Merge and sort by date (most recent first)
    return [...savedWorkouts, ...mockWorkoutSessions].sort((a, b) => 
      b.fullDate.getTime() - a.fullDate.getTime()
    );
  };

  // Get unique years, months, and weeks from workout sessions
  const getUniqueYears = () => {
    const allWorkouts = getAllWorkouts();
    const years = new Set(allWorkouts.map(session => session.fullDate.getFullYear().toString()));
    return ['All', ...Array.from(years).sort((a, b) => parseInt(b) - parseInt(a))];
  };

  const getUniqueMonths = () => {
    const allWorkouts = getAllWorkouts();
    const months = new Set(allWorkouts.map(session => {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];
      return `${monthNames[session.fullDate.getMonth()]} ${session.fullDate.getFullYear()}`;
    }));
    const sortedMonths = Array.from(months).sort((a, b) => {
      const [monthA, yearA] = a.split(' ');
      const [monthB, yearB] = b.split(' ');
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];
      const yearDiff = parseInt(yearB) - parseInt(yearA);
      if (yearDiff !== 0) return yearDiff;
      return monthNames.indexOf(monthB) - monthNames.indexOf(monthA);
    });
    return ['All', ...sortedMonths];
  };

  const getUniqueWeeks = () => {
    const allWorkouts = getAllWorkouts();
    const weeks = new Set(allWorkouts.map(session => {
      const date = session.fullDate;
      const startOfWeek = new Date(date);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[startOfWeek.getMonth()]} ${startOfWeek.getDate()} - ${monthNames[endOfWeek.getMonth()]} ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;
    }));
    const sortedWeeks = Array.from(weeks).sort((a, b) => {
      const yearA = parseInt(a.split(', ')[1]);
      const yearB = parseInt(b.split(', ')[1]);
      return yearB - yearA;
    });
    return ['All', ...sortedWeeks];
  };

  // Filter workouts based on selected filters
  const getFilteredWorkouts = () => {
    let filtered = getAllWorkouts();
    
    // If a specific date is selected, filter by that date only
    if (selectedDate) {
      filtered = filtered.filter(session => {
        const sessionDate = session.fullDate;
        return sessionDate.getDate() === selectedDate.getDate() &&
               sessionDate.getMonth() === selectedDate.getMonth() &&
               sessionDate.getFullYear() === selectedDate.getFullYear();
      });
      return filtered;
    }
    
    // Otherwise, apply year/month/week filters
    return filtered.filter(session => {
      if (selectedYear && session.fullDate.getFullYear().toString() !== selectedYear) {
        return false;
      }
      if (selectedMonth) {
        const [monthName, year] = selectedMonth.split(' ');
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                           'July', 'August', 'September', 'October', 'November', 'December'];
        if (session.fullDate.getMonth() !== monthNames.indexOf(monthName) || 
            session.fullDate.getFullYear().toString() !== year) {
          return false;
        }
      }
      if (selectedWeek) {
        const date = session.fullDate;
        const startOfWeek = new Date(date);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const weekString = `${monthNames[startOfWeek.getMonth()]} ${startOfWeek.getDate()} - ${monthNames[endOfWeek.getMonth()]} ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;
        if (weekString !== selectedWeek) {
          return false;
        }
      }
      return true;
    });
  };

  const filteredWorkouts = getFilteredWorkouts();
  const totalWorkouts = filteredWorkouts.length;
  const totalReps = filteredWorkouts.reduce((sum, session) => sum + session.totalReps, 0);

  const handleFilterChange = (type: 'year' | 'month' | 'week', value: string | null) => {
    // If "All" is selected, set the filter to null
    const filterValue = value === 'All' ? null : value;
    
    let newYear = selectedYear;
    let newMonth = selectedMonth;
    let newWeek = selectedWeek;
    
    if (type === 'year') {
      newYear = filterValue;
      newMonth = null;
      newWeek = null;
    } else if (type === 'month') {
      newMonth = filterValue;
      newWeek = null;
    } else if (type === 'week') {
      newWeek = filterValue;
    }
    
    setSelectedYear(newYear);
    setSelectedMonth(newMonth);
    setSelectedWeek(newWeek);
    setSelectedDate(null); // Clear date selection when using other filters
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedWeek(null);
    setIsCalendarOpen(false);
  };

  const handleCalendarIconPress = () => {
    setIsCalendarOpen(true);
  };

  const formatSelectedDate = () => {
    if (!selectedDate) return null;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[selectedDate.getMonth()]} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`;
  };

  return (
    <View style={styles.container}>
      {/* Filter Pills */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        scrollEnabled={true}
        bounces={false}
        contentContainerStyle={styles.tabsContainer}
        style={styles.tabsScrollView}
        nestedScrollEnabled={false}
      >
        <TouchableOpacity 
          style={[styles.calendarIconButton, selectedDate && styles.calendarIconButtonActive]}
          onPress={handleCalendarIconPress}
          activeOpacity={0.7}
        >
          <Calendar size={18} color={selectedDate ? COLORS.text : COLORS.textSecondary} />
        </TouchableOpacity>
        <DropdownPill
          label="Year"
          options={getUniqueYears()}
          selectedValue={selectedYear}
          onSelect={(value) => handleFilterChange('year', value)}
        />
        <DropdownPill
          label="Month"
          options={getUniqueMonths()}
          selectedValue={selectedMonth}
          onSelect={(value) => handleFilterChange('month', value)}
        />
        <DropdownPill
          label="Week"
          options={getUniqueWeeks()}
          selectedValue={selectedWeek}
          onSelect={(value) => handleFilterChange('week', value)}
        />
      </ScrollView>

      {/* Selected Date Display */}
      {selectedDate && (
        <View style={styles.selectedDateContainer}>
          <Text style={styles.selectedDateText}>
            Showing workouts for {formatSelectedDate()}
          </Text>
          <TouchableOpacity 
            onPress={() => {
              setSelectedDate(null);
              setSelectedYear(null);
              setSelectedMonth(null);
              setSelectedWeek(null);
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.clearDateText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Calendar Modal */}
      <CalendarModal
        visible={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        onSelectDate={handleDateSelect}
        selectedDate={selectedDate}
      />

      {/* Workout Sessions List or Empty State */}
      {filteredWorkouts.length === 0 ? (
        <View style={[styles.emptyState, selectedDate && styles.emptyStateWithDate]}>
          <Text style={styles.emptyStateText}>
            {selectedDate 
              ? `No workouts completed on ${formatSelectedDate()}`
              : 'No workouts found'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredWorkouts}
          renderItem={({ item }) => <WorkoutCard session={item} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            selectedDate && styles.listContentWithDate,
            {
              paddingBottom: 200,
            },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  tabsScrollView: {
    height: 48,
    marginBottom: SPACING.lg,
    zIndex: 1,
    overflow: 'hidden',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 8,
    alignItems: 'center',
    height: 48,
    paddingTop: 4,
    paddingBottom: 4,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackground,
    flexShrink: 0,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 80,
  },
  tabPillActive: {
    backgroundColor: COLORS.cardBackground,
    borderColor: COLORS.primary,
  },
  tabPillText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  tabPillTextActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
  calendarIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  calendarIconButtonActive: {
    backgroundColor: COLORS.cardBackground,
    borderColor: COLORS.primary,
  },
  selectedDateContainer: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    zIndex: 10,
    backgroundColor: COLORS.background,
  },
  selectedDateText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  clearDateText: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownMenu: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    padding: 8,
    minWidth: 200,
    maxHeight: 300,
  },
  dropdownItem: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 12,
    borderRadius: 12,
  },
  dropdownItemActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  dropdownItemText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  dropdownItemTextActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
  calendarContainer: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 24,
    padding: SPACING.lg,
    width: '90%',
    maxWidth: 400,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  calendarNavButton: {
    fontSize: 24,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  calendarTitle: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  calendarDaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.sm,
  },
  calendarDayHeader: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
    width: 40,
    textAlign: 'center',
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
    margin: 4,
  },
  calendarDayEmpty: {
    opacity: 0,
  },
  calendarDaySelected: {
    backgroundColor: COLORS.primary,
  },
  calendarDayText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  calendarDayTextSelected: {
    color: COLORS.background,
    fontFamily: FONTS.ui.bold,
  },
  calendarCloseButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  calendarCloseButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.background,
  },
  emptyStateWithDate: {
    paddingTop: 60,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  summaryContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: SPACING.lg,
  },
  summaryCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.screenHorizontal,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    letterSpacing: 1,
  },
  summaryValue: {
    fontSize: 32,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
  },
  summaryDivider: {
    width: 1,
    height: 50,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.md,
  },
  listContentWithDate: {
    paddingTop: 60,
  },
  listContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    gap: 8,
  },
  card: {
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardContent: {
    flex: 1,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  dateText: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  categoryTag: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  categoryTagText: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  workoutName: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  scoreText: {
    fontSize: 13,
    fontFamily: FONTS.mono.bold,
    color: COLORS.primary,
  },
});
