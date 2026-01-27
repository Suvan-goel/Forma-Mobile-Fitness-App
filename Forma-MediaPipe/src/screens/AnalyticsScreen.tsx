import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Dimensions, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Activity, Flame, Droplet, Dumbbell, Target, Zap, TrendingUp, ChevronRight, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react-native';
import { MonoText } from '../components/typography/MonoText';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';

// Circular Progress Component
const CircularProgress = ({ size, strokeWidth, progress, icon: Icon }: { size: number; strokeWidth: number; progress: number; icon: any }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.border}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.yellow}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ backgroundColor: COLORS.cardBackgroundLight, borderRadius: 25, padding: 10 }}>
        <Icon size={20} color={COLORS.text} />
      </View>
    </View>
  );
};

// Time Range Dropdown Component
const TimeRangeDropdown = ({ 
  selectedValue, 
  onSelect 
}: { 
  selectedValue: string; 
  onSelect: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const options = ['1 week', '4 weeks', '3 months', '6 months', 'Year'];

  return (
    <>
      <TouchableOpacity 
        style={styles.timeRangeDropdown} 
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.timeRangeDropdownText}>{selectedValue}</Text>
        <ChevronDown size={16} color={COLORS.textSecondary} style={{ marginLeft: 8 }} />
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

// Get color for day of week (fully opaque)
const getDayColor = (date: Date): string => {
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const dayColors: { [key: number]: string } = {
    0: '#EC4899', // Sunday - Pink/Magenta
    1: '#F59E0B', // Monday - Orange/Amber
    2: '#10B981', // Tuesday - Green
    3: '#00D4BB', // Wednesday - Teal (primary)
    4: '#8B5CF6', // Thursday - Purple
    5: '#EF4444', // Friday - Red
    6: '#3B82F6', // Saturday - Blue
  };
  return dayColors[day] || '#00D4BB';
};

// Score Chart Component (Form, Effort, Consistency)
const ScoreChart = ({ 
  title, 
  initialValue, 
  icon: Icon, 
  data,
  dates
}: { 
  title: string; 
  initialValue: number; 
  icon: any;
  data: number[];
  dates?: Date[];
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  
  // Safety check: ensure data exists
  if (!data || data.length === 0) {
    return (
      <View style={styles.chartCard}>
        <Text style={styles.chartCardTitleText}>No data available</Text>
      </View>
    );
  }
  
  const [selectedIndex, setSelectedIndex] = React.useState(Math.max(0, data.length - 1));
  const scrollViewRef = React.useRef<ScrollView>(null);
  const height = 80;
  const screenWidth = Dimensions.get('window').width;
  const maxValue = 100;
  const minValue = 0;
  const range = maxValue - minValue;
  
  // Calculate width based on data points
  // Ensure it's always wider than screen width for scrollability, but don't allow scrolling past last point
  const minWidthPerPoint = 12; // Increased spacing for better visibility
  const calculatedBaseWidth = data.length * minWidthPerPoint;
  // Base width should be at least screen width to ensure scrolling is possible
  const baseWidth = Math.max(screenWidth + 100, calculatedBaseWidth);
  // No end padding - width is exactly the baseWidth so we can't scroll past the last point
  const width = baseWidth;
  
  // Scroll to show the last data point on mount (but not past it)
  React.useEffect(() => {
    if (data.length > 0 && scrollViewRef.current) {
      setTimeout(() => {
        // Calculate scroll position to show the last point
        // If width is greater than screen width, scroll to show the end
        // Otherwise, stay at the beginning (no scrolling needed)
        if (width > screenWidth) {
          const scrollToX = width - screenWidth + 100; // Show last point with some margin
          scrollViewRef.current?.scrollTo({ x: scrollToX, animated: false });
        } else {
          scrollViewRef.current?.scrollTo({ x: 0, animated: false });
        }
      }, 100);
    }
  }, [data.length, width, screenWidth]);
  
  // Convert data points to path coordinates
  // Points are distributed across the full width
  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((val - minValue) / range) * height;
    return { x, y, value: val };
  });
  
  const pathData = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
  
  // Get the selected point for highlighting
  const selectedPoint = points[selectedIndex] || points[points.length - 1] || { x: 0, y: 0, value: 0 };
  const selectedX = selectedPoint.x;
  const selectedY = selectedPoint.y;
  const displayValue = selectedPoint.value;
  
  const [scrollX, setScrollX] = React.useState(0);
  
  // Format date for display
  const formatDate = (date: Date): string => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  };
  
  const handleChartPress = (event: any) => {
    const { locationX } = event.nativeEvent;
    // Account for scroll position
    const touchX = scrollX + locationX;
    
    // Find the closest data point
    let closestIndex = 0;
    let minDistance = Math.abs(points[0].x - touchX);
    
    points.forEach((point, index) => {
      const distance = Math.abs(point.x - touchX);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });
    
    setSelectedIndex(closestIndex);
  };
  
  const handleScroll = (event: any) => {
    setScrollX(event.nativeEvent.contentOffset.x);
  };
  
  // Get selected date for display
  const selectedDate = dates && dates[selectedIndex] ? dates[selectedIndex] : new Date();
  
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartCardHeader}>
        <View style={styles.chartCardTitle}>
          <View style={styles.chartIconContainer}>
            <Icon size={18} color={COLORS.text} />
          </View>
          <Text style={styles.chartCardTitleText}>{title}</Text>
        </View>
        <View style={styles.chartCardValue}>
          <MonoText style={styles.chartValueText}>{displayValue}</MonoText>
          <Text style={styles.chartValueUnit}>/100</Text>
        </View>
      </View>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chartScrollContainer}
        contentContainerStyle={styles.chartScrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
      >
        <View>
          <TouchableOpacity 
            activeOpacity={1}
            onPress={handleChartPress}
          >
            <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={`gradient-${title}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.3" />
                <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {/* Gradient fill area */}
            <Path
              d={`${pathData} L ${width},${height} L 0,${height} Z`}
              fill={`url(#gradient-${title})`}
            />
            {/* Line path */}
            <Path
              d={pathData}
              fill="none"
              stroke={COLORS.primary}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Vertical marker line */}
            <Path
              d={`M ${selectedX},0 L ${selectedX},${height}`}
              stroke={COLORS.textSecondary}
              strokeWidth="1"
              strokeOpacity="0.3"
              strokeDasharray="2,2"
            />
            {/* All data points (clickable) */}
            {points.map((point, index) => {
              const pointDate = dates && dates[index] ? dates[index] : new Date();
              return (
                <Circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={index === selectedIndex ? "6" : "4"}
                  fill={COLORS.text}
                  fillOpacity={1}
                  stroke={COLORS.background}
                  strokeWidth={index === selectedIndex ? "2" : "1"}
                />
              );
            })}
          </Svg>
        </TouchableOpacity>
          {/* Date labels on x-axis */}
          <View style={[styles.xAxisContainer, { width: width }]}>
            {points.map((point, index) => {
              // Show date labels for selected point and a few around it, or every Nth point for spacing
              const shouldShowLabel = index === selectedIndex || 
                (index % Math.max(1, Math.floor(data.length / 8)) === 0) ||
                index === 0 || 
                index === data.length - 1;
              
              if (!shouldShowLabel || !dates || !dates[index]) return null;
              
              return (
                <View 
                  key={`label-${index}`} 
                  style={[styles.xAxisLabel, { left: point.x - 25 }]}
                >
                  <Text style={[styles.xAxisText, index === selectedIndex && styles.xAxisTextSelected]}>
                    {formatDate(dates[index])}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      {/* Selected date display */}
      {dates && dates[selectedIndex] && (
        <View style={styles.selectedDateContainer}>
          <Text style={styles.selectedDateText}>
            {formatDate(dates[selectedIndex])} • Score: {displayValue}
          </Text>
        </View>
      )}
      <TouchableOpacity 
        style={styles.insightsButton}
        onPress={() => navigation.navigate('Insights', { metric: title })}
        activeOpacity={0.7}
      >
        <Text style={styles.insightsButtonText}>See {title} Analysis</Text>
        <ChevronRight size={18} color={COLORS.primary} />
      </TouchableOpacity>
    </View>
  );
};

// Improvement Summary Card Component
const ImprovementCard = ({
  title,
  currentValue,
  previousValue,
  icon: Icon
}: {
  title: string;
  currentValue: number;
  previousValue: number;
  icon: any;
}) => {
  const change = currentValue - previousValue;
  const isImproving = change > 0;
  const ArrowIcon = isImproving ? ArrowUp : ArrowDown;
  const changeColor = isImproving ? '#10B981' : '#FF3B30';
  const changePercent = previousValue > 0 ? Math.round((change / previousValue) * 100) : 0;

  return (
    <View style={styles.improvementCard}>
      <View style={styles.improvementCardHeader}>
        <View style={styles.improvementIconContainer}>
          <Icon size={18} color={COLORS.text} />
        </View>
        <Text style={styles.improvementTitle}>{title}</Text>
      </View>
      <View style={styles.improvementValueContainer}>
        <MonoText style={styles.improvementValue}>{currentValue}</MonoText>
        <Text style={styles.improvementUnit}>/100</Text>
      </View>
      <View style={styles.improvementChangeContainer}>
        <ArrowIcon size={14} color={changeColor} />
        <Text style={[styles.improvementChange, { color: changeColor }]}>
          {isImproving ? '+' : ''}{change} ({isImproving ? '+' : ''}{changePercent}%)
        </Text>
        <Text style={styles.improvementLabel}>vs last week</Text>
      </View>
    </View>
  );
};

// Metric Card Component
const MetricCard = ({ 
  title, 
  currentValue, 
  lastWeekValue, 
  icon: Icon, 
  isLarge = false,
  timeRange = '1 week'
}: { 
  title: string; 
  currentValue: number; 
  lastWeekValue: number;
  icon: any; 
  isLarge?: boolean;
  timeRange?: string;
}) => {
  const change = currentValue - lastWeekValue;
  const isImproving = change > 0;
  const ArrowIcon = isImproving ? ArrowUp : ArrowDown;
  const changeColor = isImproving ? COLORS.primary : '#FF3B30';
  
  const getComparisonLabel = () => {
    switch (timeRange) {
      case '1 week':
        return 'vs last week';
      case '4 weeks':
        return 'vs 4 weeks ago';
      case '3 months':
        return 'vs 3 months ago';
      case '6 months':
        return 'vs 6 months ago';
      case 'Year':
        return 'vs last year';
      default:
        return 'vs last week';
    }
  };
  
  if (isLarge) {
    return (
      <View style={styles.stepsCard}>
        <View style={styles.stepsHeader}>
          <CircularProgress size={60} strokeWidth={4} progress={currentValue} icon={Icon} />
        </View>
        <View style={styles.changeIndicator}>
          <ArrowIcon size={16} color={changeColor} />
          <Text style={[styles.changeText, { color: changeColor }]}>
            {isImproving ? '+' : ''}{change}
          </Text>
          <Text style={styles.changeLabel}>{getComparisonLabel()}</Text>
        </View>
        <MonoText style={styles.stepsValue}>{currentValue}</MonoText>
        <Text style={styles.stepsSubtext}>{title} Score</Text>
      </View>
    );
  }
  
  return (
    <View style={styles.smallCard}>
      <View style={styles.smallCardHeader}>
        <CircularProgress size={50} strokeWidth={3} progress={currentValue} icon={Icon} />
        <View style={styles.smallCardInfo}>
          <View style={styles.smallCardValueRow}>
            <MonoText style={styles.smallCardValue}>{currentValue}</MonoText>
            <View style={styles.changeIndicatorSmall}>
              <ArrowIcon size={12} color={changeColor} />
              <Text style={[styles.changeTextSmall, { color: changeColor }]}>
                {isImproving ? '+' : ''}{change}
              </Text>
            </View>
          </View>
          <Text style={styles.smallCardLabel}>{title}</Text>
        </View>
      </View>
    </View>
  );
};

// Bar Chart Component - all bars use faded accent green
const BAR_FILL_COLOR = COLORS.primary; // COLORS.primary (#10B981) full opacity

const WorkoutBarChart = ({ onDaySelect }: { onDaySelect?: (dayData: { day: string; value: number; hours: number; minutes: number } | null) => void }) => {
  const [selectedDay, setSelectedDay] = React.useState<number | null>(null);
  
  const data = [
    { day: 'Mon', value: 60 }, // Monday
    { day: 'Tue', value: 80 }, // Tuesday
    { day: 'Wed', value: 100 }, // Wednesday
    { day: 'Thu', value: 40 }, // Thursday
    { day: 'Fri', value: 70 }, // Friday
    { day: 'Sat', value: 0 }, // Saturday
    { day: 'Sun', value: 0 }, // Sunday
  ];

  // Calculate total workout time in minutes
  const totalMinutes = data.reduce((sum, item) => sum + item.value, 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const handleBarPress = (index: number) => {
    if (selectedDay === index) {
      // Deselect if clicking the same bar
      setSelectedDay(null);
      if (onDaySelect) {
        onDaySelect(null);
      }
    } else {
      setSelectedDay(index);
      const selectedDayData = data[index];
      const selectedDayMinutes = selectedDayData.value;
      const selectedDayHours = Math.floor(selectedDayMinutes / 60);
      const selectedDayMins = selectedDayMinutes % 60;
      if (onDaySelect) {
        onDaySelect({
          day: selectedDayData.day,
          value: selectedDayMinutes,
          hours: selectedDayHours,
          minutes: selectedDayMins,
        });
      }
    }
  };

  return (
    <>
      <View style={styles.barChartContainer}>
        {data.map((item, index) => {
          const isSelected = selectedDay === index;
          return (
            <TouchableOpacity 
              key={index} 
              style={styles.barItem}
              onPress={() => handleBarPress(index)}
              activeOpacity={0.7}
            >
              <View style={styles.barWrapper}>
                <View 
                  style={[
                    styles.bar, 
                    { 
                      height: `${item.value}%`,
                      backgroundColor: item.value > 0 ? BAR_FILL_COLOR : COLORS.chartSecondary,
                      opacity: 1,
                    }
                  ]} 
                />
              </View>
              <Text style={[styles.barLabel, isSelected && styles.barLabelSelected]}>
                {item.day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.workoutDurationTotal}>
        <Text style={styles.workoutDurationTotalText}>
          {hours > 0 ? `${hours} h ` : ''}{minutes} min total this week
        </Text>
      </View>
    </>
  );
};

// Generate data based on time range
const generateDataForTimeRange = (baseData: number[], timeRange: string): { values: number[]; dates: Date[] } => {
  const currentValue = baseData[baseData.length - 1];
  const startValue = baseData[0];
  
  let numPoints: number;
  let daysBack: number;
  switch (timeRange) {
    case '1 week':
      numPoints = 7;
      daysBack = 7;
      break;
    case '4 weeks':
      numPoints = 28;
      daysBack = 28;
      break;
    case '3 months':
      numPoints = 13; // Weekly data for 3 months
      daysBack = 91;
      break;
    case '6 months':
      numPoints = 26; // Weekly data for 6 months
      daysBack = 182;
      break;
    case 'Year':
      numPoints = 52; // Weekly data for a year
      daysBack = 365;
      break;
    default:
      numPoints = 7;
      daysBack = 7;
  }
  
  // Generate data points with gradual progression and realistic variation
  const data: number[] = [];
  const dates: Date[] = [];
  const seed = baseData.reduce((a, b) => a + b, 0); // Use base data to create consistent seed
  const today = new Date();
  
  for (let i = 0; i < numPoints; i++) {
    const progress = i / (numPoints - 1);
    // Create smooth progression with some realistic variation
    const baseProgression = startValue + (currentValue - startValue) * progress;
    // Add wave-like variation for realism (not random, but deterministic based on index)
    const waveVariation = Math.sin((i / numPoints) * Math.PI * 6) * 2;
    const trendVariation = Math.sin((i / numPoints) * Math.PI * 2) * 1.5;
    const value = Math.round(baseProgression + waveVariation + trendVariation);
    data.push(Math.max(0, Math.min(100, value)));
    
    // Generate date for this data point
    const daysAgo = Math.round(daysBack * (1 - progress));
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    dates.push(date);
  }
  
  // Ensure the last value matches the current value
  data[data.length - 1] = currentValue;
  dates[dates.length - 1] = today;
  
  return { values: data, dates };
};

// Get comparison value based on time range (value at the start of the range)
const getComparisonValue = (data: number[], timeRange: string): number => {
  // For all ranges, compare to the first value in the dataset (start of the range)
  return data[0] || 0;
};

export const AnalyticsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = React.useState('1 week');
  const tabBarHeight = 80;

  // Base data for each metric
  const formBaseData = [72, 75, 78, 82, 80, 85, 87];
  const effortBaseData = [68, 72, 75, 80, 85, 88, 92];
  const consistencyBaseData = [65, 70, 68, 72, 75, 78, 79];
  const strengthBaseData = [70, 72, 75, 78, 80, 82, 84];

  // Generate data based on selected time range
  const formDataResult = generateDataForTimeRange(formBaseData, activeTab);
  const effortDataResult = generateDataForTimeRange(effortBaseData, activeTab);
  const consistencyDataResult = generateDataForTimeRange(consistencyBaseData, activeTab);
  const strengthDataResult = generateDataForTimeRange(strengthBaseData, activeTab);
  
  const formData = formDataResult.values;
  const formDates = formDataResult.dates;
  const effortData = effortDataResult.values;
  const effortDates = effortDataResult.dates;
  const consistencyData = consistencyDataResult.values;
  const consistencyDates = consistencyDataResult.dates;
  const strengthData = strengthDataResult.values;
  const strengthDates = strengthDataResult.dates;

  // Get current and comparison values
  const formCurrent = formData[formData.length - 1];
  const formComparison = getComparisonValue(formData, activeTab);
  const effortCurrent = effortData[effortData.length - 1];
  const effortComparison = getComparisonValue(effortData, activeTab);
  const consistencyCurrent = consistencyData[consistencyData.length - 1];
  const consistencyComparison = getComparisonValue(consistencyData, activeTab);

  // Workout Duration Card Component
  const WorkoutDurationCard = () => {
    const [selectedDayData, setSelectedDayData] = React.useState<{ day: string; value: number; hours: number; minutes: number } | null>(null);

    return (
      <View style={styles.chartCard}>
        <View style={styles.chartCardHeader}>
          <View style={styles.chartCardTitle}>
            <Dumbbell size={18} color={COLORS.text} />
            <Text style={styles.chartCardTitleText}>This Week</Text>
          </View>
          <View style={styles.chartCardValue}>
            {selectedDayData && (
              <>
                <MonoText style={styles.chartValueText}>
                  {selectedDayData.hours > 0 ? `${selectedDayData.hours} h ` : ''}{selectedDayData.minutes}
                </MonoText>
                <Text style={styles.chartValueUnit}>min</Text>
              </>
            )}
          </View>
        </View>
        <WorkoutBarChart onDaySelect={setSelectedDayData} />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 200 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Workout Duration Card */}
        <WorkoutDurationCard />

        {/* Improvement Summary Cards */}
        <View style={styles.improvementGrid}>
          <ImprovementCard
            title="Form"
            currentValue={formCurrent}
            previousValue={formComparison}
            icon={Target}
          />
          <ImprovementCard
            title="Effort"
            currentValue={effortCurrent}
            previousValue={effortComparison}
            icon={Zap}
          />
          <ImprovementCard
            title="Consistency"
            currentValue={consistencyCurrent}
            previousValue={consistencyComparison}
            icon={TrendingUp}
          />
          <ImprovementCard
            title="Strength"
            currentValue={strengthData[strengthData.length - 1]}
            previousValue={strengthData[0]}
            icon={Dumbbell}
          />
        </View>

        {/* Time Range Dropdown */}
        <View style={styles.timeRangeContainer}>
          <TimeRangeDropdown 
            selectedValue={activeTab} 
            onSelect={setActiveTab} 
          />
        </View>

        {/* Form Score Chart */}
        <ScoreChart
          title="Form"
          initialValue={formCurrent}
          icon={Target}
          data={formData}
          dates={formDates}
        />

        {/* Effort Score Chart */}
        <ScoreChart
          title="Effort"
          initialValue={effortCurrent}
          icon={Zap}
          data={effortData}
          dates={effortDates}
        />

        {/* Consistency Score Chart */}
        <ScoreChart
          title="Consistency"
          initialValue={consistencyCurrent}
          icon={TrendingUp}
          data={consistencyData}
          dates={consistencyDates}
        />

        {/* Strength Score Chart */}
        <ScoreChart
          title="Strength"
          initialValue={strengthData[strengthData.length - 1]}
          icon={Dumbbell}
          data={strengthData}
          dates={strengthDates}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  tabsScrollContainer: {
    marginBottom: SPACING.lg,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: 8,
    alignItems: 'center', // Vertically center tabs
    minHeight: 40, // Match original tab height
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackground,
  },
  tabPillActive: {
    backgroundColor: COLORS.cardBackgroundLight,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  tabPillText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  tabPillTextActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  stepsCard: {
    flex: 1,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 24,
    padding: SPACING.lg,
  },
  stepsHeader: {
    marginBottom: SPACING.sm,
  },
  stepsChart: {
    marginVertical: SPACING.sm,
  },
  stepsValue: {
    fontSize: 20,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    marginTop: SPACING.sm,
  },
  stepsSubtext: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  changeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginVertical: SPACING.sm,
  },
  changeText: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  changeLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginLeft: 4,
  },
  smallCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  changeIndicatorSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changeTextSmall: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  rightColumn: {
    flex: 1,
    gap: 12,
  },
  smallCard: {
    flex: 1,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 24,
    padding: SPACING.md,
    justifyContent: 'center',
  },
  smallCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  smallCardInfo: {
    flex: 1,
  },
  smallCardValue: {
    fontSize: 16,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
  },
  smallCardLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  chartCard: {
    backgroundColor: 'transparent',
    borderRadius: 24,
    padding: SPACING.lg,
  },
  chartCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    height: 32,
  },
  chartCardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chartIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.cardBackgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartCardTitleText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  chartCardValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingTop: 2,
    minWidth: 80,
    justifyContent: 'flex-end',
  },
  chartValueText: {
    fontSize: 24,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    lineHeight: 28,
  },
  chartValueUnit: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  chartContainer: {
    height: 80,
    marginTop: SPACING.sm,
  },
  chartScrollContainer: {
    height: 100,
    marginTop: SPACING.sm,
  },
  chartScrollContent: {
    minWidth: 300,
  },
  xAxisContainer: {
    position: 'relative',
    height: 20,
    marginTop: 4,
  },
  xAxisLabel: {
    position: 'absolute',
    width: 50,
    alignItems: 'center',
  },
  xAxisText: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  xAxisTextSelected: {
    color: COLORS.primary,
    fontFamily: FONTS.ui.bold,
  },
  selectedDateContainer: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.cardBackgroundLight,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  selectedDateText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  insightsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.cardBackgroundLight,
  },
  insightsButtonText: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
  },
  barChartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    marginTop: SPACING.md,
  },
  barItem: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  barWrapper: {
    width: 24,
    height: 80,
    backgroundColor: COLORS.border,
    borderRadius: 12,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 12,
  },
  barLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  barLabelSelected: {
    color: COLORS.primary,
    fontFamily: FONTS.ui.bold,
  },
  workoutDurationTotal: {
    marginTop: SPACING.md,
    alignItems: 'center',
  },
  workoutDurationTotalText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  improvementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: SPACING.md,
    justifyContent: 'space-between',
    gap: 12,
  },
  improvementCard: {
    width: '48%',
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    padding: SPACING.md,
    paddingTop: SPACING.md + 2,
    gap: 8,
  },
  improvementCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  improvementIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.cardBackgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  improvementTitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  improvementValueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingTop: 2,
  },
  improvementValue: {
    fontSize: 24,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    lineHeight: 28,
  },
  improvementUnit: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  improvementChangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  improvementChange: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
  },
  improvementLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  timeRangeContainer: {
    marginBottom: 0,
    alignItems: 'flex-start',
  },
  timeRangeDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  timeRangeDropdownText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownMenu: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    paddingVertical: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownItem: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  dropdownItemActive: {
    backgroundColor: COLORS.cardBackgroundLight,
  },
  dropdownItemText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  dropdownItemTextActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
});
