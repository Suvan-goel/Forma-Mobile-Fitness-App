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
  ChevronDown,
  Camera,
  Dumbbell,
  BarChart2,
  Volume2,
  Mail,
  Star,
  Sparkles,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_VERTICAL_GAP,
  CARD_SHADOW
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

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

const AccordionItem: React.FC<{
  item: FAQItem;
  isFirst: boolean;
  isLast: boolean;
  accentColor: string;
}> = ({ item, isFirst, isLast, accentColor }) => {
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
        style={[styles.faqQuestion, isLast && !expanded && styles.faqQuestionLast]}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Animated.View style={[
          styles.chevronWrap,
          expanded && { backgroundColor: `${accentColor}1F` },
          { transform: [{ rotate }] },
        ]}>
          <ChevronDown size={15} color={expanded ? accentColor : COLORS.textTertiary} strokeWidth={1.8} />
        </Animated.View>
      </TouchableOpacity>
      <Animated.View style={{ maxHeight, overflow: 'hidden' }}>
        <Text style={[styles.faqAnswerText, isLast && styles.faqAnswerTextLast]}>{item.answer}</Text>
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
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="HELP CENTER" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 112) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <LinearGradient
            colors={['rgba(122, 85, 255, 0.18)', 'rgba(26, 31, 35, 0.92)', 'rgba(17, 22, 26, 0.92)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroEdge}>
              <View style={styles.heroIconWrap}>
                <Sparkles size={18} color={COLORS.primary} strokeWidth={1.8} />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>SUPPORT</Text>
                <Text style={styles.heroTitle}>Get unstuck quickly</Text>
                <Text style={styles.heroText}>
                  Setup, scoring, rewards, and coaching guidance in one place.
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* FAQ Sections */}
          {FAQ_SECTIONS.map((section) => {
            const SectionIcon = section.icon;
            return (
              <View key={section.title} style={styles.sectionBlock}>
                <LinearGradient
                  colors={[...CARD_GRADIENT_COLORS]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardEdge}>
                    <View style={styles.sectionHeader}>
                      <View style={[styles.sectionIconWrap, { backgroundColor: `${section.iconColor}18` }]}>
                        <SectionIcon size={17} color={section.iconColor} strokeWidth={1.8} />
                      </View>
                      <View style={styles.sectionTitleWrap}>
                        <Text style={styles.sectionTitle}>{section.title}</Text>
                        <Text style={styles.sectionMeta}>{section.items.length} common questions</Text>
                      </View>
                    </View>
                    {section.items.map((item, index) => (
                      <AccordionItem
                        key={item.question}
                        item={item}
                        isFirst={index === 0}
                        isLast={index === section.items.length - 1}
                        accentColor={section.iconColor}
                      />
                    ))}
                  </View>
                </LinearGradient>
              </View>
            );
          })}

          {/* Footer */}
          <LinearGradient
            colors={['rgba(39, 48, 55, 0.96)', 'rgba(20, 25, 30, 0.96)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.footerCard}
          >
            <View style={styles.footerEdge}>
              <View style={styles.footerIconWrap}>
                <Mail size={16} color={COLORS.primary} strokeWidth={1.8} />
              </View>
              <View style={styles.footerContent}>
                <Text style={styles.footerTitle}>Still need help?</Text>
                <Text style={styles.footerEmail}>support@forma.app</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 2,
  },

  /* Hero */
  heroCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  heroEdge: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.075)',
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  heroIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.26)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
  },
  heroEyebrow: {
    fontFamily: FONTS.display.bold,
    fontSize: 10,
    color: COLORS.primary,
    letterSpacing: 0,
    marginBottom: 4,
  },
  heroTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 21,
    color: COLORS.text,
    marginBottom: 4,
  },
  heroText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
  },

  /* Sections */
  sectionBlock: {
    marginTop: CARD_VERTICAL_GAP,
  },

  /* Cards (matches Home) */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingTop: 14,
    paddingBottom: 13,
  },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleWrap: {
    flex: 1,
  },
  sectionTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 2,
  },
  sectionMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
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
    paddingVertical: 13,
    gap: 11,
  },
  faqQuestionLast: {
    paddingBottom: 15,
  },
  faqQuestionText: {
    flex: 1,
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0,
    lineHeight: 20,
  },
  chevronWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqAnswerText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 20,
    paddingRight: 32,
    paddingBottom: 14,
  },
  faqAnswerTextLast: {
    paddingBottom: 16,
  },

  /* Footer */
  footerCard: {
    marginTop: 18,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
},
  footerEdge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.11)',
  },
  footerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerContent: {
    flex: 1,
  },
  footerTitle: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0,
    marginBottom: 2,
  },
  footerEmail: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textSecondary,
  },
});
