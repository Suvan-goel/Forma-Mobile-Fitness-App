import React from 'react';
import {
  View,
  StyleSheet,
  Text,
  Image,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
    <View style={styles.root}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {/* ── Hero Section ───────────────────── */}
          <View style={styles.heroSection}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>FORMA</Text>
            <Text style={styles.subtitle}>MASTER YOUR MOVEMENT</Text>
          </View>

          {/* ── Bottom Section ─────────────────── */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              onPress={handleStartTraining}
              activeOpacity={0.85}
              style={styles.buttonOuter}
            >
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.buttonGradient}
              >
                <Text style={styles.buttonText}>LET'S DO THIS</Text>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.footer}>
              Join thousands of athletes improving their form
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Layout ──────────────────────────────── */
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
    paddingBottom: SPACING.xl,
  },

  /* ── Hero ─────────────────────────────────── */
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
    fontFamily: FONTS.display.bold,
    fontSize: 52,
    color: '#FFFFFF',
    letterSpacing: -1,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: FONTS.display.medium,
    fontSize: 13,
    color: '#D4D4D8',
    letterSpacing: 4,
  },

  /* ── Bottom ──────────────────────────────── */
  bottomSection: {
    alignItems: 'center',
    marginTop: SPACING.xxxl,
    gap: SPACING.lg,
  },
  buttonOuter: {
    width: '90%',
    borderRadius: 28,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
    }),
  },
  buttonGradient: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  footer: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#52525B',
    textAlign: 'center',
  },
});
