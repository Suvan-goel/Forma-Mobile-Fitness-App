import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, Dumbbell, Info } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  COLORS,
  FONTS,
  SPACING,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_START,
  SCREEN_GRADIENT_END,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_VERTICAL_GAP,
  CARD_SHADOW,
} from '../constants/theme';
import { ArchetypeVisual, VIEW_TYPE_LABEL } from '../components/ui/CameraGuideVisuals';
import { EXERCISE_PERFORM_DATA } from '../constants/exerciseGuideData';
import type { RecordStackParamList } from '../app/RootNavigator';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type GuideRouteProp = RouteProp<RecordStackParamList, 'ExerciseGuide'>;

const EXERCISE_PERFORM_IMAGES: Record<string, ImageSourcePropType> = {
  'Barbell Curl':                     require('../assets/exercises/barbell_curl_double.png'),
  'Barbell Squat':                    require('../assets/exercises/barbell_squat_double.png'),
  'Push-Up':                          require('../assets/exercises/push_up_double.png'),
  'Cable Pushdowns':                  require('../assets/exercises/cable_pushdowns_double.png'),
  'Cable Row':                        require('../assets/exercises/cable_row_double.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises_double.png'),
  'Cable Lat Pulldowns':              require('../assets/exercises/cable_lat_pulldowns_double.png'),
  'Leg Extensions':                   require('../assets/exercises/leg_extensions_double.png'),
  'Lying Leg Curl':                   require('../assets/exercises/lying_leg_curl_double.png'),
  'Machine Ab Crunches':              require('../assets/exercises/machine_ab_crunches_double.png'),
};

type TabKey = 'record' | 'perform';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'record', label: 'RECORD' },
  { key: 'perform', label: 'PERFORM' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tab Pill
// ─────────────────────────────────────────────────────────────────────────────

const TabPill: React.FC<{
  label: string;
  isActive: boolean;
  onPress: () => void;
}> = ({ label, isActive, onPress }) => (
  <TouchableOpacity
    style={styles.pill}
    onPress={onPress}
    activeOpacity={0.7}
  >
    {isActive ? (
      <LinearGradient
        colors={['rgba(122, 85, 255, 0.26)', 'rgba(122, 85, 255, 0.12)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.pillActiveFill}
      >
        <Text style={[styles.pillText, styles.pillTextActive]}>{label}</Text>
      </LinearGradient>
    ) : (
      <Text style={styles.pillText}>{label}</Text>
    )}
  </TouchableOpacity>
);

const GuideCard: React.FC<{
  children: React.ReactNode;
  style?: object;
  edgeStyle?: object;
}> = ({ children, style, edgeStyle }) => (
  <LinearGradient
    colors={[...CARD_GRADIENT_COLORS]}
    start={CARD_GRADIENT_START}
    end={CARD_GRADIENT_END}
    style={[styles.guideCard, style]}
  >
    <View style={[styles.guideCardEdge, edgeStyle]}>
      {children}
    </View>
  </LinearGradient>
);

const SectionTitle: React.FC<{
  icon: React.ReactNode;
  title: string;
  meta?: string;
}> = ({ icon, title, meta }) => (
  <View style={styles.sectionTitleRow}>
    <View style={styles.sectionTitleLeft}>
      {icon}
      <Text style={styles.sectionHeader}>{title}</Text>
    </View>
    {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Record Tab Content
// ─────────────────────────────────────────────────────────────────────────────

const RecordTabContent: React.FC<{
  viewType: string;
  keySetup: string;
  reasonText: string;
  cameraTips?: string[];
}> = ({ viewType, keySetup, reasonText, cameraTips }) => (
  <View style={styles.tabContent}>
    <GuideCard edgeStyle={styles.visualStage}>
      <View style={styles.visualHeader}>
        <View style={styles.viewTypeChip}>
          <Camera size={13} color={COLORS.accent} strokeWidth={1.8} />
          <Text style={styles.viewTypeLabel}>
            {VIEW_TYPE_LABEL[viewType] ?? 'SIDE VIEW'}
          </Text>
        </View>
      </View>
      <ArchetypeVisual viewType={viewType} />
    </GuideCard>

    <GuideCard>
      <SectionTitle
        icon={<Info size={14} color={COLORS.accent} strokeWidth={1.8} />}
        title="SETUP"
      />
      <Text style={styles.keySetup}>{keySetup}</Text>
      <Text style={styles.reasonText}>{reasonText}</Text>
    </GuideCard>

    {cameraTips && cameraTips.length > 0 && (
      <GuideCard>
        <SectionTitle
          icon={<Camera size={14} color={COLORS.accent} strokeWidth={1.8} />}
          title="CAMERA TIPS"
          meta={`${cameraTips.length}`}
        />
        {cameraTips.map((tip, index) => (
          <View key={index} style={[styles.cameraTipRow, index > 0 && styles.rowDivider]}>
            <View style={styles.smallNumberBadge}>
              <Text style={styles.smallNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.cameraTipText}>{tip}</Text>
          </View>
        ))}
      </GuideCard>
    )}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Perform Tab Content
// ─────────────────────────────────────────────────────────────────────────────

const PerformTabContent: React.FC<{
  exerciseName: string;
}> = ({ exerciseName }) => {
  const performData = EXERCISE_PERFORM_DATA[exerciseName] ?? {
    steps: ['Position yourself correctly and perform the exercise with controlled form.'],
    commonMistakes: [],
  };

  const exerciseImage = EXERCISE_PERFORM_IMAGES[exerciseName];

  return (
    <View style={styles.tabContent}>
      {/* Exercise image */}
      {exerciseImage ? (
        <GuideCard edgeStyle={styles.imageCardEdge}>
          <Image source={exerciseImage} style={styles.exerciseImage} resizeMode="contain" />
        </GuideCard>
      ) : (
        <GuideCard edgeStyle={styles.imagePlaceholder}>
          <Text style={styles.imagePlaceholderText}>Exercise demo</Text>
        </GuideCard>
      )}

      {/* How to Perform */}
      <GuideCard>
        <SectionTitle
          icon={<Dumbbell size={14} color={COLORS.accent} strokeWidth={1.8} />}
          title="HOW TO PERFORM"
          meta={`${performData.steps.length} steps`}
        />
        {performData.steps.map((step, i) => (
          <View key={i} style={[styles.stepRow, i > 0 && styles.rowDivider]}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </GuideCard>

      {/* Common Mistakes */}
      {performData.commonMistakes.length > 0 && (
        <GuideCard>
          <SectionTitle
            icon={<AlertTriangle size={14} color={COLORS.yellow} strokeWidth={1.8} />}
            title="COMMON MISTAKES"
          />
          {performData.commonMistakes.map((mistake, i) => (
            <View key={i} style={[styles.mistakeRow, i > 0 && styles.rowDivider]}>
              <CheckCircle2 size={16} color={COLORS.textTertiary} strokeWidth={1.7} style={styles.mistakeIcon} />
              <Text style={styles.mistakeText}>{mistake}</Text>
            </View>
          ))}
        </GuideCard>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export const ExerciseGuideScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<GuideRouteProp>();
  const insets = useSafeAreaInsets();
  const { exerciseName, viewType, keySetup, reasonText, cameraTips } = route.params;

  const [activeTab, setActiveTab] = useState<TabKey>('record');

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleGotIt = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.goBack();
  }, [navigation]);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.background}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.7} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerEyebrow}>Exercise Tutorial</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {exerciseName}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <TabPill
              key={tab.key}
              label={tab.label}
              isActive={activeTab === tab.key}
              onPress={() => setActiveTab(tab.key)}
            />
          ))}
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, SPACING.xl + 54) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'record' ? (
            <RecordTabContent
              viewType={viewType}
              keySetup={keySetup}
              reasonText={reasonText}
              cameraTips={cameraTips}
            />
          ) : (
            <PerformTabContent exerciseName={exerciseName} />
          )}
        </ScrollView>

        {/* CTA Button */}
        <View style={[styles.ctaContainer, { paddingBottom: getBottomOverlayPadding(insets.bottom, SPACING.md) }]}>
          <TouchableOpacity onPress={handleGotIt} activeOpacity={0.85}>
            <LinearGradient
              colors={['#7A55FF', '#633FE5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaButton}
            >
              <Text style={styles.ctaText}>Got it</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  headerEyebrow: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 1.1,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 36,
  },

  /* ── Tab Switcher ── */
  tabBar: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: SPACING.screenHorizontal,
    marginBottom: 12,
    padding: 3,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  pill: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
  pillActiveFill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  pillText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.textTertiary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },

  /* ── Scroll ── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
  },

  /* ── Tab content shared ── */
  tabContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: CARD_VERTICAL_GAP,
  },
  guideCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  guideCardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  sectionTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Record tab: visual stage ── */
  visualStage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    overflow: 'hidden',
  },
  visualHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.20)',
  },
  viewTypeLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.text,
    letterSpacing: 1.2,
  },
  keySetup: {
    fontFamily: FONTS.display.semibold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 28,
    marginBottom: 8,
  },
  reasonText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },

  /* ── Record tab: camera tips ── */
  cameraTipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
  },
  smallNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.20)',
    marginTop: 1,
  },
  smallNumberText: {
    fontFamily: FONTS.display.bold,
    fontSize: 11,
    color: COLORS.accent,
  },
  cameraTipText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.045)',
  },

  /* ── Perform tab: image ── */
  imageCardEdge: {
    height: 230,
    padding: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },

  /* ── Perform tab: image placeholder (fallback) ── */
  imagePlaceholder: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },

  /* ── Section headers ── */
  sectionHeader: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 1.4,
  },

  /* ── Steps ── */
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.20)',
  },
  stepNumberText: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.accent,
  },
  stepText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 21,
    flex: 1,
  },
  mistakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  mistakeIcon: {
    marginTop: 2,
  },
  mistakeText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    flex: 1,
  },

  /* ── CTA ── */
  ctaContainer: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  ctaButton: {
    height: 54,
    borderRadius: CARD_RADIUS_SM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
