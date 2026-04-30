/**
 * RecordLandingScreen — Capture
 *
 * Sections (matches design reference):
 *   1. Header: "Capture" + date + bell icon
 *   2. Current workout / In-progress card with Start Workout button
 *   3. Tools card (Choose Template, Exercise Guide, Camera Setup)
 *   4. Recent templates horizontal list
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  ImageSourcePropType,
  Animated,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LayoutTemplate,
  Trash2,
  Pause,
  Play,
  Flag,
  ChevronRight,
  ArrowRight,
  BookOpen,
  Camera,
  Settings as SettingsIcon,
  Clock,
  Dumbbell,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_START,
  SCREEN_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';
import { CameraSetupGuide } from './CameraSetupGuide';

import type { RecordStackParamList, RootStackParamList } from '../app/RootNavigator';
import { useCustomTemplates } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';

const CAMERA_SETUP_SEEN_KEY = '@forma_camera_setup_seen';

type RecordLandingNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'RecordLanding'
>;

const formatStopwatch = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getTimerParts = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [
    h.toString().padStart(2, '0'),
    ':',
    m.toString().padStart(2, '0'),
    ':',
    s.toString().padStart(2, '0'),
  ];
};

const formatDateLine = (): string => {
  const d = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `Today, ${months[d.getMonth()]} ${d.getDate()}`;
};

type CaptureTemplate = {
  id: string;
  name: string;
  description: string;
  templateImage?: ImageSourcePropType;
  exercises: {
    name: string;
    category: string;
    targetSets: number;
  }[];
};

const TEMPLATE_IMAGES_BY_NAME: Record<string, ImageSourcePropType> = {
  'lower body strength': require('../assets/generated/templates/lower-body-strength.png'),
  'upper body push': require('../assets/generated/templates/push-day.png'),
  'push day': require('../assets/generated/templates/push-day.png'),
  'pull strength': require('../assets/generated/templates/pull-day.png'),
  'pull day': require('../assets/generated/templates/pull-day.png'),
  'full body': require('../assets/generated/templates/full-body.png'),
};

const EXERCISE_IMAGES_BY_NAME: Record<string, ImageSourcePropType> = {
  'Barbell Squat': require('../assets/exercises/barbell_squat.png'),
  'Back Squat': require('../assets/exercises/barbell_squat.png'),
  'Push-Up': require('../assets/exercises/push_up.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises.png'),
  'Cable Pushdowns': require('../assets/exercises/cable_pushdowns.png'),
  'Cable Row': require('../assets/exercises/cable_row.png'),
  'Cable Lat Pulldowns': require('../assets/exercises/cable_lat_pulldowns.png'),
  'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
  'Leg Extensions': require('../assets/exercises/leg_extensions.png'),
  'Lying Leg Curl': require('../assets/exercises/lying_leg_curl.png'),
  'Machine Ab Crunches': require('../assets/exercises/machine_ab_crunches.png'),
};

const DEFAULT_TEMPLATE_IMAGE = require('../assets/generated/templates/full-body.png');

const getTemplateImage = (template: CaptureTemplate): ImageSourcePropType => {
  const namedTemplate = TEMPLATE_IMAGES_BY_NAME[template.name.trim().toLowerCase()];
  if (template.templateImage || namedTemplate) {
    return template.templateImage ?? namedTemplate;
  }

  return EXERCISE_IMAGES_BY_NAME[template.exercises[0]?.name] ?? DEFAULT_TEMPLATE_IMAGE;
};

const DEFAULT_TEMPLATES: CaptureTemplate[] = [
  {
    id: 'default-lower-body',
    name: 'Lower Body Strength',
    description: 'Squat-focused lower body session.',
    templateImage: require('../assets/generated/templates/lower-body-strength.png'),
    exercises: [
      { name: 'Barbell Squat', category: 'Weightlifting', targetSets: 4 },
      { name: 'Leg Extensions', category: 'Weightlifting', targetSets: 3 },
      { name: 'Lying Leg Curl', category: 'Weightlifting', targetSets: 3 },
    ],
  },
  {
    id: 'default-upper-push',
    name: 'Upper Body Push',
    description: 'Chest, shoulders, and triceps.',
    templateImage: require('../assets/generated/templates/push-day.png'),
    exercises: [
      { name: 'Push-Up', category: 'Calisthenics', targetSets: 4 },
      { name: 'Standing Dumbbell Lateral Raises', category: 'Weightlifting', targetSets: 3 },
      { name: 'Cable Pushdowns', category: 'Weightlifting', targetSets: 3 },
    ],
  },
  {
    id: 'default-pull',
    name: 'Pull Strength',
    description: 'Back and biceps session.',
    templateImage: require('../assets/generated/templates/pull-day.png'),
    exercises: [
      { name: 'Cable Row', category: 'Weightlifting', targetSets: 4 },
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting', targetSets: 3 },
      { name: 'Barbell Curl', category: 'Weightlifting', targetSets: 3 },
    ],
  },
];

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { templates } = useCustomTemplates();
  const {
    workoutInProgress,
    sets,
    workoutElapsedSeconds,
    setWorkoutElapsedSeconds,
    workoutPaused,
    setWorkoutPaused,
    clearSets,
  } = useCurrentWorkout();
  const navigationBarHeight = 90 + Math.max(insets.bottom, 8);
  const sectionGap = windowHeight < 740 ? 10 : 14;
  const contentMinHeight = Math.max(430, windowHeight - insets.top - navigationBarHeight - 56);
  const availableSectionHeight = contentMinHeight - sectionGap * 2;
  const standardSectionHeight = Math.floor(availableSectionHeight * 0.305);
  const templateSectionHeight = Math.max(standardSectionHeight + 18, availableSectionHeight - standardSectionHeight * 2);
  const templateCardHeight = Math.max(132, Math.min(156, templateSectionHeight - 18));
  const templateCardWidth = (windowWidth - SPACING.screenHorizontal * 2 - 9 * 2) / 3;
  const templateThumbHeight = Math.max(78, Math.min(100, templateCardHeight - 62));

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const [showSetupGuide, setShowSetupGuide] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CAMERA_SETUP_SEEN_KEY).then((value) => {
      setShowSetupGuide(value !== 'true');
    }).catch(() => {
      setShowSetupGuide(false);
    });
  }, []);

  const handleGuideComplete = useCallback(() => {
    AsyncStorage.setItem(CAMERA_SETUP_SEEN_KEY, 'true');
    setShowSetupGuide(false);
  }, []);

  useEffect(() => {
    if (!workoutInProgress || workoutPaused) return;
    const interval = setInterval(() => {
      setWorkoutElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [workoutInProgress, workoutPaused, setWorkoutElapsedSeconds]);

  const handleStartWorkout = () => navigation.navigate('CurrentWorkout');
  const handleResumeWorkout = () => navigation.navigate('CurrentWorkout');
  const handleChooseTemplate = () => navigation.navigate('WorkoutTemplates');
  const handleCameraSetup = () => setShowSetupGuide(true);

  const handleDiscardWorkout = () => {
    showAlert(
      'Discard workout',
      'Are you sure? This will clear all sets and time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: clearSets },
      ]
    );
  };

  const handlePauseWorkout = () => setWorkoutPaused((p) => !p);

  const handleFinishWorkout = () => {
    if (sets.length === 0) {
      showAlert('No sets recorded', 'Add at least one set before ending the workout.');
      return;
    }
    const duration = formatStopwatch(workoutElapsedSeconds);
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      sets.reduce((sum, set) => sum + set.formScore, 0) / sets.length
    );
    const category = sets[0]?.exerciseName || 'General';

    navigation.navigate('SaveWorkout', {
      workoutData: { category, duration, totalSets, totalReps, avgFormScore },
    });
  };

  if (showSetupGuide === null) return <View style={styles.container} />;
  if (showSetupGuide) {
    return (
      <Modal visible animationType="none" statusBarTranslucent>
        <CameraSetupGuide onComplete={handleGuideComplete} />
      </Modal>
    );
  }

  const savedTemplates: CaptureTemplate[] = templates.slice(0, 3).map(template => ({
      id: template.id,
      name: template.name,
      description: template.description || 'Your saved workout template.',
      exercises: template.exercises.map(exercise => ({
        name: exercise.name,
        category: exercise.category,
        targetSets: exercise.targetSets,
      })),
    }));
  const savedTemplateNames = new Set(savedTemplates.map(template => template.name.trim().toLowerCase()));
  const recentTemplates: CaptureTemplate[] = [
    ...savedTemplates,
    ...DEFAULT_TEMPLATES.filter(template => !savedTemplateNames.has(template.name.trim().toLowerCase())),
  ].slice(0, 3);
  const templatesLabel = templates.length > 0 ? 'RECENT TEMPLATES' : 'FAVOURITE TEMPLATES';

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      {/* ── HEADER ──────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.headerTitle}>CAPTURE</Text>
        <View style={styles.headerSide}>
          <TouchableOpacity
            onPress={() => rootNavigation.navigate('Settings')}
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <SettingsIcon size={20} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: navigationBarHeight }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.contentStack,
            {
              minHeight: contentMinHeight,
              gap: sectionGap,
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={[styles.screenSection, { minHeight: standardSectionHeight }]}>
            <Text style={styles.dateLine}>{formatDateLine()}</Text>

            {workoutInProgress ? (
              /* ── ACTIVE WORKOUT CARD ── */
              <View style={styles.activeOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activeGradient}
              >
                <View style={styles.activeEdge}>
                  <View style={styles.activeBody}>
                    <View style={styles.activeBodyText}>
                      <Text style={styles.activeWorkoutName}>CURRENT WORKOUT</Text>
                      <View style={styles.timerDisplay}>
                        {getTimerParts(workoutElapsedSeconds).map((part, i) => (
                          <MonoText
                            key={i}
                            bold={part !== ':'}
                            style={part === ':' ? styles.timerColon : styles.timerDigit}
                          >
                            {part}
                          </MonoText>
                        ))}
                      </View>
                      <View style={styles.activeMetaRow}>
                        <View style={styles.metaIconRow}>
                          <Dumbbell size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>{sets.length} sets</Text>
                        </View>
                        <View style={styles.metaIconRow}>
                          <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>
                            {sets.reduce((sum, set) => sum + set.reps, 0)} reps
                          </Text>
                        </View>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.pauseBtn, workoutPaused && styles.pauseBtnActive]}
                      onPress={handlePauseWorkout}
                      activeOpacity={0.7}
                    >
                      {workoutPaused ? (
                        <Play size={16} color={COLORS.text} strokeWidth={2} />
                      ) : (
                        <Pause size={16} color={COLORS.textSecondary} strokeWidth={2} />
                      )}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={handleResumeWorkout}
                    activeOpacity={0.85}
                    style={styles.startBtnOuter}
                  >
                    <LinearGradient
                      colors={['#7A55FF', '#633FE5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.startBtn}
                    >
                      <Text style={styles.startBtnText}>Open workout</Text>
                      <ArrowRight size={14} color="#FFFFFF" strokeWidth={2.5} />
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.activeFooterRow}>
                    <TouchableOpacity
                      style={styles.footerBtn}
                      onPress={handleDiscardWorkout}
                      activeOpacity={0.7}
                    >
                      <Trash2 size={13} color={COLORS.red} strokeWidth={1.7} />
                      <Text style={[styles.footerBtnText, { color: COLORS.red }]}>Discard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.footerBtn}
                      onPress={handleFinishWorkout}
                      activeOpacity={0.7}
                    >
                      <Flag size={13} color={COLORS.green} strokeWidth={1.7} />
                      <Text style={[styles.footerBtnText, { color: COLORS.green }]}>Finish</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </LinearGradient>
            </View>
            ) : (
              /* ── QUICK START (idle) CARD ── */
              <View style={styles.activeOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activeGradient}
              >
                <View style={[styles.activeEdge, styles.idleEdge]}>
                  <View style={styles.idleCardContent}>
                    <View style={styles.idleTextWrap}>
                      <Text style={styles.cardLabel}>READY TO TRAIN</Text>
                      <Text style={styles.idleTitle}>Start a Session</Text>
                      <View style={styles.idleMetaRow}>
                        <View style={styles.metaIconRow}>
                          <Dumbbell size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>Any workout</Text>
                        </View>
                        <View style={styles.metaIconRow}>
                          <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>~30 min</Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={handleStartWorkout}
                        activeOpacity={0.85}
                        style={styles.idleStartBtnOuter}
                      >
                        <LinearGradient
                          colors={['#7A55FF', '#633FE5']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.idleStartBtn}
                        >
                          <Play size={14} color="#FFFFFF" strokeWidth={2.5} fill="#FFFFFF" />
                          <Text style={styles.startBtnText}>Start Workout</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.bodyVisual}>
                      <Image
                        source={require('../assets/generated/workout-card-figure.png')}
                        style={styles.bodyVisualImage}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </View>
            )}
          </View>

          {/* ── TOOLS ───────────────────────────────── */}
          <View style={[styles.screenSection, { minHeight: standardSectionHeight }]}>
            <Text style={styles.sectionLabel}>TOOLS</Text>
            <View style={styles.toolsCardOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.toolsCard}
              >
                <ToolRow
                  icon={<LayoutTemplate size={18} color={COLORS.accent} strokeWidth={1.6} />}
                  title="Choose Template"
                  subtitle="Browse saved workouts"
                  onPress={handleChooseTemplate}
                  divider
                />
                <ToolRow
                  icon={<BookOpen size={18} color={COLORS.accent} strokeWidth={1.6} />}
                  title="Exercise Guide"
                  subtitle="Learn form and technique"
                  onPress={() => rootNavigation.navigate('Tutorials')}
                  divider
                />
                <ToolRow
                  icon={<Camera size={18} color={COLORS.accent} strokeWidth={1.6} />}
                  title="Camera Setup"
                  subtitle="Check angles and positioning"
                  onPress={handleCameraSetup}
                />
              </LinearGradient>
            </View>
          </View>

          {/* ── RECENT / FAVOURITE TEMPLATES ───────── */}
          <View style={[styles.screenSection, styles.templatesBlock, { minHeight: templateSectionHeight }]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>{templatesLabel}</Text>
              <TouchableOpacity
                onPress={handleChooseTemplate}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.viewAllLink}>View all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.templatesRow}>
              {recentTemplates.slice(0, 3).map((tmpl) => (
                <TouchableOpacity
                  key={tmpl.id}
                  style={[styles.templateCard, { width: templateCardWidth, height: templateCardHeight }]}
                  activeOpacity={0.85}
                  onPress={() =>
                    navigation.navigate('TemplatePreview', {
                      templateName: tmpl.name,
                      description: tmpl.description,
                      exercises: tmpl.exercises.map(e => ({
                        name: e.name,
                        category: e.category,
                        targetSets: e.targetSets,
                      })),
                    })
                  }
                >
                  <LinearGradient
                    colors={[...CARD_GRADIENT_COLORS]}
                    start={CARD_GRADIENT_START}
                    end={CARD_GRADIENT_END}
                    style={styles.templateGradient}
                  >
                    <View style={[styles.templateThumb, { height: templateThumbHeight }]}>
                      <Image
                        source={getTemplateImage(tmpl)}
                        style={styles.templateThumbImage}
                        resizeMode="cover"
                      />
                      <View style={styles.templateThumbShade} />
                    </View>
                    <View style={styles.templateInfo}>
                      <Text style={styles.templateMeta}>
                        {tmpl.exercises.length} exercise{tmpl.exercises.length === 1 ? '' : 's'}
                      </Text>
                      <Text style={styles.templateName} numberOfLines={2}>{tmpl.name}</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </LinearGradient>
  );
};

// ── Tool Row ───────────────────────────────────

const ToolRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  divider?: boolean;
}> = ({ icon, title, subtitle, onPress, divider }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    style={[styles.toolRow, divider && styles.toolRowDivider]}
  >
    <View style={styles.toolIconWrap}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={styles.toolTitle}>{title}</Text>
      <Text style={styles.toolSubtitle}>{subtitle}</Text>
    </View>
    <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.6} />
  </TouchableOpacity>
);

// ── Styles ─────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 8,
  },
  headerSide: { alignItems: 'flex-end' },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    flexGrow: 1,
  },
  contentStack: {
    paddingBottom: 8,
  },
  screenSection: {
    justifyContent: 'center',
    paddingVertical: 2,
  },

  dateLine: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },

  /* Card label */
  cardLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
  },

  /* Active / Idle workout card */
  activeOuter: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  activeGradient: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  activeEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 14,
  },

  /* Idle body */
  idleEdge: {
    paddingRight: 7,
    overflow: 'hidden',
  },
  idleCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 146,
  },
  idleTextWrap: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: 9,
    paddingRight: 10,
  },
  idleTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 19,
    color: COLORS.text,
    letterSpacing: -0.35,
    marginTop: 2,
  },
  idleMetaRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  bodyVisual: {
    width: 108,
    height: 150,
    marginRight: -2,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  bodyVisualImage: {
    width: '100%',
    height: '100%',
  },
  metaIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  /* Active body */
  activeBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    marginBottom: 16,
  },
  activeBodyText: { flex: 1, gap: 7 },
  activeWorkoutName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: 0,
  },
  activeMetaRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 1,
  },

  /* Timer (active) */
  timerDisplay: { flexDirection: 'row', alignItems: 'center' },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    fontSize: 29,
    color: COLORS.text,
    lineHeight: 33,
    letterSpacing: 1.1,
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    fontSize: 22,
    color: 'rgba(122, 85, 255, 0.62)',
    lineHeight: 33,
    marginHorizontal: 1,
  },
  pauseBtn: {
    width: 42, height: 42, borderRadius: 21,
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    alignItems: 'center', justifyContent: 'center',
  },
  pauseBtnActive: {
    borderColor: 'rgba(122, 85, 255, 0.32)',
    backgroundColor: 'rgba(122, 85, 255, 0.14)',
  },

  /* Active footer */
  activeFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.045)',
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  footerBtnText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
  },

  /* Start button */
  startBtnOuter: { borderRadius: CARD_RADIUS_SM, overflow: 'hidden' },
  idleStartBtnOuter: {
    width: '100%',
    maxWidth: 218,
    borderRadius: CARD_RADIUS_SM,
    overflow: 'hidden',
    marginTop: 2,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
    paddingVertical: 11,
  },
  idleStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  startBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  /* Section labels */
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
    marginTop: 0,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 0,
    marginBottom: 8,
  },
  viewAllLink: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.accent,
  },

  /* Tools */
  toolsCardOuter: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  toolsCard: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    overflow: 'hidden',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10.5,
  },
  toolRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.055)',
  },
  toolIconWrap: {
    width: 29,
    height: 29,
    borderRadius: 7,
    backgroundColor: 'rgba(124,92,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  toolSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 1,
  },

  /* Templates */
  templatesRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'stretch',
    minHeight: 132,
  },
  templatesBlock: {
    justifyContent: 'center',
    paddingBottom: 6,
  },
  templateCard: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  templateGradient: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 20,
    gap: 6,
    overflow: 'hidden',
  },
  templateThumb: {
    width: '100%',
    borderTopLeftRadius: CARD_RADIUS,
    borderTopRightRadius: CARD_RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  templateThumbImage: {
    width: '100%',
    height: '100%',
  },
  templateThumbShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  templateInfo: {
    gap: 2,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  templateName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.text,
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  templateMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textSecondary,
  },
});
