/**
 * SocialTabSelector — Pill-style tab bar for Social section
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

export type SocialTab = 'activity' | 'friends';

interface SocialTabSelectorProps {
  activeTab: SocialTab;
  onTabChange: (tab: SocialTab) => void;
}

const TABS: { key: SocialTab; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'friends', label: 'Friends' },
];

export const SocialTabSelector: React.FC<SocialTabSelectorProps> = memo(({ activeTab, onTabChange }) => {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={styles.tab}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {isActive && <View style={styles.underline} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginBottom: 12,
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
