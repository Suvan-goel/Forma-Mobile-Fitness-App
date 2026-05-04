/**
 * SocialTabSelector — Pill-style tab bar for Social section
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
                style={styles.tab}
                activeOpacity={0.75}
              >
                {isActive ? (
                  <LinearGradient
                    colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.04)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.tabActive}
                  >
                    <Text style={[styles.tabText, styles.tabTextActive]}>
                      {tab.label}
                    </Text>
                  </LinearGradient>
                ) : (
                  <Text style={styles.tabText}>
                    {tab.label}
                  </Text>
                )}
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
  },
  container: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(24, 26, 28, 0.78)',
    padding: 3,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.24,
        shadowRadius: 14,
      },
      android: { elevation: 5 },
    }),
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  tabText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: COLORS.accent,
  },
  divider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginHorizontal: 2,
  },
});
