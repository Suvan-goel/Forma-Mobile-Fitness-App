/**
 * TimeRangeSelector — segmented control for analytics time range.
 * Active segment is a purple pill; inactive segments are subtle text.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_END,
  CARD_GRADIENT_START,
  CARD_RADIUS,
  CARD_SHADOW,
  CARD_VERTICAL_GAP,
  COLORS,
  FONTS,
} from '../../constants/theme';

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
          colors={['#7A55FF', '#633FE5']}
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
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.gradient}
      >
        <View style={styles.edge}>
          {options.map((opt) => (
            <Tab
              key={opt.value}
              label={opt.label}
              isActive={selected === opt.value}
              onPress={() => handleSelect(opt.value)}
            />
          ))}
        </View>
      </LinearGradient>
    </View>
  );
});

export { TIME_RANGE_OPTIONS };

const styles = StyleSheet.create({
  container: {
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
    marginTop: 0,
    ...CARD_SHADOW,
  },
  gradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  edge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderTopColor: COLORS.borderStrong,
    borderRadius: CARD_RADIUS,
    padding: 3,
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
    fontFamily: FONTS.display.regular,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
