import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { ArchetypeVisual, VIEW_TYPE_LABEL } from '../components/ui/CameraGuideVisuals';
import { EXERCISE_PERFORM_DATA } from '../constants/exerciseGuideData';
import type { RecordStackParamList } from '../app/RootNavigator';

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
    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
      {label}
    </Text>
    {isActive && <View style={styles.pillUnderline} />}
  </TouchableOpacity>
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
    {/* Visual stage */}
    <View style={styles.visualStage}>
      <Text style={styles.viewTypeLabel}>
        {VIEW_TYPE_LABEL[viewType] ?? 'SIDE VIEW'}
      </Text>
      <ArchetypeVisual viewType={viewType} />
    </View>

    {/* Instructions */}
    <View style={styles.instructionsSection}>
      <Text style={styles.keySetup}>{keySetup}</Text>
      <Text style={styles.reasonText}>{reasonText}</Text>
      {cameraTips && cameraTips.length > 0 && (
        <View style={styles.cameraTipsSection}>
          <Text style={styles.sectionHeader}>CAMERA SETUP TIPS</Text>
          {cameraTips.map((tip, index) => (
            <View key={index} style={styles.cameraTipRow}>
              <View style={styles.cameraTipBullet} />
              <Text style={styles.cameraTipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
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
        <View style={styles.imageContainer}>
          <Image source={exerciseImage} style={styles.exerciseImage} resizeMode="contain" />
        </View>
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.imagePlaceholderText}>Exercise demo</Text>
        </View>
      )}

      {/* How to Perform */}
      <View style={styles.instructionsSection}>
        <Text style={styles.sectionHeader}>HOW TO PERFORM</Text>
        {performData.steps.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            <Text style={styles.stepNumber}>{i + 1}</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {/* Common Mistakes */}
      {performData.commonMistakes.length > 0 && (
        <View style={styles.mistakesSection}>
          <Text style={styles.sectionHeader}>COMMON MISTAKES</Text>
          {performData.commonMistakes.map((mistake, i) => (
            <View key={i} style={styles.mistakeRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.mistakeText}>{mistake}</Text>
            </View>
          ))}
        </View>
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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {exerciseName.toUpperCase()}
        </Text>
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
        contentContainerStyle={styles.scrollContent}
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
      <View style={[styles.ctaContainer, { paddingBottom: Math.max(insets.bottom, SPACING.xxl) }]}>
        <TouchableOpacity onPress={handleGotIt} activeOpacity={0.85}>
          <View style={styles.ctaButton}>
            <Text style={styles.ctaText}>Got it</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.mono.bold,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 2,
    textAlign: 'center',
    opacity: 0.7,
  },
  headerSpacer: {
    width: 36,
  },

  /* ── Tab Switcher ── */
  tabBar: {
    flexDirection: 'row',
    gap: 40,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm + 5,
    paddingBottom: SPACING.md - 2,
    justifyContent: 'center',
  },
  pill: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  pillText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 15,
    letterSpacing: 2,
    color: COLORS.textTertiary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  pillUnderline: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.accent,
  },

  /* ── Scroll ── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.lg,
  },

  /* ── Tab content shared ── */
  tabContent: {
    paddingHorizontal: SPACING.xl,
  },

  /* ── Record tab: visual stage ── */
  visualStage: {
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  viewTypeLabel: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 4,
    marginBottom: 16,
  },

  /* ── Shared instructions section ── */
  instructionsSection: {
    paddingTop: SPACING.md,
  },
  keySetup: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.primary,
    letterSpacing: -0.3,
    lineHeight: 30,
    marginBottom: 10,
  },
  reasonText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  /* ── Record tab: camera tips ── */
  cameraTipsSection: {
    paddingTop: SPACING.lg,
  },
  cameraTipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  cameraTipBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.textSecondary,
    marginTop: 8,
    marginRight: 12,
  },
  cameraTipText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  /* ── Perform tab: image ── */
  imageContainer: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  exerciseImage: {
    width: '100%',
    height: '100%',
  },

  /* ── Perform tab: image placeholder (fallback) ── */
  imagePlaceholder: {
    height: 200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  imagePlaceholderText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 1,
  },

  /* ── Section headers ── */
  sectionHeader: {
    fontFamily: FONTS.mono.bold,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 3,
    marginBottom: SPACING.md,
    marginTop: SPACING.xs,
  },

  /* ── Steps ── */
  stepRow: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
    alignItems: 'flex-start',
  },
  stepNumber: {
    fontFamily: FONTS.mono.bold,
    fontSize: 14,
    color: COLORS.primary,
    width: 24,
    opacity: 0.7,
  },
  stepText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    flex: 1,
    opacity: 0.85,
  },

  /* ── Mistakes ── */
  mistakesSection: {
    paddingTop: SPACING.lg,
  },
  mistakeRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm + 4,
    alignItems: 'flex-start',
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.textSecondary,
    marginTop: 8,
    marginRight: 12,
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
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  ctaButton: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
  },
  ctaText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
