/**
 * SocialTabSelector — Segmented tab bar for Social section
 *
 * Clean underline-style selector matching the app's cyber-minimalist design.
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

export type SocialTab = 'leaderboard' | 'friends' | 'activity';

interface SocialTabSelectorProps {
  activeTab: SocialTab;
  onTabChange: (tab: SocialTab) => void;
}

const TABS: { key: SocialTab; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'friends', label: 'Friends' },
  { key: 'activity', label: 'Activity' },
];

export const SocialTabSelector: React.FC<SocialTabSelectorProps> = memo(({ activeTab, onTabChange }) => {
  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={styles.tab}
              activeOpacity={0.7}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
              <View style={[styles.indicator, isActive && styles.indicatorActive]} />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.bottomBorder} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  tabRow: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  label: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  labelActive: {
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
  },
  indicator: {
    height: 2,
    width: '60%',
    borderRadius: 1,
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: COLORS.primary,
  },
  bottomBorder: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});
