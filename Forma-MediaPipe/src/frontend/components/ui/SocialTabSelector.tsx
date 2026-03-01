/**
 * SocialTabSelector — Pill-style tab bar for Social section
 */

import React, { memo, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
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
  const slideAnim = useRef(new Animated.Value(TABS.findIndex(t => t.key === activeTab))).current;

  useEffect(() => {
    const index = TABS.findIndex(t => t.key === activeTab);
    Animated.spring(slideAnim, {
      toValue: index,
      useNativeDriver: true,
      tension: 300,
      friction: 30,
    }).start();
  }, [activeTab, slideAnim]);

  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={[styles.pill, isActive && styles.pillActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
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
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    backgroundColor: 'transparent',
  },
  pillActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  label: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  labelActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});
