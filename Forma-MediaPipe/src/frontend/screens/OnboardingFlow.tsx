/**
 * OnboardingFlow — Orchestrator for the 4-step onboarding experience.
 *
 * Flow: Carousel → Questions → Interstitial → Auth
 *
 * Once the auth step is reached, the AsyncStorage flag `@forma_has_onboarded`
 * is set to `true` so the flow never shows again.  When the user signs in,
 * React Navigation auto-navigates to MainTabs via the auth-state branch in
 * RootStackNavigator.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingCarousel } from './OnboardingCarousel';
import { OnboardingQuestions } from './OnboardingQuestions';
import { OnboardingInterstitial } from './OnboardingInterstitial';
import { OnboardingAuth } from './OnboardingAuth';
import { COLORS } from '../constants/theme';
import { CAMERA_SETTINGS_KEY } from '../../utils/storageKeys';

const FREQUENCY_TO_TARGET: Record<string, string> = {
  '1-2 Days': '1-2',
  '3-4 Days': '3-4',
  '5+ Days': '5+',
};

export const ONBOARDING_STORAGE_KEY = '@forma_has_onboarded';

type OnboardingStep = 'carousel' | 'questions' | 'interstitial' | 'auth';

interface OnboardingFlowProps {
  onOnboardingComplete: () => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onOnboardingComplete }) => {
  const [step, setStep] = useState<OnboardingStep>('carousel');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const transitionTo = useCallback(
    (nextStep: OnboardingStep) => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setStep(nextStep);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    },
    [fadeAnim],
  );

  const handleCarouselComplete = useCallback(() => {
    transitionTo('questions');
  }, [transitionTo]);

  const handleQuestionsComplete = useCallback(
    (answers: { goal: string; frequency: string; experience: string }) => {
      const target = FREQUENCY_TO_TARGET[answers.frequency];
      if (target) {
        AsyncStorage.getItem(CAMERA_SETTINGS_KEY).then((raw) => {
          const stored = raw ? JSON.parse(raw) : {};
          return AsyncStorage.setItem(CAMERA_SETTINGS_KEY, JSON.stringify({ ...stored, weeklyTrainingTarget: target }));
        }).catch(() => {});
      }
      transitionTo('interstitial');
    },
    [transitionTo],
  );

  const handleInterstitialComplete = useCallback(() => {
    // Mark onboarding as complete before showing auth.
    // Do NOT call onOnboardingComplete() here — that would trigger setHasOnboarded(true)
    // in the parent, which unmounts this component while transitionTo('auth') is still
    // in progress, causing conflicting state updates (React 19 "useInsertionEffect" error).
    // Navigation away from OnboardingFlow happens automatically when the user signs in
    // (auth state change makes !user && !hasOnboarded false in RootStackNavigator).
    AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true').catch(() => {});
    transitionTo('auth');
  }, [transitionTo]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
        {step === 'carousel' && <OnboardingCarousel onComplete={handleCarouselComplete} />}
        {step === 'questions' && <OnboardingQuestions onComplete={handleQuestionsComplete} />}
        {step === 'interstitial' && <OnboardingInterstitial onComplete={handleInterstitialComplete} />}
        {step === 'auth' && <OnboardingAuth />}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  stepContainer: {
    flex: 1,
  },
});
