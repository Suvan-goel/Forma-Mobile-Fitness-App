import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { useAuth } from '../../backend/contexts/AuthContext';

// ── Blueprint Vector ────────────────────────────────────────

const BlueprintVector: React.FC = () => (
  <Svg width={80} height={80} viewBox="0 0 80 80">
    {/* Abstract node graph — representing AI blueprint */}
    <Circle cx={40} cy={20} r={4} fill={COLORS.primary} opacity={0.8} />
    <Circle cx={20} cy={50} r={4} fill={COLORS.primary} opacity={0.5} />
    <Circle cx={60} cy={50} r={4} fill={COLORS.primary} opacity={0.5} />
    <Circle cx={40} cy={65} r={3} fill={COLORS.primary} opacity={0.3} />
    {/* Connections */}
    <Path d="M 40 24 L 20 46" stroke={COLORS.primary} strokeWidth={1} opacity={0.3} />
    <Path d="M 40 24 L 60 46" stroke={COLORS.primary} strokeWidth={1} opacity={0.3} />
    <Path d="M 20 54 L 40 62" stroke={COLORS.primary} strokeWidth={1} opacity={0.2} />
    <Path d="M 60 54 L 40 62" stroke={COLORS.primary} strokeWidth={1} opacity={0.2} />
    {/* Outer glow */}
    <Circle cx={40} cy={20} r={12} fill={COLORS.primary} opacity={0.06} />
  </Svg>
);

// ── Main Component ──────────────────────────────────────────

export const OnboardingAuth: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState<'google' | 'apple' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stagger-fade animations
  const vectorFade = useRef(new Animated.Value(0)).current;
  const headerFade = useRef(new Animated.Value(0)).current;
  const subtextFade = useRef(new Animated.Value(0)).current;
  const appleButtonFade = useRef(new Animated.Value(0)).current;
  const googleButtonFade = useRef(new Animated.Value(0)).current;
  const footerFade = useRef(new Animated.Value(0)).current;

  const vectorSlide = useRef(new Animated.Value(20)).current;
  const headerSlide = useRef(new Animated.Value(20)).current;
  const subtextSlide = useRef(new Animated.Value(20)).current;
  const appleSlide = useRef(new Animated.Value(20)).current;
  const googleSlide = useRef(new Animated.Value(20)).current;
  const footerSlide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const createFadeIn = (fadeAnim: Animated.Value, slideAnim: Animated.Value, delay: number) =>
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          delay,
          useNativeDriver: true,
        }),
      ]);

    Animated.stagger(0, [
      createFadeIn(vectorFade, vectorSlide, 100),
      createFadeIn(headerFade, headerSlide, 200),
      createFadeIn(subtextFade, subtextSlide, 350),
      createFadeIn(appleButtonFade, appleSlide, 500),
      createFadeIn(googleButtonFade, googleSlide, 650),
      createFadeIn(footerFade, footerSlide, 800),
    ]).start();
  }, [vectorFade, headerFade, subtextFade, appleButtonFade, googleButtonFade, footerFade,
      vectorSlide, headerSlide, subtextSlide, appleSlide, googleSlide, footerSlide]);

  const handleAppleSignIn = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setErrorMessage(null);
    setIsSigningIn('apple');
    try {
      await signInWithApple();
    } catch (e: any) {
      setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setIsSigningIn(null);
    }
  }, [signInWithApple]);

  const handleGoogleSignIn = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setErrorMessage(null);
    setIsSigningIn('google');
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setIsSigningIn(null);
    }
  }, [signInWithGoogle]);

  const isBusy = isSigningIn !== null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Animated.View
            style={{
              opacity: vectorFade,
              transform: [{ translateY: vectorSlide }],
              marginBottom: 32,
            }}
          >
            <BlueprintVector />
          </Animated.View>

          <Animated.Text
            style={[
              styles.header,
              {
                opacity: headerFade,
                transform: [{ translateY: headerSlide }],
              },
            ]}
          >
            Your Custom AI{'\n'}Blueprint is Ready.
          </Animated.Text>

          <Animated.Text
            style={[
              styles.subtext,
              {
                opacity: subtextFade,
                transform: [{ translateY: subtextSlide }],
              },
            ]}
          >
            Create your profile to access your{'\n'}personalized Logbook.
          </Animated.Text>
        </View>

        {/* Auth Buttons */}
        <View style={styles.buttonSection}>
          {/* Apple SSO — dominant placement (top) */}
          <Animated.View
            style={[
              styles.buttonOuter,
              {
                opacity: appleButtonFade,
                transform: [{ translateY: appleSlide }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleAppleSignIn}
              activeOpacity={0.85}
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
          </Animated.View>

          {/* Google SSO — wired to existing auth handler */}
          <Animated.View
            style={[
              styles.buttonOuter,
              styles.googleWrapper,
              {
                opacity: googleButtonFade,
                transform: [{ translateY: googleSlide }],
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              activeOpacity={0.85}
              disabled={isBusy}
            >
              <View style={styles.googleButtonInner}>
                {isSigningIn === 'google' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Continue with Google</Text>
                )}
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Error */}
          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          {/* Footer */}
          <Animated.Text
            style={[
              styles.footer,
              {
                opacity: footerFade,
                transform: [{ translateY: footerSlide }],
              },
            ]}
          >
            By continuing, you agree to our Terms of Service
          </Animated.Text>
        </View>
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal + 8,
    justifyContent: 'center',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 56,
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: -0.5,
    lineHeight: 38,
    marginBottom: 16,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonSection: {
    alignItems: 'center',
    gap: 16,
  },
  buttonOuter: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
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
  googleWrapper: {
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
  googleButtonInner: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
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
    marginTop: 4,
  },
  footer: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: 8,
  },
});
