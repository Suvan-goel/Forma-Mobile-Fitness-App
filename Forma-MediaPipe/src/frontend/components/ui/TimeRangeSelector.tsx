/**
 * TimeRangeSelector — horizontal pill bar for selecting analytics time range.
 * Follows the FilterPill pattern from ChooseExerciseScreen.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
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
    gap: 8,
    marginBottom: 20,
  },
  pill: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.accent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  pillText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: COLORS.textSecondary,
  },
  pillTextActive: {
    color: '#000000',
  },
});
