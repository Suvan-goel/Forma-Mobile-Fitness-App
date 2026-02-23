import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Image,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { useAuth } from '../../backend/contexts/AuthContext';

export const WelcomeScreen: React.FC = () => {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState<'google' | 'apple' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsSigningIn('google');
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setIsSigningIn(null);
    }
  };

  const handleAppleSignIn = async () => {
    setErrorMessage(null);
    setIsSigningIn('apple');
    try {
      await signInWithApple();
    } catch (e: any) {
      setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setIsSigningIn(null);
    }
  };

  const isBusy = isSigningIn !== null;

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
            {/* Google Sign-In */}
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              activeOpacity={0.85}
              style={styles.buttonOuter}
              disabled={isBusy}
            >
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.buttonGradient}
              >
                {isSigningIn === 'google' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Continue with Google</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Apple Sign-In */}
            <TouchableOpacity
              onPress={handleAppleSignIn}
              activeOpacity={0.85}
              style={[styles.buttonOuter, styles.appleButtonOuter]}
              disabled={isBusy}
            >
              <View style={styles.appleButtonInner}>
                {isSigningIn === 'apple' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Continue with Apple</Text>
                )}
              </View>
            </TouchableOpacity>

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

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
  appleButtonOuter: {
    ...Platform.select({
      ios: {
        shadowColor: '#FFFFFF',
        shadowOpacity: 0.15,
      },
      android: { elevation: 4 },
    }),
  },
  appleButtonInner: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  buttonText: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
  },
  footer: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#52525B',
    textAlign: 'center',
  },
});
