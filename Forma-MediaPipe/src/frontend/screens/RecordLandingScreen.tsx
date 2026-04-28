import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Platform,
  Modal,
  Image,
  Animated,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
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
  Zap,
  ChevronRight,
  Dumbbell,
  ArrowRight,
  BookOpen,
  Bell,
  Camera as CameraIcon,
} from 'lucide-react-native';
import { COLORS, FONTS } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';
import { CameraSetupGuide } from './CameraSetupGuide';

import type { RecordStackParamList, RootStackParamList } from '../app/RootNavigator';
import { useAlert } from '../contexts/AlertContext';

const CAMERA_SETUP_SEEN_KEY = '@forma_camera_setup_seen';
const CAPTURE_BACKGROUND_GRADIENT: readonly [string, string, string] = ['#283036', '#182126', '#0E1519'];
const CAPTURE_CARD_GRADIENT: readonly [string, string, string] = ['#263037', '#1B242A', '#141B20'];
const CAPTURE_CARD_BORDER = 'rgba(255,255,255,0.08)';
const CAPTURE_VIOLET = '#7557F4';

const RECENT_TEMPLATES = [
  {
    name: 'Lower Body Strength',
    exercises: '5 exercises',
    image: require('../assets/weightlifting_bg.png'),
  },
  {
    name: 'Upper Body Push',
    exercises: '5 exercises',
    image: require('../assets/sports_bg.png'),
  },
  {
    name: 'Full Body Strength',
    exercises: '6 exercises',
    image: require('../assets/calisthenics_bg.png'),
  },
] as const;

type RecordLandingNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'RecordLanding'
>;

const formatStopwatch = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m
    .toString()
    .padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

const formatHeaderDate = (): string => {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Today, ${months[d.getMonth()]} ${d.getDate()}`;
};

const MuscleFigure = () => (
  <View style={styles.figureWrap}>
    <Svg width={92} height={142} viewBox="0 0 92 142">
      <Ellipse cx={46} cy={72} rx={27} ry={59} fill="rgba(255,255,255,0.035)" />
      <Circle cx={46} cy={16} r={8} fill="#8C9297" stroke="#CED4DA" strokeWidth={1} opacity={0.85} />
      <Path d="M37 27 L55 27 L61 63 L53 88 L39 88 L31 63 Z" fill="#6F747A" stroke="#C6CDD2" strokeWidth={1} opacity={0.82} />
      <Path d="M36 43 C27 52 25 68 26 86" stroke="#9EA6AC" strokeWidth={5} strokeLinecap="round" opacity={0.72} />
      <Path d="M56 43 C65 52 67 68 66 86" stroke="#9EA6AC" strokeWidth={5} strokeLinecap="round" opacity={0.72} />
      <Path d="M39 88 C36 103 34 117 33 134" stroke="#A9B0B6" strokeWidth={6} strokeLinecap="round" opacity={0.78} />
      <Path d="M53 88 C56 103 58 117 59 134" stroke="#A9B0B6" strokeWidth={6} strokeLinecap="round" opacity={0.78} />
      <Path d="M33 62 C39 65 53 65 59 62 L56 87 C51 91 41 91 36 87 Z" fill={CAPTURE_VIOLET} opacity={0.88} />
      <Path d="M36 62 C40 70 43 79 42 89" stroke="#9C82FF" strokeWidth={2} strokeLinecap="round" opacity={0.65} />
      <Path d="M56 62 C52 70 49 79 50 89" stroke="#9C82FF" strokeWidth={2} strokeLinecap="round" opacity={0.65} />
      <Line x1={46} y1={26} x2={46} y2={88} stroke="rgba(255,255,255,0.28)" strokeWidth={1} />
      <Line x1={36} y1={34} x2={56} y2={34} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
      <Rect x={28} y={133} width={13} height={4} rx={2} fill="#7C8389" opacity={0.8} />
      <Rect x={51} y={133} width={13} height={4} rx={2} fill="#7C8389" opacity={0.8} />
    </Svg>
  </View>
);

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
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
  const cardGap = 0;
  const bottomPadding = navigationBarHeight + cardGap;

  // ── Entrance animations ──
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // ── Camera Setup Guide (first-visit gate) ──
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

  const handleStartWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleResumeWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleChooseTemplate = () => {
    navigation.navigate('WorkoutTemplates');
  };

  const handleCameraSetup = () => {
    setShowSetupGuide(true);
  };

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

  const handlePauseWorkout = () => {
    setWorkoutPaused((p) => !p);
  };

  const handleFinishWorkout = () => {
    if (sets.length === 0) {
      showAlert(
        'No sets recorded',
        'Add at least one set before ending the workout.'
      );
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
      workoutData: {
        category,
        duration,
        totalSets,
        totalReps,
        avgFormScore,
      },
    });
  };

  // Show camera setup guide on first visit (Modal covers the tab bar)
  if (showSetupGuide === null) return <View style={styles.container} />;
  if (showSetupGuide) {
    return (
      <Modal visible animationType="none" statusBarTranslucent>
        <CameraSetupGuide onComplete={handleGuideComplete} />
      </Modal>
    );
  }

  return (
    <LinearGradient colors={[...CAPTURE_BACKGROUND_GRADIENT]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerSide} />
        <Text style={styles.headerName}>Capture</Text>
        <TouchableOpacity
          onPress={() => rootNavigation.navigate('NotificationSettings')}
          activeOpacity={0.7}
          style={styles.headerIconBtn}
        >
          <Bell size={19} color={COLORS.textSecondary} strokeWidth={1.7} />
        </TouchableOpacity>
      </View>

      {/* ── CONTENT ────────────────────────────── */}
      <Animated.ScrollView
        style={[
          styles.contentArea,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          workoutInProgress && styles.contentCentered,
        ]}
        contentContainerStyle={[
          styles.contentInner,
          { paddingBottom: bottomPadding },
          workoutInProgress && styles.contentInnerActive,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {workoutInProgress ? (
          /* ── Active Workout Card ── */
          <View style={styles.activeCardOuter}>
            <LinearGradient
              colors={['#1A1625', '#13101D', '#0D0B14']}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={[styles.cardGradient, { flex: undefined }]}
            >
              <View style={styles.activeGlassEdge}>
                {/* ── Top bar: status + pause ── */}
                <View style={styles.activeTopBar}>
                  <View style={[styles.statusPill, workoutPaused && styles.statusPillPaused]}>
                    <View style={[styles.statusDot, workoutPaused && styles.statusDotPaused]} />
                    <Text style={[styles.statusPillText, workoutPaused && styles.statusPillTextPaused]}>
                      {workoutPaused ? 'PAUSED' : 'ACTIVE'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.pauseBtn, workoutPaused && styles.pauseBtnActive]}
                    onPress={handlePauseWorkout}
                    activeOpacity={0.7}
                  >
                    {workoutPaused ? (
                      <Play size={14} color={COLORS.text} strokeWidth={2} />
                    ) : (
                      <Pause size={14} color={COLORS.textSecondary} strokeWidth={2} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* ── Timer + inline stats ── */}
                <TouchableOpacity
                  style={styles.activeCardContent}
                  onPress={handleResumeWorkout}
                  activeOpacity={0.7}
                >
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
                  <View style={styles.statsRow}>
                    <MonoText bold style={styles.statValue}>{sets.length}</MonoText>
                    <Text style={styles.statLabel}>{sets.length === 1 ? 'set' : 'sets'}</Text>
                    <View style={styles.statDot} />
                    <MonoText bold style={styles.statValue}>
                      {sets.reduce((sum, set) => sum + set.reps, 0)}
                    </MonoText>
                    <Text style={styles.statLabel}>reps</Text>
                  </View>
                </TouchableOpacity>

                {/* ── Bottom actions ── */}
                <View style={styles.workoutActions}>
                  <TouchableOpacity
                    style={styles.discardBtn}
                    onPress={handleDiscardWorkout}
                    activeOpacity={0.7}
                  >
                    <Trash2 size={15} color="#EF4444" strokeWidth={1.5} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleResumeWorkout}
                    activeOpacity={0.85}
                    style={styles.resumeBtnOuter}
                  >
                    <LinearGradient
                      colors={['rgba(139, 92, 246, 0.5)', 'rgba(124, 58, 237, 0.25)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.resumeGradient}
                    >
                      <Text style={styles.resumeBtnText}>Open workout</Text>
                      <ArrowRight size={14} color={COLORS.text} strokeWidth={2} />
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.finishBtn}
                    onPress={handleFinishWorkout}
                    activeOpacity={0.7}
                  >
                    <Flag size={15} color="#34D399" strokeWidth={1.5} />
                  </TouchableOpacity>
                </View>
              </View>
            </LinearGradient>
          </View>
        ) : (
          <>
            <Text style={styles.dateText}>{formatHeaderDate()}</Text>

            <View style={styles.currentCard}>
              <LinearGradient colors={[...CAPTURE_CARD_GRADIENT]} style={styles.currentGradient}>
                <View style={styles.currentCopy}>
                  <Text style={styles.kicker}>CURRENT WORKOUT</Text>
                  <Text style={styles.currentTitle}>Lower Body Strength</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Dumbbell size={10} color={COLORS.textTertiary} strokeWidth={1.6} />
                      <Text style={styles.metaText}>5 exercises</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaDot}>○</Text>
                      <Text style={styles.metaText}>45 min</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={handleStartWorkout}
                    activeOpacity={0.85}
                    style={styles.startButton}
                  >
                    <LinearGradient
                      colors={[CAPTURE_VIOLET, '#6042D8']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.startButtonGradient}
                    >
                      <Play size={12} color="#FFFFFF" fill="#FFFFFF" strokeWidth={1.5} />
                      <Text style={styles.startButtonText}>Start Workout</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
                <MuscleFigure />
              </LinearGradient>
            </View>

            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>TOOLS</Text>
              <View style={styles.toolPanel}>
                <TouchableOpacity
                  style={styles.toolRow}
                  onPress={handleChooseTemplate}
                  activeOpacity={0.72}
                >
                  <View style={styles.toolIconBox}>
                    <LayoutTemplate size={17} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </View>
                  <View style={styles.toolTextWrap}>
                    <Text style={styles.toolTitle}>Choose Template</Text>
                    <Text style={styles.toolSubtitle}>Browse saved workouts</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.6} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.toolRow}
                  onPress={() => rootNavigation.navigate('Tutorials')}
                  activeOpacity={0.72}
                >
                  <View style={styles.toolIconBox}>
                    <BookOpen size={17} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </View>
                  <View style={styles.toolTextWrap}>
                    <Text style={styles.toolTitle}>Exercise Guide</Text>
                    <Text style={styles.toolSubtitle}>Learn form and technique</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.6} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolRow, styles.toolRowLast]}
                  onPress={handleCameraSetup}
                  activeOpacity={0.72}
                >
                  <View style={styles.toolIconBox}>
                    <CameraIcon size={17} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </View>
                  <View style={styles.toolTextWrap}>
                    <Text style={styles.toolTitle}>Camera Setup</Text>
                    <Text style={styles.toolSubtitle}>Check angles and positioning</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.6} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.templateHeaderRow}>
              <Text style={styles.sectionLabel}>RECENT TEMPLATES</Text>
              <TouchableOpacity onPress={handleChooseTemplate} activeOpacity={0.7}>
                <Text style={styles.viewAllText}>View all</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.templateList}
            >
              {RECENT_TEMPLATES.map((template) => (
                <TouchableOpacity
                  key={template.name}
                  style={styles.templateCard}
                  activeOpacity={0.78}
                  onPress={handleChooseTemplate}
                >
                  <Image source={template.image} style={styles.templateImage} resizeMode="cover" />
                  <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(9,13,16,0.95)']}
                    style={styles.templateImageShade}
                  />
                  <View style={styles.templateCopy}>
                    <Text style={styles.templateName} numberOfLines={2}>{template.name}</Text>
                    <Text style={styles.templateExercises}>{template.exercises}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={handleStartWorkout}
              activeOpacity={0.8}
              style={styles.quickStartRow}
            >
              <LinearGradient
                colors={['rgba(117,87,244,0.18)', 'rgba(255,255,255,0.035)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.quickStartGradient}
              >
                <Zap size={14} color={CAPTURE_VIOLET} strokeWidth={1.8} />
                <Text style={styles.quickStartText}>Start a free-form session</Text>
                <ChevronRight size={14} color={COLORS.textTertiary} strokeWidth={1.6} />
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}
      </Animated.ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Reference-style Header ────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerSide: {
    width: 36,
    height: 36,
  },
  headerName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },

  /* ── Content Area ──────────────────────────── */
  contentArea: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  contentCentered: {
  },
  contentInnerActive: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  dateText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#B1B7BC',
    marginBottom: 10,
  },

  /* ── Current Workout ─────────────────────── */
  currentCard: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
      },
      android: { elevation: 4 },
    }),
  },
  currentGradient: {
    minHeight: 158,
    borderWidth: 1,
    borderColor: CAPTURE_CARD_BORDER,
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  currentCopy: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 14,
    justifyContent: 'space-between',
  },
  kicker: {
    fontFamily: FONTS.mono.bold,
    fontSize: 9,
    color: '#899199',
    letterSpacing: 0.8,
    marginBottom: 7,
  },
  currentTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 16,
    lineHeight: 20,
    color: COLORS.text,
    letterSpacing: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginTop: 9,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  metaDot: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    lineHeight: 10,
  },
  startButton: {
    width: 154,
    height: 43,
    borderRadius: 7,
    overflow: 'hidden',
  },
  startButtonGradient: {
    flex: 1,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  startButtonText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.text,
  },
  figureWrap: {
    width: 106,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 5,
  },

  /* ── Tools ──────────────────────────────── */
  sectionBlock: {
    marginBottom: 14,
  },
  sectionLabel: {
    fontFamily: FONTS.mono.bold,
    fontSize: 10,
    color: '#7D858C',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  toolPanel: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CAPTURE_CARD_BORDER,
    backgroundColor: 'rgba(20,28,33,0.72)',
  },
  toolRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.055)',
  },
  toolRowLast: {
    borderBottomWidth: 0,
  },
  toolIconBox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toolTextWrap: {
    flex: 1,
    gap: 3,
  },
  toolTitle: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: '#DDE3E8',
  },
  toolSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },

  /* ── Recent Templates ───────────────────── */
  templateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  viewAllText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 10,
    color: CAPTURE_VIOLET,
  },
  templateList: {
    gap: 10,
    paddingRight: 20,
    paddingBottom: 14,
  },
  templateCard: {
    width: 100,
    height: 132,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CAPTURE_CARD_BORDER,
    backgroundColor: '#111A20',
  },
  templateImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    opacity: 0.82,
  },
  templateImageShade: {
    ...StyleSheet.absoluteFillObject,
  },
  templateCopy: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 9,
  },
  templateName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    lineHeight: 14,
    color: COLORS.text,
    letterSpacing: 0,
    marginBottom: 4,
  },
  templateExercises: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  quickStartRow: {
    height: 46,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(117,87,244,0.18)',
  },
  quickStartGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  quickStartText: {
    flex: 1,
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  /* ── Hero CTA (New Session) ────────────────── */
  heroCta: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },
  heroGradient: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    justifyContent: 'space-between',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    gap: 12,
  },
  heroTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  heroDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.15)',
  },
  heroAction: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: 0.3,
  },

  /* ── Secondary Card (Templates) ────────────── */
  secondaryCard: {
    minHeight: 180,
    borderRadius: 18,
    overflow: 'hidden',
  },
  secondaryGradient: {
    flex: 1,
    borderRadius: 18,
  },
  secondaryGlass: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'space-between',
  },
  secondaryContent: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 10,
  },
  secondaryTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  secondaryDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.1,
  },
  secondaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryAction: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    letterSpacing: 0.3,
  },

  /* ── Exercise Tutorials ─────────────────── */
  tutorialsCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  tutorialsGradient: {
    borderRadius: 16,
  },
  tutorialsEdge: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  tutorialsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tutorialsTextWrap: {
    flex: 1,
    gap: 2,
  },
  tutorialsTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  tutorialsSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },

  /* ── Hint row ─────────────────────────────── */
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  hintText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
  },

  /* ── Shared Card Primitives ────────────────── */
  cardGradient: {
    flex: 1,
    borderRadius: 19,
  },
  cardGlassEdge: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },

  /* ── Active Workout Card ─────────────────── */
  activeCardOuter: {
    borderRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  activeGlassEdge: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.12)',
  },
  activeTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPillPaused: {
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#34D399',
  },
  statusDotPaused: {
    backgroundColor: COLORS.yellow,
  },
  statusPillText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 10,
    color: '#34D399',
    letterSpacing: 1.5,
  },
  statusPillTextPaused: {
    color: COLORS.yellow,
  },
  pauseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBtnActive: {
    borderColor: 'rgba(139, 92, 246, 0.25)',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  activeCardContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  timerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    fontSize: 40,
    color: '#FFFFFF',
    lineHeight: 48,
    letterSpacing: 2,
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    fontSize: 30,
    color: 'rgba(139, 92, 246, 0.45)',
    lineHeight: 48,
    marginHorizontal: 2,
  },

  /* ── Inline Stats ── */
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  statValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 18,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
  },
  statDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(139, 92, 246, 0.4)',
    marginHorizontal: 4,
  },

  /* ── Workout Actions ─────────────────────── */
  workoutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  discardBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeBtnOuter: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
  },
  resumeGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  resumeBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.3,
  },
  finishBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.15)',
    backgroundColor: 'rgba(52, 211, 153, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
