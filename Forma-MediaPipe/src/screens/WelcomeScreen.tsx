import React from 'react';
import { View, StyleSheet, Text, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { RootStackParamList } from '../app/RootNavigator';

type WelcomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ navigation }) => {
  const handleStartTraining = () => {
    navigation.replace('MainTabs');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Hero Section - Centered */}
        <View style={styles.heroSection}>
          <Image 
            source={require('../assets/forma_purple_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>FORMA</Text>
          <Text style={styles.subtitle}>Master your movement</Text>
          <Text style={styles.tagline}>AI-powered form analysis for every workout</Text>
        </View>

        {/* Bottom Section */}
        <View style={styles.bottomSection}>
          <TouchableOpacity 
            style={styles.startButton} 
            onPress={handleStartTraining}
            activeOpacity={0.8}
          >
            <Text style={styles.startButtonText}>Let's Do This</Text>
          </TouchableOpacity>
          <Text style={styles.disclaimer}>
            Join thousands of athletes improving their form
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
    paddingBottom: SPACING.xl,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: SPACING.xxxl,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: FONTS.ui.bold,
    fontSize: 56,
    color: COLORS.text,
    letterSpacing: -1,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 20,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  tagline: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomSection: {
    gap: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.xxxl,
  },
  startButton: {
    width: '70%',
    backgroundColor: COLORS.primary,
    borderRadius: 40,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 16,
    color: COLORS.background,
  },
  disclaimer: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
