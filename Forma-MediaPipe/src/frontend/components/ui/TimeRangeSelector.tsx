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

const Pill = memo(({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) => (
  <TouchableOpacity
    style={[styles.pill, isActive && styles.pillActive]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{label}</Text>
  </TouchableOpacity>
));

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = memo(({ options, selected, onSelect }) => {
  const handleSelect = useCallback((value: string) => {
    onSelect(value);
  }, [onSelect]);

  return (
    <View style={styles.container}>
      {options.map((opt) => (
        <Pill
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
    gap: 6,
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    padding: 3,
  },
  pill: {
    flex: 1,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  pillText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: '#71717A',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
});
