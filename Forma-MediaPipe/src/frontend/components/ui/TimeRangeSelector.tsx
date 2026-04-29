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
    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
    {isActive && <View style={styles.underline} />}
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
    justifyContent: 'space-evenly',
    marginBottom: 10,
    marginTop: 12,
    gap: 20,
  },
  tab: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  underline: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },
});
