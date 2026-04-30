import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';

// ── Step Data ───────────────────────────────────────────────

interface OptionConfig {
  label: string;
  subtext?: string;
}

interface StepConfig {
  question: string;
  category: string;
  options: OptionConfig[];
}

const STEPS: StepConfig[] = [
  {
    question: 'What is your primary focus?',
    category: 'YOUR GOAL',
    options: [
      { label: 'Building muscle' },
      { label: 'Just starting working out' },
      { label: 'Perfecting form' },
      { label: 'Other' },
    ],
  },
  {
    question: 'How many days a week do you train?',
    category: 'TRAINING',
    options: [
      { label: '1-2 Days' },
      { label: '3-4 Days' },
      { label: '5+ Days' },
    ],
  },
  {
    question: 'How long have you been training?',
    category: 'EXPERIENCE',
    options: [
      { label: 'Just starting', subtext: 'Learning the basics' },
      { label: '1–2 years', subtext: 'Consistent routine' },
      { label: '3+ years', subtext: 'Highly experienced' },
    ],
  },
];

// ── Step Dots ───────────────────────────────────────────────

const StepDots: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <View style={dotStyles.row}>
    {Array.from({ length: total }, (_, i) => (
      <View
        key={i}
        style={[
          dotStyles.dot,
          i === current ? dotStyles.dotActive : dotStyles.dotInactive,
        ]}
      />
    ))}
  </View>
);

const dotStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 28,
    backgroundColor: COLORS.primary,
  },
  dotInactive: {
    width: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});

// ── Option Card ─────────────────────────────────────────────

interface OptionCardProps {
  label: string;
  subtext?: string;
  isSelected: boolean;
  onPress: () => void;
}

const OptionCard: React.FC<OptionCardProps> = ({ label, subtext, isSelected, onPress }) => {
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
          colors={CARD_GRADIENT_COLORS}
          start={CARD_GRADIENT_START}
          end={CARD_GRADIENT_END}
          style={[cardStyles.card, isSelected && cardStyles.cardSelected]}
        >
          {isSelected && (
            <View style={[StyleSheet.absoluteFill, cardStyles.selectedOverlay]} pointerEvents="none" />
          )}

          <View style={cardStyles.content}>
            <Text style={cardStyles.label}>{label}</Text>
            {subtext ? <Text style={cardStyles.subtext}>{subtext}</Text> : null}
          </View>

          <View style={[cardStyles.indicator, isSelected && cardStyles.indicatorSelected]}>
            {isSelected && <View style={cardStyles.indicatorDot} />}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
    overflow: 'hidden',

    ...CARD_SHADOW,
},
  cardSelected: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  selectedOverlay: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  indicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  indicatorSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
});

// ── Main Component ──────────────────────────────────────────

interface OnboardingQuestionsProps {
  onComplete: (answers: { goal: string; frequency: string; experience: string }) => void;
}

export const OnboardingQuestions: React.FC<OnboardingQuestionsProps> = ({ onComplete }) => {
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<string | null>(null);
  const [selectedExperience, setSelectedExperience] = useState<string | null>(null);

  const progressWidth = useRef(new Animated.Value(0.25)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentTranslateX = useRef(new Animated.Value(0)).current;

  const currentStep = STEPS[stepIndex];
  const selected =
    stepIndex === 0 ? selectedGoal :
    stepIndex === 1 ? selectedFrequency :
    selectedExperience;

  const animateTransition = useCallback(
    (nextStep: number, callback: () => void) => {
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(contentTranslateX, { toValue: -30, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        callback();
        contentTranslateX.setValue(30);
        Animated.parallel([
          Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(contentTranslateX, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();
      });
      const targetProgress = ((nextStep + 1) / STEPS.length) * 0.5 + 0.25;
      Animated.timing(progressWidth, { toValue: targetProgress, duration: 300, useNativeDriver: false }).start();
    },
    [contentOpacity, contentTranslateX, progressWidth],
  );

  const handleSelect = useCallback(
    (option: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (stepIndex === 0) {
        setSelectedGoal(option);
        setTimeout(() => animateTransition(1, () => setStepIndex(1)), 200);
      } else if (stepIndex === 1) {
        setSelectedFrequency(option);
        setTimeout(() => animateTransition(2, () => setStepIndex(2)), 200);
      } else {
        setSelectedExperience(option);
        setTimeout(() => {
          onComplete({
            goal: selectedGoal ?? '',
            frequency: selectedFrequency ?? '',
            experience: option,
          });
        }, 200);
      }
    },
    [stepIndex, selectedGoal, selectedFrequency, animateTransition, onComplete],
  );

  const progressBarWidth = progressWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressBarWidth }]}>
          <LinearGradient
            colors={['#7A55FF', '#A78BFA']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      {/* Animated content */}
      <Animated.View
        style={[
          styles.content,
          { opacity: contentOpacity, transform: [{ translateX: contentTranslateX }] },
        ]}
      >
        {/* Background step number — decorative */}
        <Text style={styles.bgNumber} pointerEvents="none">
          {`0${stepIndex + 1}`}
        </Text>

        {/* Header zone */}
        <View style={styles.headerZone}>
          <StepDots current={stepIndex} total={STEPS.length} />

          <View style={styles.questionWrapper}>
            <Text style={styles.categoryLabel}>{currentStep.category}</Text>
            <Text style={styles.question}>{currentStep.question}</Text>
          </View>
        </View>

        {/* Options zone */}
        <View style={styles.optionsZone}>
          {currentStep.options.map((option) => (
            <OptionCard
              key={option.label}
              label={option.label}
              subtext={option.subtext}
              isSelected={selected === option.label}
              onPress={() => handleSelect(option.label)}
            />
          ))}
        </View>
      </Animated.View>

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
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    width: '100%',
  },
  progressFill: {
    height: 3,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal + 8,
    paddingTop: 44,
    paddingBottom: 28,
  },
  // ── Background decoration ──
  bgNumber: {
    position: 'absolute',
    top: -20,
    right: -16,
    fontFamily: FONTS.mono.bold,
    fontSize: 220,
    lineHeight: 220,
    color: 'rgba(255, 255, 255, 0.024)',
    letterSpacing: -12,
  },
  // ── Header zone ──
  headerZone: {
    gap: 28,
    marginTop: 50,
  },
  questionWrapper: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    paddingLeft: 18,
    gap: 10,
  },
  categoryLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  question: {
    fontFamily: FONTS.display.bold,
    fontSize: 32,
    color: COLORS.text,
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  // ── Options zone ──
  optionsZone: {
    gap: 12,
    marginTop: 100,
  },
});
