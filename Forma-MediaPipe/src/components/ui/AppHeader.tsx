import React, { memo, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Animated } from 'react-native';
import { Search, Bell, Settings } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, FONTS } from '../../constants/theme';
import { ScrollContext } from '../../contexts/ScrollContext';

export const HEADER_HEIGHT = 80; // Approximate height of the header

export const AppHeader: React.FC = memo(() => {
  const navigation = useNavigation<any>();
  
  // Get scroll context if available (will be undefined if not wrapped in ScrollProvider)
  const scrollContext = useContext(ScrollContext);
  const headerTranslateY = scrollContext?.headerTranslateY;

  const handleSettingsPress = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const animatedStyle = headerTranslateY
    ? { transform: [{ translateY: headerTranslateY }] }
    : {};

  return (
    <Animated.View 
      style={[
        styles.header,
        animatedStyle,
      ]}
    >
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
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 0,
    paddingBottom: SPACING.sm,
  },
  profileSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logoImage: {
    width: 64,
    height: 64,
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



