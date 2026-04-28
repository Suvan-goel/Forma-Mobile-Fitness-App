/**
 * TimeRangeSelector — horizontal pill bar for selecting analytics time range.
 * Follows the FilterPill pattern from ChooseExerciseScreen.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';

interface TimeRangeOption {
  label: string;
  value: string;
}

interface TimeRangeSelectorProps {
  options: TimeRangeOption[];
  selected: string;
  onSelect: (value: string) => void;
}

const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { label: '1W', value: '1 week' },
  { label: '1M', value: '4 weeks' },
  { label: '3M', value: '3 months' },
  { label: '1Y', value: 'Year' },
  { label: 'ALL', value: 'All Time' },
];

const Tab = memo(({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) => (
  <TouchableOpacity
    style={styles.tab}
    onPress={onPress}
    activeOpacity={0.7}
  >
    {isActive && <View style={styles.underline} />}
    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
));

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = memo(({ options, selected, onSelect }) => {
  const handleSelect = useCallback((value: string) => {
    onSelect(value);
  }, [onSelect]);

  return (
    <View style={styles.container}>
      {options.map((opt) => (
        <Tab
          key={opt.value}
          label={opt.label}
          isActive={selected === opt.value}
          onPress={() => handleSelect(opt.value)}
        />
      ))}
    </View>
  );
});

export { TIME_RANGE_OPTIONS };

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.085)',
    backgroundColor: 'rgba(9,14,18,0.25)',
    padding: 3,
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11.5,
    color: COLORS.textSecondary,
    letterSpacing: 0,
    zIndex: 1,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  underline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 6,
    backgroundColor: '#7C5CFF',
    opacity: 0.86,
  },
});
