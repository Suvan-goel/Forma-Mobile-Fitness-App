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
    <View style={styles.wrap}>
      <View style={styles.container}>
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab.key;
          return (
            <React.Fragment key={tab.key}>
              {index > 0 && <View style={styles.divider} />}
              <TouchableOpacity
                onPress={() => onTabChange(tab.key)}
                style={[styles.tab, isActive && styles.tabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.screenHorizontal,
    marginBottom: 10,
    marginTop: 4,
  },
  container: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.028)',
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(255,255,255,0.065)',
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.accent,
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
