/**
 * SocialScreen — Top-level container for the Social tab
 *
 * Uses an internal tab selector (not a nested navigator) to switch
 * between Leaderboard, Friends, and Activity views.
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { SocialTabSelector, SocialTab } from '../components/ui/SocialTabSelector';
import { LeaderboardView } from './social/LeaderboardView';
import { FriendsView } from './social/FriendsView';
import { ActivityView } from './social/ActivityView';

export const SocialScreen: React.FC = memo(() => {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<SocialTab>('leaderboard');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleTabChange = useCallback((tab: SocialTab) => {
    setActiveTab(tab);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'leaderboard':
        return <LeaderboardView />;
      case 'friends':
        return <FriendsView />;
      case 'activity':
        return <ActivityView />;
    }
  };

  return (
    <Animated.View style={[styles.container, { paddingTop: insets.top, opacity: fadeAnim }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Users size={22} color={COLORS.primary} />
          <Text style={styles.headerTitle}>Social</Text>
        </View>
      </View>

      {/* Tab selector */}
      <SocialTabSelector activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Content */}
      <View style={styles.content}>
        {renderContent()}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
});
