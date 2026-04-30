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
  Animated,
  ScrollView,
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
  Bell,
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

const estimateTemplateDuration = (exercises: number): number => Math.max(20, exercises * 8);
const TEMPLATE_IMAGES = [
  require('../assets/exercises/barbell_squat.png'),
  require('../assets/exercises/barbell_curl.png'),
  require('../assets/exercises/cable_row.png'),
  require('../assets/exercises/push_up.png'),
  require('../assets/exercises/cable_lat_pulldowns.png'),
  require('../assets/exercises/leg_extensions.png'),
];

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
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

  const recentTemplates = templates.slice(0, 6);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.container}
    >
      {/* ── HEADER ──────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={{ flex: 1 }} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Capture</Text>
        </View>
        <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
          <TouchableOpacity
            onPress={() => rootNavigation.navigate('Settings')}
            style={styles.iconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Bell size={18} color={COLORS.textSecondary} strokeWidth={1.6} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: navigationBarHeight }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
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
                  <View style={styles.cardLabelRow}>
                    <Text style={styles.cardLabel}>CURRENT WORKOUT</Text>
                    <View style={[styles.statusPill, workoutPaused && styles.statusPillPaused]}>
                      <View style={[styles.statusDot, workoutPaused && styles.statusDotPaused]} />
                      <Text style={[styles.statusPillText, workoutPaused && styles.statusPillTextPaused]}>
                        {workoutPaused ? 'PAUSED' : 'ACTIVE'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.activeBody}>
                    <View style={styles.activeBodyText}>
                      <Text style={styles.activeWorkoutName}>In Progress</Text>
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
                      colors={['#7C5CFF', '#6746E8']}
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
                      <Trash2 size={13} color="#EF4444" strokeWidth={1.6} />
                      <Text style={[styles.footerBtnText, { color: '#EF4444' }]}>Discard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.footerBtn}
                      onPress={handleFinishWorkout}
                      activeOpacity={0.7}
                    >
                      <Flag size={13} color={COLORS.green} strokeWidth={1.6} />
                      <Text style={[styles.footerBtnText, { color: COLORS.green }]}>Finish</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </LinearGradient>
            </View>
          ) : (
            /* ── CURRENT WORKOUT (idle) CARD ── */
            <View style={styles.activeOuter}>
              <LinearGradient
                colors={[...CARD_GRADIENT_ELEVATED]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.activeGradient}
              >
                <View style={styles.activeEdge}>
                  <Text style={styles.cardLabel}>CURRENT WORKOUT</Text>
                  <View style={styles.idleBody}>
                    <View style={styles.idleTextWrap}>
                      <Text style={styles.idleTitle}>Free Session</Text>
                      <View style={styles.idleMetaRow}>
                        <View style={styles.metaIconRow}>
                          <Dumbbell size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>Free-form</Text>
                        </View>
                        <View style={styles.metaIconRow}>
                          <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.6} />
                          <Text style={styles.metaText}>~30 min</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.bodyVisual}>
                      <LinearGradient
                        colors={['rgba(124,92,255,0.18)', 'rgba(124,92,255,0.04)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Image
                        source={require('../assets/exercises/barbell_squat.png')}
                        style={styles.bodyVisualImage}
                        resizeMode="cover"
                      />
                      <View style={styles.bodyVisualShade} />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleStartWorkout}
                    activeOpacity={0.85}
                    style={styles.startBtnOuter}
                  >
                    <LinearGradient
                      colors={['#7C5CFF', '#6746E8']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.startBtn}
                    >
                      <Play size={14} color="#FFFFFF" strokeWidth={2.5} fill="#FFFFFF" />
                      <Text style={styles.startBtnText}>Start Workout</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          )}

          {/* ── TOOLS ───────────────────────────────── */}
          <Text style={styles.sectionLabel}>TOOLS</Text>
          <View style={styles.toolsCard}>
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
          </View>

          {/* ── RECENT TEMPLATES ────────────────────── */}
          {recentTemplates.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>RECENT TEMPLATES</Text>
                <TouchableOpacity
                  onPress={handleChooseTemplate}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.viewAllLink}>View all</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.templatesRow}
              >
                {recentTemplates.map((tmpl, index) => (
                  <TouchableOpacity
                    key={tmpl.id}
                    style={styles.templateCard}
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
                      <View style={styles.templateThumb}>
                        <Image
                          source={TEMPLATE_IMAGES[index % TEMPLATE_IMAGES.length]}
                          style={styles.templateThumbImage}
                          resizeMode="cover"
                        />
                        <View style={styles.templateThumbShade} />
                      </View>
                      <View style={styles.templateInfo}>
                        <Text style={styles.templateName} numberOfLines={1}>{tmpl.name}</Text>
                        <Text style={styles.templateMeta}>
                          {tmpl.exercises.length} exercise{tmpl.exercises.length === 1 ? '' : 's'}
                        </Text>
                        <Text style={styles.templateMeta}>
                          ~{estimateTemplateDuration(tmpl.exercises.length)} min
                        </Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
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
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 8,
  },
  headerSide: { flex: 1 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 3,
  },

  dateLine: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },

  /* Card label */
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
  },

  /* Active / Idle workout card */
  activeOuter: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    marginBottom: 12,
  },
  activeGradient: { borderRadius: CARD_RADIUS },
  activeEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
  },

  /* Idle body */
  idleBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 10,
  },
  idleTextWrap: { flex: 1, gap: 6 },
  idleTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 15.5,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  idleMetaRow: { flexDirection: 'row', gap: 10 },
  bodyVisual: {
    width: 70,
    height: 86,
    borderRadius: 9,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bodyVisualImage: {
    width: '100%',
    height: '100%',
  },
  bodyVisualShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  metaIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10.5,
    color: COLORS.textSecondary,
  },

  /* Active body */
  activeBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 14,
    gap: 12,
  },
  activeBodyText: { flex: 1, gap: 6 },
  activeWorkoutName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  activeMetaRow: { flexDirection: 'row', gap: 14, marginTop: 2 },

  /* Status pill */
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
  },
  statusPillPaused: { backgroundColor: 'rgba(245, 166, 35, 0.12)' },
  statusDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green,
  },
  statusDotPaused: { backgroundColor: COLORS.yellow },
  statusPillText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 9,
    color: COLORS.green,
    letterSpacing: 1.2,
  },
  statusPillTextPaused: { color: COLORS.yellow },

  /* Timer (active) */
  timerDisplay: { flexDirection: 'row', alignItems: 'center' },
  timerDigit: {
    fontFamily: FONTS.mono.bold,
    fontSize: 28,
    color: COLORS.text,
    lineHeight: 32,
    letterSpacing: 1.5,
  },
  timerColon: {
    fontFamily: FONTS.mono.regular,
    fontSize: 22,
    color: 'rgba(124,92,255,0.5)',
    lineHeight: 32,
    marginHorizontal: 1,
  },
  pauseBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  pauseBtnActive: {
    borderColor: 'rgba(124,92,255,0.25)',
    backgroundColor: 'rgba(124,92,255,0.1)',
  },

  /* Active footer */
  activeFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  footerBtnText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 12,
  },

  /* Start button */
  startBtnOuter: { borderRadius: CARD_RADIUS_SM, overflow: 'hidden' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
  },
  startBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  /* Section labels */
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 8.5,
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
    marginTop: 5,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 8,
  },
  viewAllLink: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.accent,
  },

  /* Tools */
  toolsCard: {
    borderRadius: CARD_RADIUS,
    backgroundColor: 'rgba(255,255,255,0.028)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toolRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
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
    gap: 8,
    paddingRight: 4,
  },
  templateCard: {
    width: 93,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  templateGradient: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 6,
    gap: 6,
  },
  templateThumb: {
    height: 58,
    borderRadius: 7,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  templateThumbImage: {
    width: '100%',
    height: '100%',
  },
  templateThumbShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  templateInfo: { gap: 2 },
  templateName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10.5,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  templateMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.25,
    color: COLORS.textSecondary,
  },
});
