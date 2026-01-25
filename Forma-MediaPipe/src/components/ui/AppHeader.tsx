import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Search, Bell, Settings } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, FONTS } from '../../constants/theme';

export const AppHeader: React.FC = memo(() => {
  const navigation = useNavigation<any>();

  const handleSettingsPress = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  return (
    <View style={styles.header}>
      <View style={styles.profileSection}>
        <View style={styles.logoContainer}>
          <Image 
            source={require('../../assets/forma_icon.png')} 
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.userName}>Athlete</Text>
        </View>
      </View>
      <View style={styles.headerIcons}>
        <TouchableOpacity style={styles.iconButton}>
          <Search size={22} color={COLORS.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton}>
          <Bell size={22} color={COLORS.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={handleSettingsPress}>
          <Settings size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: 0,
    paddingBottom: SPACING.lg,
  },
  profileSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logoImage: {
    width: 52,
    height: 52,
  },
  textContainer: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  userName: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 12,
    flexShrink: 0,
  },
  iconButton: {
    padding: 8,
  },
});



