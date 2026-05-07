import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
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
      if (!e?.cancelled) {
        setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
      }
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
      if (!e?.cancelled) {
        setErrorMessage(e?.message ?? 'Sign-in failed. Please try again.');
      }
    } finally {
      setIsSigningIn(null);
    }
  }, [signInWithGoogle]);

  const isBusy = isSigningIn !== null;

  return (
    <ScreenBackground style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Animated.View
            style={{
              opacity: vectorFade,
              transform: [{ translateY: vectorSlide }],
            }}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_ELEVATED]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.blueprintCard}
            >
              <View style={styles.blueprintCardEdge}>
                <View style={styles.blueprintIconWrap}>
                  <BlueprintVector />
                </View>
                <View style={styles.blueprintStatusRow}>
                  <View style={styles.statusDot} />
                  <Text style={styles.blueprintStatus}>Profile ready</Text>
                </View>
              </View>
            </LinearGradient>
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
            Your AI coach is ready.
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
            Create your profile to save form scores, workouts, and training progress.
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
              <LinearGradient
                colors={[COLORS.primary, COLORS.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.googleButtonInner}
              >
                {isSigningIn === 'google' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Continue with Google</Text>
                )}
              </LinearGradient>
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
      </ScrollView>
    </ScreenBackground>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: 28,
    justifyContent: 'center',
    gap: 28,
  },
  heroSection: {
    alignItems: 'center',
    gap: 18,
  },
  blueprintCard: {
    width: 176,
    height: 176,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  blueprintCardEdge: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.115)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  blueprintIconWrap: {
    width: 98,
    height: 98,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.20)',
  },
  blueprintStatusRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(52, 224, 166, 0.10)',
    borderWidth: 0.5,
    borderColor: 'rgba(52, 224, 166, 0.20)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.green,
  },
  blueprintStatus: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.green,
    letterSpacing: 0,
  },
  header: {
    fontFamily: FONTS.display.bold,
    fontSize: 34,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: 0,
    lineHeight: 39,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 310,
  },
  buttonSection: {
    alignItems: 'center',
    gap: 12,
  },
  buttonOuter: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  appleButtonInner: {
    height: 54,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  googleButtonInner: {
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  buttonText: {
    fontFamily: FONTS.display.regular,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0,
  },
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.red,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 17,
  },
});
