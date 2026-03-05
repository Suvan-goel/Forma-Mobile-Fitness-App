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
  Zap,
  ChevronRight,
  Dumbbell,
  ArrowRight,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';
import { CameraSetupGuide } from './CameraSetupGuide';

import type { RecordStackParamList, RootStackParamList } from '../app/RootNavigator';
import { useUser } from '../../backend/hooks';
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
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()} \u2022 TODAY`;
};

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const { user: profileUser } = useUser();
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
    <View style={styles.container}>
      {/* ── HEADER (HomeScreen style) ────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>CAPTURE</Text>
            <Text style={styles.headerSubtitle}>{formatHeaderDate()}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => rootNavigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.profileBtn}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.profileImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <Text style={styles.profileInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.profilePlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── CONTENT ────────────────────────────── */}
      <Animated.View
        style={[
          styles.contentArea,
          { paddingBottom: bottomPadding },
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          workoutInProgress && styles.contentCentered,
        ]}
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
            {/* ── Primary CTA: New Session ── */}
            <TouchableOpacity
              onPress={handleStartWorkout}
              activeOpacity={0.85}
              style={styles.heroCta}
            >
              <LinearGradient
                colors={['rgba(139, 92, 246, 0.55)', 'rgba(124, 58, 237, 0.25)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGradient}
              >
                <View style={styles.heroContent}>
                  <Zap size={32} color="#FFFFFF" strokeWidth={2} />
                  <Text style={styles.heroTitle}>New Session</Text>
                  <Text style={styles.heroDesc}>
                    Start a free-form workout with{'\n'}real-time AI form analysis
                  </Text>
                </View>
                <View style={styles.heroFooter}>
                  <Text style={styles.heroAction}>Start workout</Text>
                  <ChevronRight size={16} color={COLORS.accent} strokeWidth={2} />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Secondary: Templates ── */}
            <TouchableOpacity
              onPress={handleChooseTemplate}
              activeOpacity={0.85}
              style={styles.secondaryCard}
            >
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.secondaryGradient}
              >
                <View style={styles.secondaryGlass}>
                  <View style={styles.secondaryContent}>
                    <LayoutTemplate size={24} color={COLORS.accent} strokeWidth={1.5} />
                    <Text style={styles.secondaryTitle}>Templates</Text>
                    <Text style={styles.secondaryDesc}>
                      Pick from your saved routines
                    </Text>
                  </View>
                  <View style={styles.secondaryFooter}>
                    <Text style={styles.secondaryAction}>Browse templates</Text>
                    <ChevronRight size={14} color={COLORS.textSecondary} strokeWidth={1.5} />
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Bottom hint ── */}
            <View style={styles.hintRow}>
              <Dumbbell size={14} color={COLORS.textTertiary} strokeWidth={1.5} />
              <Text style={styles.hintText}>
                AI form analysis activates during exercises
              </Text>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Header (HomeScreen style) ────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 50,
    height: 50,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
  },
  profileInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },

  /* ── Content Area ──────────────────────────── */
  contentArea: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 16,
    gap: 14,
  },
  contentCentered: {
    justifyContent: 'center',
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
