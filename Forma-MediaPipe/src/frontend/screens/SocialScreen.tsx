/**
 * SocialScreen — Top-level container for the Social tab
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { SocialTabSelector, SocialTab } from '../components/ui/SocialTabSelector';
import { LeaderboardView } from './social/LeaderboardView';
import { FriendsView } from './social/FriendsView';
import { ActivityView } from './social/ActivityView';
import { useUser } from '../../backend/hooks';
import type { RootStackParamList } from '../app/RootNavigator';

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

  const handleBack = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  }, [navigation]);

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
      {/* ── HEADER ──────── */}
      <View style={styles.fixedHeader}>
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.7}
          style={styles.backButton}
        >
          <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SOCIAL</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.avatarButton}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.avatarPlaceholder} />
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
  fixedHeader: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 46,
    flex: 1,
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 5,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
});
