/**
 * TimeRangeSelector — segmented control for analytics time range.
 * Active segment is a purple pill; inactive segments are subtle text.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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

const Tab = memo(({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) => {
  if (isActive) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.tabActiveOuter}>
        <LinearGradient
          colors={['#7C5CFF', '#6746E8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.tabActive}
        >
          <Text style={styles.tabTextActive}>{label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.tab}>
      <Text style={styles.tabText}>{label}</Text>
    </TouchableOpacity>
  );
});

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
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    marginTop: 0,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActiveOuter: {
    flex: 1,
    borderRadius: 7,
    overflow: 'hidden',
  },
  tabActive: {
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
  tabTextActive: {
    fontFamily: FONTS.display.bold,
    fontSize: 10.5,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
