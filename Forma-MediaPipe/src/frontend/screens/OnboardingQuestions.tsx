import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW,
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
          colors={isSelected ? CARD_GRADIENT_ELEVATED : CARD_GRADIENT_COLORS}
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
            {isSelected && <Check size={13} color={COLORS.text} strokeWidth={2.8} />}
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
    minHeight: 76,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  cardSelected: {
    borderColor: 'rgba(122, 85, 255, 0.62)',
  },
  selectedOverlay: {
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: 0,
  },
  subtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  indicator: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  indicatorSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
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
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            <StepDots current={stepIndex} total={STEPS.length} />
            <Text style={styles.stepCount}>{stepIndex + 1}/{STEPS.length}</Text>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.questionCard}
          >
            <View style={styles.questionCardEdge}>
              <Text style={styles.categoryLabel}>{currentStep.category}</Text>
              <Text style={styles.question}>{currentStep.question}</Text>
              <Text style={styles.helperText}>Tap one option to continue.</Text>
            </View>
          </LinearGradient>

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
        </ScrollView>
      </Animated.View>

    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 24,
    paddingBottom: 28,
    gap: 14,
  },
  topRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepCount: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  questionCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  questionCardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    padding: 18,
    gap: 9,
  },
  categoryLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.primary,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  question: {
    fontFamily: FONTS.display.bold,
    fontSize: 29,
    color: COLORS.text,
    letterSpacing: 0,
    lineHeight: 36,
  },
  helperText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 19,
    letterSpacing: 0,
  },
  optionsZone: {
    gap: 10,
  },
});
