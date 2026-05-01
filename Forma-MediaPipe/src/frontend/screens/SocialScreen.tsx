/**
 * SocialScreen — Top-level container for the Social tab
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { Settings as SettingsIcon, UserPlus } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { SocialTabSelector, SocialTab } from '../components/ui/SocialTabSelector';
import { FriendsView } from './social/FriendsView';
import { ActivityView } from './social/ActivityView';
import type { RootStackParamList } from '../app/RootNavigator';

export const SocialScreen: React.FC = memo(() => {
  const [activeTab, setActiveTab] = useState<SocialTab>('activity');
  const insets = useSafeAreaInsets();
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

  const handleHeaderAction = useCallback(() => {
    if (activeTab === 'friends') {
      navigation.navigate('AddFriend');
      return;
    }
    navigation.navigate('Settings');
  }, [activeTab, navigation]);

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
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.headerName}>
          {activeTab === 'friends' ? 'FRIENDS' : 'SOCIAL'}
        </Text>
        <TouchableOpacity
          onPress={handleHeaderAction}
          activeOpacity={0.7}
          style={styles.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {activeTab === 'friends' ? (
            <UserPlus size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
          ) : (
            <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
          )}
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
