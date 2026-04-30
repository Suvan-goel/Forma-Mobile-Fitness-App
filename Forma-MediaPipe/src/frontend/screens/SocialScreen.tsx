/**
 * SocialScreen — Top-level container for the Social tab
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronLeft, Settings as SettingsIcon } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { SocialTabSelector, SocialTab } from '../components/ui/SocialTabSelector';
import { FriendsView } from './social/FriendsView';
import { ActivityView } from './social/ActivityView';
import type { RootStackParamList } from '../app/RootNavigator';

export const SocialScreen: React.FC = memo(() => {
  const [activeTab, setActiveTab] = useState<SocialTab>('activity');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
      case 'activity':
        return <ActivityView />;
      case 'friends':
        return <FriendsView />;
    }
  };

  return (
    <View style={styles.container}>
      {/* ── HEADER (matches Rewards style) ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          activeOpacity={0.7}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerName}>SOCIAL</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.7}
          style={styles.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
        </TouchableOpacity>
      </View>

      {/* Tab selector */}
      <SocialTabSelector activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Content */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {renderContent()}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 12,
  },
  backBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
    flex: 1,
    textAlign: 'left',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
});
