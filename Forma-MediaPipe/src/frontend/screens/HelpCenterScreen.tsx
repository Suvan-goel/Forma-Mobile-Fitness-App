import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronDown,
  Camera,
  Dumbbell,
  BarChart2,
  Volume2,
  Mail,
  Star,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW
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
  icon: any;
  iconColor: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: 'Camera Positioning',
    icon: Camera,
    iconColor: '#60A5FA',
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
    icon: Dumbbell,
    iconColor: '#F472B6',
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
    icon: BarChart2,
    iconColor: '#34E0A6',
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
    title: 'Rewards & Points',
    icon: Star,
    iconColor: COLORS.yellow,
    items: [
      {
        question: 'How do I earn points?',
        answer: 'Points come from two sources: workout quality (Form Points) and weekly habits (Consistency Points). Form Points are awarded when you save a workout — each set with a form score of 60 or above earns points, and longer sessions with higher average scores earn bonus points. Consistency Points are awarded once per week based on how well you hit your weekly training target.',
      },
      {
        question: 'How are Form Points calculated?',
        answer: 'Each qualifying set (form score ≥ 60) earns 1–3 tier points based on quality: 60–74 = 1 pt, 75–84 = 2 pts, 85+ = 3 pts. Weighted exercises earn a small volume bonus on top. A session bonus of up to 10 pts is added based on your average form score, and a duration bonus of up to 5 pts rewards full workouts. The total is capped at 25 pts per workout, and only your first workout each day counts — so consistency beats marathon sessions.',
      },
      {
        question: 'How are Consistency Points calculated?',
        answer: 'At the start of each new week, Forma checks how many workouts you completed the previous Monday–Sunday versus your weekly training target (set in Settings). Hitting 100% of your target earns 20 pts. Reaching 75–99% earns 10 pts, and 50–74% earns 5 pts. On top of that, a streak bonus rewards consecutive weeks of hitting your target: 2 weeks = +5, 4 weeks = +10, 8+ weeks = +15. The weekly maximum is 35 pts.',
      },
    ],
  },
  {
    title: 'Voice Coaching',
    icon: Volume2,
    iconColor: '#A78BFA',
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

const AccordionItem: React.FC<{ item: FAQItem; isFirst: boolean; isLast: boolean }> = ({ item, isFirst }) => {
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
    <View>
      {!isFirst && <View style={styles.itemDivider} />}
      <TouchableOpacity
        style={styles.faqQuestion}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Animated.View style={[styles.chevronWrap, { transform: [{ rotate }] }]}>
          <ChevronDown size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
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
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <Text style={styles.subtitle}>
            Find answers to common questions about Forma
          </Text>

          {/* FAQ Sections */}
          {FAQ_SECTIONS.map((section) => {
            const SectionIcon = section.icon;
            return (
              <View key={section.title}>
                <View style={styles.sectionRow}>
                  <View style={styles.sectionLabelRow}>
                    <SectionIcon size={13} color={section.iconColor} strokeWidth={1.5} />
                    <Text style={styles.sectionLabel}>{section.title.toUpperCase()}</Text>
                  </View>
                </View>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardEdge}>
                    {section.items.map((item, index) => (
                      <AccordionItem
                        key={item.question}
                        item={item}
                        isFirst={index === 0}
                        isLast={index === section.items.length - 1}
                      />
                    ))}
                  </View>
                </LinearGradient>
              </View>
            );
          })}

          {/* Footer */}
          <View style={styles.footerCard}>
            <View style={styles.footerIconWrap}>
              <Mail size={14} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <View style={styles.footerContent}>
              <Text style={styles.footerTitle}>Still need help?</Text>
              <Text style={styles.footerEmail}>Contact us at support@forma.app</Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 6,
    paddingBottom: 12,
  },
  backBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
    flex: 1,
  },
  headerSpacer: {
    width: 28,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 150,
    paddingTop: 4,
  },

  /* Subtitle */
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 18,
    marginBottom: 8,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 7,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },

  /* Cards (matches Home) */
  cardGradient: {
    borderRadius: 8,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  itemDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },

  /* FAQ Items */
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: 11,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: 0.1,
    lineHeight: 21,
  },
  chevronWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqAnswerText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 21,
    paddingBottom: 10,
  },

  /* Footer */
  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 32,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(39, 48, 55, 0.78)',

    ...CARD_SHADOW,
},
  footerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerContent: {
    flex: 1,
  },
  footerTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.1,
    marginBottom: 2,
  },
  footerEmail: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
