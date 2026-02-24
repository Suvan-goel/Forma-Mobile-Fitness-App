import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronDown } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';

interface HelpCenterScreenProps {
  navigation: any;
}

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQSection {
  title: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: 'Camera Positioning',
    items: [
      {
        question: 'How should I position my phone?',
        answer: 'Place your phone 6-8 feet away at hip height on a stable surface. Make sure your full body is visible in the frame from head to feet.',
      },
      {
        question: 'Which camera view works best?',
        answer: 'Side view is required for most exercises (curls, squats, push-ups). Position yourself so the camera sees your full profile from the side.',
      },
      {
        question: 'Why is my pose not being detected?',
        answer: 'Ensure good, even lighting and that your full body is visible. Avoid wearing clothing that blends with the background. If detection is inconsistent, try moving closer to the camera.',
      },
    ],
  },
  {
    title: 'Exercise Form',
    items: [
      {
        question: 'How does Forma analyze my form?',
        answer: 'Forma uses on-device pose estimation to track your joint angles in real time. It compares your movement patterns against ideal form and provides feedback on specific issues like torso swing, range of motion, and tempo.',
      },
      {
        question: 'What do the feedback messages mean?',
        answer: 'Each feedback message identifies a specific form issue. For example, "Keep your elbows pinned" means your upper arms are moving too much. The messages are designed to give you actionable corrections during your set.',
      },
      {
        question: 'Can I use Forma for any exercise?',
        answer: 'Currently Forma supports specific exercises with dedicated form analysis. Check the exercise list in the Record tab to see all available exercises. More exercises are being added regularly.',
      },
    ],
  },
  {
    title: 'Scoring System',
    items: [
      {
        question: 'How is my rep score calculated?',
        answer: 'Each rep starts at 100 and loses points for form issues across five categories: torso stability, shoulder movement, range of motion, tempo, and asymmetry. Small imperfections cause small drops, while major form breakdowns cause larger penalties.',
      },
      {
        question: 'What is the set score?',
        answer: 'Your set score is a weighted average of all rep scores in the set. Bad reps are weighted more heavily than good reps, so a few sloppy reps will pull your set score down more than a few perfect reps will pull it up.',
      },
      {
        question: 'Why is a perfect 100 rare?',
        answer: 'The scoring system uses continuous penalty curves, so even tiny imperfections result in small point deductions. Scores of 85-93 indicate very good form. A perfect 100 means every aspect of your form was within the tightest possible tolerances.',
      },
    ],
  },
  {
    title: 'Voice Coaching',
    items: [
      {
        question: 'How do I enable voice coaching?',
        answer: 'Toggle "Voice Coaching (TTS)" in Settings under the Workout section. When enabled, Forma will give you spoken cues during your sets about your form.',
      },
      {
        question: 'Why does the coach only mention one issue?',
        answer: 'To avoid overwhelming you during a set, the voice coach only speaks about the highest-priority form issue per rep. All issues are still shown visually on screen. The coach also gives positive feedback when you maintain good form.',
      },
      {
        question: 'Can I use voice coaching with headphones?',
        answer: 'Yes, audio plays through your current output device. Voice coaching is designed to be short and non-intrusive, so it won\'t interrupt your focus.',
      },
    ],
  },
];

const AccordionItem: React.FC<{ item: FAQItem; isLast: boolean }> = ({ item, isLast }) => {
  const [expanded, setExpanded] = useState(false);
  const animValue = useRef(new Animated.Value(0)).current;
  const rotateValue = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    const toValue = expanded ? 0 : 1;
    Animated.parallel([
      Animated.timing(animValue, {
        toValue,
        duration: 250,
        useNativeDriver: false,
      }),
      Animated.timing(rotateValue, {
        toValue,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
    setExpanded(!expanded);
  }, [expanded, animValue, rotateValue]);

  const maxHeight = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 300],
  });

  const rotate = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={[styles.faqItem, isLast && styles.faqItemLast]}>
      <TouchableOpacity
        style={styles.faqQuestion}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
        </Animated.View>
      </TouchableOpacity>
      <Animated.View style={{ maxHeight, overflow: 'hidden' }}>
        <Text style={styles.faqAnswerText}>{item.answer}</Text>
      </Animated.View>
    </View>
  );
};

export const HelpCenterScreen: React.FC<HelpCenterScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>HELP CENTER</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {FAQ_SECTIONS.map((section) => (
            <View key={section.title}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              <View style={styles.cardOuter}>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardGlassEdge}>
                    {section.items.map((item, index) => (
                      <AccordionItem
                        key={item.question}
                        item={item}
                        isLast={index === section.items.length - 1}
                      />
                    ))}
                  </View>
                </LinearGradient>
              </View>
            </View>
          ))}

          <Text style={styles.footerText}>
            Need more help? Contact us at support@forma.app
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: 2,
  },
  placeholder: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl,
  },
  sectionHeader: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    marginBottom: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
    overflow: 'hidden',
  },
  faqItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  faqItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  faqAnswerText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  footerText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.xxl,
  },
});
