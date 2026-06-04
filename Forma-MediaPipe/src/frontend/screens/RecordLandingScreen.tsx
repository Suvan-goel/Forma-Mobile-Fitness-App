/**
 * RecordLandingScreen — Capture
 *
 * Sections (matches design reference):
 *   1. Header: "Capture" + date + bell icon
 *   2. Current workout / In-progress card with Start Workout button
 *   3. Tools card (Exercise Guide, Camera Setup)
 *   4. Recent templates horizontal list
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  ImageSourcePropType,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Pause,
  Play,
  ChevronRight,
  ArrowRight,
  BookOpen,
  Camera,
  LayoutTemplate,
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
  CARD_SHADOW,
} from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';
import { AppHeader } from '../components/ui/AppHeader';
import { CameraSetupGuide } from './CameraSetupGuide';
import { getTabScreenBottomPadding } from '../utils/safeAreaSpacing';

import type {
  RecordStackParamList,
  RootStackParamList,
} from '../app/RootNavigator';
import { useCustomTemplates } from '../../backend/hooks/useCustomTemplates';
import { useAlert } from '../contexts/AlertContext';

const CAMERA_SETUP_SEEN_KEY = '@forma_camera_setup_seen';
const CAPTURE_HORIZONTAL_PADDING = 14;
const CAPTURE_SECTION_GAP = 22;
const TEMPLATE_CARD_GAP = 9;
const CAPTURE_CARD_HEIGHT = 188;
const CAPTURE_CARD_HEIGHT_TALL = 200;
const TOOLS_CARD_HEIGHT = 174;
const TOOLS_CARD_HEIGHT_TALL = 186;
const CAPTURE_CARD_HORIZONTAL_PADDING = 15;
const CAPTURE_CARD_VERTICAL_PADDING = 18;
const TEMPLATE_CARD_EXTRA_HEIGHT = 76;
const TEMPLATE_THUMB_HEIGHT = 108;
const TEMPLATE_THUMB_HEIGHT_COMPACT = 92;
const BODY_VISUAL_WIDTH = 112;
const BODY_VISUAL_HEIGHT = 146;
const ACTIVE_SECONDARY_ACTIONS_WIDTH = 152;
const CAPTURE_CARD_RADIUS = CARD_RADIUS - 2;
const START_SESSION_CARD_GRADIENT: readonly [string, string, string] = [
  'rgba(34, 39, 43, 0.80)',
  'rgba(41, 46, 50, 0.80)',
  'rgba(48, 53, 57, 0.80)',
];
const TOOLS_CARD_GRADIENT: readonly [string, string, string] = [
  'rgba(34, 39, 43, 0.80)',
  'rgba(40, 45, 49, 0.80)',
  'rgba(44, 49, 53, 0.80)',
];

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
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
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

const EXERCISE_IMAGES_BY_NAME: Record<string, ImageSourcePropType> = {
  'Barbell Squat': require('../assets/exercises/barbell_squat.png'),
  'Back Squat': require('../assets/exercises/barbell_squat.png'),
  'Push-Up': require('../assets/exercises/push_up.png'),
  'Standing Dumbbell Lateral Raises': require('../assets/exercises/standing_dumbbell_lateral_raises.png'),
  'Cable Pushdowns': require('../assets/exercises/cable_pushdowns.png'),
  'Cable Row': require('../assets/exercises/cable_row.png'),
  'Cable Lat Pulldowns': require('../assets/exercises/cable_lat_pulldowns.png'),
  'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
  'Romanian Deadlift': require('../assets/exercises/lying_leg_curl.png'),
  'Walking Lunge': require('../assets/exercises/leg_extensions.png'),
  'Leg Press': require('../assets/exercises/leg_extensions.png'),
  'Leg Extensions': require('../assets/exercises/leg_extensions.png'),
  'Lying Leg Curl': require('../assets/exercises/lying_leg_curl.png'),
  'Machine Ab Crunches': require('../assets/exercises/machine_ab_crunches.png'),
};

const DEFAULT_EXERCISE_IMAGE = require('../assets/sports_bg.png');

const getExerciseImage = (name: string): ImageSourcePropType =>
  EXERCISE_IMAGES_BY_NAME[name] ?? DEFAULT_EXERCISE_IMAGE;

const getTemplateCollageSources = (
  exercises: CaptureTemplate['exercises'],
): ImageSourcePropType[] => {
  const baseSources =
    exercises.length > 0
      ? exercises.map((exercise) => getExerciseImage(exercise.name))
      : [DEFAULT_EXERCISE_IMAGE];

  return Array.from(
    { length: 4 },
    (_, index) => baseSources[index % baseSources.length],
  );
};

const DEFAULT_TEMPLATES: CaptureTemplate[] = [
  {
    id: 'default-lower-body',
    name: 'Lower Body Strength',
    description: 'Squat-focused lower body session.',
    templateImage: require('../assets/generated/templates/lower-body-strength.png'),
    exercises: [
      { name: 'Back Squat', category: 'Weightlifting', targetSets: 4 },
      { name: 'Romanian Deadlift', category: 'Weightlifting', targetSets: 3 },
      { name: 'Walking Lunge', category: 'Weightlifting', targetSets: 3 },
      { name: 'Leg Press', category: 'Weightlifting', targetSets: 3 },
    ],
  },
  {
    id: 'default-upper-push',
    name: 'Push Day',
    description: 'Chest, shoulders, and triceps.',
    templateImage: require('../assets/generated/templates/push-day.png'),
    exercises: [
      { name: 'Push-Up', category: 'Calisthenics', targetSets: 4 },
      {
        name: 'Standing Dumbbell Lateral Raises',
        category: 'Weightlifting',
        targetSets: 3,
      },
      { name: 'Cable Pushdowns', category: 'Weightlifting', targetSets: 3 },
      { name: 'Machine Ab Crunches', category: 'Weightlifting', targetSets: 3 },
    ],
  },
  {
    id: 'default-pull',
    name: 'Pull Day',
    description: 'Back and biceps session.',
    templateImage: require('../assets/generated/templates/pull-day.png'),
    exercises: [
      { name: 'Cable Lat Pulldowns', category: 'Weightlifting', targetSets: 4 },
      { name: 'Cable Row', category: 'Weightlifting', targetSets: 3 },
      { name: 'Barbell Curl', category: 'Weightlifting', targetSets: 3 },
      { name: 'Machine Ab Crunches', category: 'Weightlifting', targetSets: 3 },
    ],
  },
];

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
  const navigationBarHeight = getTabScreenBottomPadding(insets.bottom, 24);
  const compactHeight = windowHeight < 740;
  const captureCardHeight = Math.min(
    CAPTURE_CARD_HEIGHT_TALL,
    Math.max(CAPTURE_CARD_HEIGHT, Math.round(windowHeight * 0.22)),
  );
  const toolsCardHeight = Math.min(
    TOOLS_CARD_HEIGHT_TALL,
    Math.max(TOOLS_CARD_HEIGHT, Math.round(windowHeight * 0.205)),
  );
  const bodyVisualHeight = captureCardHeight - CAPTURE_CARD_VERTICAL_PADDING * 2;
  const bodyVisualWidth = Math.round(
    BODY_VISUAL_WIDTH * (bodyVisualHeight / BODY_VISUAL_HEIGHT),
  );
  const templateCardWidth =
    (windowWidth - CAPTURE_HORIZONTAL_PADDING * 2 - TEMPLATE_CARD_GAP * 2) / 3;
  const templateThumbHeight = Math.min(
    templateCardWidth + 6,
    compactHeight ? TEMPLATE_THUMB_HEIGHT_COMPACT : TEMPLATE_THUMB_HEIGHT,
  );
  const templateCardHeight = templateThumbHeight + TEMPLATE_CARD_EXTRA_HEIGHT;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const [showSetupGuide, setShowSetupGuide] = useState<boolean | null>(null);
  const [captureViewportHeight, setCaptureViewportHeight] = useState(0);
  const [captureContentHeight, setCaptureContentHeight] = useState(0);
  const captureCanScroll =
    captureViewportHeight > 0 && captureContentHeight > captureViewportHeight + 1;

  useEffect(() => {
    AsyncStorage.getItem(CAMERA_SETUP_SEEN_KEY)
      .then((value) => {
        setShowSetupGuide(value !== 'true');
      })
      .catch(() => {
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
      ],
    );
  };

  const handlePauseWorkout = () => setWorkoutPaused((p) => !p);

  const handleFinishWorkout = () => {
    if (sets.length === 0) {
      showAlert(
        'No sets recorded',
        'Add at least one set before ending the workout.',
      );
      return;
    }
    const duration = formatStopwatch(workoutElapsedSeconds);
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const scoredSets = sets.filter((set) => !set.isManual && set.formScore > 0);
    const avgFormScore = scoredSets.length > 0
      ? Math.round(scoredSets.reduce((sum, set) => sum + set.formScore, 0) / scoredSets.length)
      : 0;
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

  const savedTemplates: CaptureTemplate[] = templates
    .slice(0, 3)
    .map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description || 'Your saved workout template.',
      exercises: template.exercises.map((exercise) => ({
        name: exercise.name,
        category: exercise.category,
        targetSets: exercise.targetSets,
      })),
    }));
  const savedTemplateNames = new Set(
    savedTemplates.map((template) => template.name.trim().toLowerCase()),
  );
  const recentTemplates: CaptureTemplate[] = [
    ...savedTemplates,
    ...DEFAULT_TEMPLATES.filter(
      (template) => !savedTemplateNames.has(template.name.trim().toLowerCase()),
    ),
  ].slice(0, 3);
  const templatesLabel =
    templates.length > 0 ? 'RECENT TEMPLATES' : 'FAVOURITE TEMPLATES';

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      {/* ── HEADER ──────────────────────────────── */}
      <AppHeader
        title="CAPTURE"
        topInset={insets.top}
        rightSlot={
          <View style={styles.headerSide}>
            <TouchableOpacity
              onPress={() => rootNavigation.navigate('Settings')}
              style={styles.iconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <SettingsIcon
                size={20}
                color={COLORS.textSecondary}
                strokeWidth={1.6}
              />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        style={styles.captureScroll}
        contentContainerStyle={[
          styles.captureContent,
          { paddingBottom: navigationBarHeight },
        ]}
        scrollEnabled={captureCanScroll}
        bounces={captureCanScroll}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={captureCanScroll}
        onLayout={(event) => setCaptureViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setCaptureContentHeight(height)}
      >
        <Animated.View
          style={[
            styles.contentStack,
            {
              gap: CAPTURE_SECTION_GAP,
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.screenSection}>
            <Text style={styles.dateLine}>{formatDateLine()}</Text>

            {workoutInProgress ? (
              /* ── ACTIVE WORKOUT CARD ── */
              <View style={styles.activeOuter}>
                <LinearGradient
                  colors={[...START_SESSION_CARD_GRADIENT]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.activeGradient}
                >
                  <View
                    style={[
                      styles.activeEdge,
                      styles.activeWorkoutEdge,
                      { height: captureCardHeight },
                    ]}
                  >
                    <View style={styles.activeDashboardTop}>
                      <View style={styles.activeTitleBlock}>
                        <Text style={styles.activeEyebrow}>IN PROGRESS</Text>
                        <Text style={styles.activeWorkoutTitle}>
                          Current Workout
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.activePauseControl,
                          workoutPaused && styles.activePauseControlActive,
                        ]}
                        onPress={handlePauseWorkout}
                        activeOpacity={0.7}
                      >
                        {workoutPaused ? (
                          <Play size={16} color={COLORS.text} strokeWidth={2} />
                        ) : (
                          <Pause
                            size={16}
                            color={COLORS.textSecondary}
                            strokeWidth={2}
                          />
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={styles.activeDashboardMiddle}>
                      <View style={styles.activeTimerPanel}>
                        <View style={styles.timerDisplay}>
                          {getTimerParts(workoutElapsedSeconds).map(
                            (part, i) => (
                              <MonoText
                                key={i}
                                bold={part !== ':'}
                                style={
                                  part === ':'
                                    ? styles.timerColon
                                    : styles.timerDigit
                                }
                              >
                                {part}
                              </MonoText>
                            ),
                          )}
                        </View>
                      </View>
                      <View style={styles.activeStatsPanel}>
                        <View style={styles.activeStatItem}>
                          <MonoText bold style={styles.activeStatValue}>
                            {sets.length}
                          </MonoText>
                          <Text style={styles.activeStatLabel}>sets</Text>
                        </View>
                        <View style={styles.activeStatDivider} />
                        <View style={styles.activeStatItem}>
                          <MonoText bold style={styles.activeStatValue}>
                            {sets.reduce((sum, set) => sum + set.reps, 0)}
                          </MonoText>
                          <Text style={styles.activeStatLabel}>reps</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.activeActionStrip}>
                      <TouchableOpacity
                        onPress={handleResumeWorkout}
                        activeOpacity={0.85}
                        style={styles.activePrimaryAction}
                      >
                        <LinearGradient
                          colors={['#7A55FF', '#633FE5']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.activePrimaryGradient}
                        >
                          <Text style={styles.startBtnText}>Open</Text>
                          <ArrowRight
                            size={14}
                            color="#FFFFFF"
                            strokeWidth={2.5}
                          />
                        </LinearGradient>
                      </TouchableOpacity>
                      <View style={styles.activeSecondaryActions}>
                        <TouchableOpacity
                          style={styles.activeSecondaryButton}
                          onPress={handleDiscardWorkout}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.activeSecondaryText,
                              { color: COLORS.red },
                            ]}
                          >
                            Discard
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.activeSecondaryButton}
                          onPress={handleFinishWorkout}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.activeSecondaryText,
                              { color: COLORS.green },
                            ]}
                          >
                            Finish
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </LinearGradient>
              </View>
            ) : (
              /* ── QUICK START (idle) CARD ── */
              <View style={styles.activeOuter}>
                <LinearGradient
                  colors={[...START_SESSION_CARD_GRADIENT]}
                  start={CARD_GRADIENT_START}
                  end={CARD_GRADIENT_END}
                  style={styles.activeGradient}
                >
                  <View
                    style={[
                      styles.activeEdge,
                      styles.idleEdge,
                      { height: captureCardHeight },
                    ]}
                  >
                    <View
                      style={[
                        styles.idleCardContent,
                        {
                          minHeight:
                            captureCardHeight - CAPTURE_CARD_VERTICAL_PADDING * 2,
                        },
                      ]}
                    >
                      <View style={styles.idleTextWrap}>
                        <View style={styles.idleCopyBlock}>
                          <Text style={styles.cardLabel}>READY TO TRAIN</Text>
                          <Text style={styles.idleTitle}>Start a Session</Text>
                          <View style={styles.idleMetaRow}>
                            <View style={styles.metaIconRow}>
                              <Dumbbell
                                size={12}
                                color={COLORS.textTertiary}
                                strokeWidth={1.6}
                              />
                              <Text style={styles.metaText}>Any workout</Text>
                            </View>
                            <View style={styles.metaIconRow}>
                              <Clock
                                size={12}
                                color={COLORS.textTertiary}
                                strokeWidth={1.6}
                              />
                              <Text style={styles.metaText}>Any length</Text>
                            </View>
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
                            <Play
                              size={14}
                              color="#FFFFFF"
                              strokeWidth={2.5}
                              fill="#FFFFFF"
                            />
                            <Text style={styles.startBtnText}>
                              Start Workout
                            </Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                      <View
                        style={[
                          styles.bodyVisual,
                          { width: bodyVisualWidth, height: bodyVisualHeight },
                        ]}
                      >
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
          <View style={styles.screenSection}>
            <Text style={styles.sectionLabel}>TOOLS</Text>
            <View style={styles.toolsCardOuter}>
              <LinearGradient
                colors={[...TOOLS_CARD_GRADIENT]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={[styles.toolsCard, { height: toolsCardHeight }]}
              >
                <ToolRow
                  icon={
                    <LayoutTemplate
                      size={25}
                      color="#FFFFFF"
                      strokeWidth={1.8}
                    />
                  }
                  title="Choose Template"
                  subtitle="Start from a saved workout"
                  onPress={handleChooseTemplate}
                  divider
                />
                <ToolRow
                  icon={
                    <BookOpen
                      size={25}
                      color="#FFFFFF"
                      strokeWidth={1.8}
                    />
                  }
                  title="Exercise Guide"
                  subtitle="Learn form and technique"
                  onPress={() => rootNavigation.navigate('Tutorials')}
                  divider
                />
                <ToolRow
                  icon={
                    <Camera size={25} color="#FFFFFF" strokeWidth={1.8} />
                  }
                  title="Camera Setup"
                  subtitle="Check angles and positioning"
                  onPress={handleCameraSetup}
                />
              </LinearGradient>
            </View>
          </View>

          {/* ── RECENT / FAVOURITE TEMPLATES ───────── */}
          <View style={styles.screenSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, styles.sectionHeaderLabel]}>
                {templatesLabel}
              </Text>
              <TouchableOpacity
                onPress={handleChooseTemplate}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.viewAllLink}>View all</Text>
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.templatesRow,
                { height: templateCardHeight },
              ]}
            >
              {recentTemplates.slice(0, 3).map((tmpl) => (
                <TouchableOpacity
                  key={tmpl.id}
                  style={[
                    styles.templateCard,
                    { width: templateCardWidth },
                  ]}
                  activeOpacity={0.85}
                  onPress={() =>
                    navigation.navigate('TemplatePreview', {
                      templateName: tmpl.name,
                      description: tmpl.description,
                      exercises: tmpl.exercises.map((e) => ({
                        name: e.name,
                        category: e.category,
                        targetSets: e.targetSets,
                      })),
                    })
                  }
                >
                  <LinearGradient
                    colors={[...TOOLS_CARD_GRADIENT]}
                    start={CARD_GRADIENT_START}
                    end={CARD_GRADIENT_END}
                    style={styles.templateGradient}
                  >
                    <View
                      style={[
                        styles.templateThumb,
                        { height: templateThumbHeight },
                      ]}
                    >
                      <CaptureTemplateCollage template={tmpl} />
                      <View style={styles.templateThumbShade} />
                    </View>
                    <View style={styles.templateDivider} />
                    <View style={styles.templateInfo}>
                      <Text style={styles.templateName} numberOfLines={2}>
                        {tmpl.name}
                      </Text>
                      <Text style={styles.templateMeta}>
                        {tmpl.exercises.length} exercise
                        {tmpl.exercises.length === 1 ? '' : 's'}
                      </Text>
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
    <View style={styles.toolTextBlock}>
      <Text style={styles.toolTitle}>{title}</Text>
      <Text style={styles.toolSubtitle}>{subtitle}</Text>
    </View>
    <ChevronRight size={20} color="#FFFFFF" strokeWidth={1.8} />
  </TouchableOpacity>
);

const CaptureTemplateCollage: React.FC<{ template: CaptureTemplate }> = ({
  template,
}) => {
  const imageSources = getTemplateCollageSources(
    template.exercises.slice(0, 4),
  );

  return (
    <View style={styles.templateCollageGrid}>
      <View style={styles.templateCollageGridRow}>
        {imageSources.slice(0, 2).map((source, index) => (
          <Image
            key={`${template.id}-capture-collage-top-${index}`}
            source={source}
            style={styles.templateCollageGridImage}
            resizeMode="contain"
          />
        ))}
      </View>
      <View style={styles.templateCollageGridRow}>
        {imageSources.slice(2, 4).map((source, index) => (
          <Image
            key={`${template.id}-capture-collage-bottom-${index}`}
            source={source}
            style={styles.templateCollageGridImage}
            resizeMode="contain"
          />
        ))}
      </View>
    </View>
  );
};

// ── Styles ─────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerSide: { alignItems: 'flex-end' },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  captureScroll: {
    flex: 1,
  },
  captureContent: {
    flexGrow: 1,
    paddingHorizontal: CAPTURE_HORIZONTAL_PADDING,
    paddingTop: 2,
  },
  contentStack: {
    flexGrow: 1,
    paddingBottom: 7,
    justifyContent: 'flex-start',
  },
  screenSection: {
    justifyContent: 'flex-start',
  },

  dateLine: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  /* Card label */
  cardLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1,
  },

  /* Active / Idle workout card */
  activeOuter: {
    borderRadius: CAPTURE_CARD_RADIUS,
    ...CARD_SHADOW,
  },
  activeGradient: {
    borderRadius: CAPTURE_CARD_RADIUS,
    overflow: 'hidden',
  },
  activeEdge: {
    borderRadius: CAPTURE_CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    paddingHorizontal: CAPTURE_CARD_HORIZONTAL_PADDING,
    paddingVertical: CAPTURE_CARD_VERTICAL_PADDING,
  },
  activeWorkoutEdge: {
    justifyContent: 'space-between',
  },

  /* Idle body */
  idleEdge: {
    overflow: 'hidden',
  },
  idleCardContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 128,
  },
  idleTextWrap: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 12,
    paddingRight: 10,
  },
  idleCopyBlock: {
    gap: 9,
  },
  idleTitle: {
    fontFamily: FONTS.display.medium,
    fontSize: 19,
    color: COLORS.text,
    letterSpacing: -0.35,
    marginTop: 2,
  },
  idleMetaRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  bodyVisual: {
    marginRight: -1,
    overflow: 'hidden',
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
  activeDashboardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeTitleBlock: {
    gap: 4,
  },
  activeEyebrow: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1,
  },
  activeWorkoutTitle: {
    fontFamily: FONTS.display.medium,
    fontSize: 19,
    color: COLORS.text,
    letterSpacing: -0.35,
  },
  activeDashboardMiddle: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  activeTimerPanel: {
    flex: 1.35,
    minHeight: 52,
    paddingVertical: 4,
    justifyContent: 'center',
  },
  activeStatsPanel: {
    width: ACTIVE_SECONDARY_ACTIONS_WIDTH,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  activeStatItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  activeStatValue: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 19,
  },
  activeStatLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
  },
  activeStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* Timer (active) */
  timerDisplay: { flexDirection: 'row', alignItems: 'center' },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    fontSize: 23,
    color: COLORS.text,
    lineHeight: 26,
    letterSpacing: 1.1,
    fontVariant: ['tabular-nums'],
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    fontSize: 17,
    color: 'rgba(122, 85, 255, 0.62)',
    lineHeight: 26,
    marginHorizontal: 1,
    fontVariant: ['tabular-nums'],
  },
  activePauseControl: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePauseControlActive: {
    borderColor: 'rgba(122, 85, 255, 0.32)',
    backgroundColor: 'rgba(122, 85, 255, 0.14)',
  },

  /* Active actions */
  activeActionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  activePrimaryAction: {
    flex: 1,
    borderRadius: CARD_RADIUS_SM,
    overflow: 'hidden',
  },
  activePrimaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  activeSecondaryActions: {
    width: ACTIVE_SECONDARY_ACTIONS_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeSecondaryButton: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  activeSecondaryText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 10.5,
  },

  /* Start button */
  idleStartBtnOuter: {
    width: '100%',
    maxWidth: 218,
    borderRadius: CARD_RADIUS_SM,
    overflow: 'hidden',
    marginTop: 6,
  },
  idleStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  startBtnText: {
    fontFamily: FONTS.display.regular,
    fontSize: 13.5,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  /* Section labels */
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1,
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
  sectionHeaderLabel: {
    marginBottom: 0,
  },
  viewAllLink: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.accent,
  },

  /* Tools */
  toolsCardOuter: {
    borderRadius: CAPTURE_CARD_RADIUS,
    ...CARD_SHADOW,
  },
  toolsCard: {
    borderRadius: CAPTURE_CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    overflow: 'hidden',
  },
  toolRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  toolRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  toolIconWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTextBlock: {
    flex: 1,
    gap: 3,
  },
  toolTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
  },
  toolSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
  },

  /* Templates */
  templatesRow: {
    flexDirection: 'row',
    gap: TEMPLATE_CARD_GAP,
    alignItems: 'stretch',
    minHeight: 132,
  },
  templateCard: {
    borderRadius: CAPTURE_CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  templateGradient: {
    flex: 1,
    width: '100%',
    borderRadius: CAPTURE_CARD_RADIUS - 1,
    paddingHorizontal: 0,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 0,
    overflow: 'hidden',
  },
  templateThumb: {
    width: '100%',
    borderRadius: CAPTURE_CARD_RADIUS - 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingTop: 2,
    paddingBottom: 2,
    backgroundColor: 'transparent',
  },
  templateCollageGrid: {
    flex: 1,
    alignSelf: 'stretch',
    gap: 1,
  },
  templateCollageGridRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 1,
  },
  templateCollageGridImage: {
    flex: 1,
    height: '100%',
  },
  templateThumbShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  templateDivider: {
    height: 1,
    marginTop: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  templateInfo: {
    gap: 2,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  templateName: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: -0.1,
    lineHeight: 15,
  },
  templateMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textSecondary,
  },
});
