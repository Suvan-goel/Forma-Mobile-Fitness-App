/**
 * SocialScreen — Top-level container for the Social tab
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { SocialTabSelector, SocialTab } from '../components/ui/SocialTabSelector';
import { LeaderboardView } from './social/LeaderboardView';
import { FriendsView } from './social/FriendsView';
import { ActivityView } from './social/ActivityView';
import { useUser } from '../../backend/hooks';
import type { RootStackParamList } from '../app/RootNavigator';

const formatHeaderDate = (): string => {
  const d = new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()} \u2022 TODAY`;
};

export const SocialScreen: React.FC = memo(() => {
  const [activeTab, setActiveTab] = useState<SocialTab>('leaderboard');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user: profileUser } = useUser();

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
    <View style={styles.container}>
      {/* ── HEADER (matches Analytics/Logbook style) ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>SOCIAL</Text>
            <Text style={styles.headerSubtitle}>{formatHeaderDate()}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.profileBtn}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.profileImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <Text style={styles.profileInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.profilePlaceholder} />
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
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 50,
    height: 55,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
  },
  profileInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
});
