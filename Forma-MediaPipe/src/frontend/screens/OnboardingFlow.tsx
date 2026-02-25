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
    (_answers: { goal: string; frequency: string }) => {
      // Answers can be sent to backend later if needed
      transitionTo('interstitial');
    },
    [transitionTo],
  );

  const handleInterstitialComplete = useCallback(() => {
    // Mark onboarding as complete before showing auth
    AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true').catch(() => {});
    onOnboardingComplete();
    transitionTo('auth');
  }, [transitionTo, onOnboardingComplete]);

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
