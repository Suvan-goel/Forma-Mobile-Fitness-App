import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Step Data ───────────────────────────────────────────────

interface StepConfig {
  question: string;
  options: string[];
}

const STEPS: StepConfig[] = [
  {
    question: 'What is your primary focus?',
    options: ['Building muscle', 'Just starting working out', 'Perfecting form', 'Other'],
  },
  {
    question: 'How many days a week do you train?',
    options: ['1-2 Days', '3-4 Days', '5+ Days'],
  },
];

// ── Glass Slab Component ────────────────────────────────────

interface GlassSlabProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

const GlassSlab: React.FC<GlassSlabProps> = ({ label, isSelected, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 60, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onPress();
  }, [onPress, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85}>
        <LinearGradient
          colors={isSelected ? ['#1F1F1F', '#0A0A0A'] : ['#1F1F1F', '#000000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            slabStyles.slab,
            isSelected && slabStyles.slabSelected,
          ]}
        >
          <Text style={[slabStyles.label, isSelected && slabStyles.labelSelected]}>
            {label}
          </Text>
          {isSelected && (
            <View style={slabStyles.checkCircle}>
              <View style={slabStyles.checkDot} />
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const slabStyles = StyleSheet.create({
  slab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 22,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  slabSelected: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  label: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.textSecondary,
    flex: 1,
  },
  labelSelected: {
    color: COLORS.text,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});

// ── Main Component ──────────────────────────────────────────

interface OnboardingQuestionsProps {
  onComplete: (answers: { goal: string; frequency: string }) => void;
}

export const OnboardingQuestions: React.FC<OnboardingQuestionsProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<string | null>(null);

  // Animated values
  const progressWidth = useRef(new Animated.Value(0.25)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentTranslateX = useRef(new Animated.Value(0)).current;

  const currentStep = STEPS[stepIndex];
  const selected = stepIndex === 0 ? selectedGoal : selectedFrequency;

  const animateTransition = useCallback(
    (nextStep: number, callback: () => void) => {
      // Fade out + slide left
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(contentTranslateX, { toValue: -30, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        callback();
        // Reset position to right side
        contentTranslateX.setValue(30);
        // Fade in + slide from right
        Animated.parallel([
          Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(contentTranslateX, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();
      });
      // Progress bar
      const targetProgress = (nextStep + 1) / STEPS.length * 0.5 + 0.25;
      Animated.timing(progressWidth, {
        toValue: targetProgress,
        duration: 300,
        useNativeDriver: false,
      }).start();
    },
    [contentOpacity, contentTranslateX, progressWidth],
  );

  const handleSelect = useCallback(
    (option: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (stepIndex === 0) {
        setSelectedGoal(option);
        // Auto-advance after 200ms
        setTimeout(() => {
          animateTransition(1, () => setStepIndex(1));
        }, 200);
      } else {
        setSelectedFrequency(option);
        // Complete after 200ms
        setTimeout(() => {
          onComplete({
            goal: selectedGoal ?? option,
            frequency: option,
          });
        }, 200);
      }
    },
    [stepIndex, selectedGoal, animateTransition, onComplete],
  );

  const progressBarWidth = progressWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Progress Bar — 2px violet line at top */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressBarWidth }]}>
          <LinearGradient
            colors={['#8B5CF6', '#A78BFA']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      {/* Content */}
      <Animated.View
        style={[
          styles.content,
          {
            opacity: contentOpacity,
            transform: [{ translateX: contentTranslateX }],
          },
        ]}
      >
        {/* Step Indicator */}
        <Text style={styles.stepIndicator}>
          {stepIndex + 1} of {STEPS.length}
        </Text>

        {/* Question */}
        <Text style={styles.question}>{currentStep.question}</Text>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {currentStep.options.map((option) => (
            <GlassSlab
              key={option}
              label={option}
              isSelected={selected === option}
              onPress={() => handleSelect(option)}
            />
          ))}
        </View>
      </Animated.View>

      {/* Subtle hint text */}
      <View style={styles.hintContainer}>
        <Text style={styles.hintText}>Tap to select</Text>
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
  progressTrack: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    width: '100%',
  },
  progressFill: {
    height: 2,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal + 8,
    paddingTop: 48,
  },
  stepIndicator: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  question: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: 40,
    lineHeight: 38,
  },
  optionsContainer: {
    gap: 14,
  },
  hintContainer: {
    paddingBottom: 24,
    alignItems: 'center',
  },
  hintText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
});
