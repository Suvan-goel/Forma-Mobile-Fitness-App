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
  const cardGap = 14;
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
      {/* ── HEADER ──────────────────────────────── */}
      <View style={[styles.headerSection, { paddingTop: insets.top + 6 }]}>
        <View style={styles.titleBlock}>
          <Text style={styles.headerTitle}>CAPTURE</Text>
          <Text style={styles.headerSubtitle}>TODAY'S SESSION</Text>
        </View>
        <TouchableOpacity
          onPress={() => rootNavigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.avatarButton}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarInitial}>
                {profileUser.displayName[0].toUpperCase()}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.avatarPlaceholder} />
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
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={[styles.cardGradient, { flex: undefined }]}
            >
              <View style={[styles.cardGlassEdge, { flex: undefined }]}>
                {/* ── Status pill ── */}
                <View style={styles.activeHeader}>
                  <View style={styles.statusPill}>
                    <View style={[styles.statusDot, workoutPaused && styles.statusDotPaused]} />
                    <Text style={styles.statusPillText}>
                      {workoutPaused ? 'PAUSED' : 'IN PROGRESS'}
                    </Text>
                  </View>
                </View>

                {/* ── Timer ── */}
                <TouchableOpacity
                  style={styles.activeCardContent}
                  onPress={handleResumeWorkout}
                  activeOpacity={0.7}
                >
                  <MonoText style={styles.timerText}>
                    {formatStopwatch(workoutElapsedSeconds)}
                  </MonoText>

                  {/* ── Stats row ── */}
                  {sets.length > 0 && (
                    <View style={styles.statsRow}>
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sets.length}</Text>
                        <Text style={styles.statLabel}>
                          {sets.length === 1 ? 'SET' : 'SETS'}
                        </Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statItem}>
                        <Text style={styles.statValue}>
                          {sets.reduce((sum, set) => sum + set.reps, 0)}
                        </Text>
                        <Text style={styles.statLabel}>REPS</Text>
                      </View>
                    </View>
                  )}

                  <Text style={styles.activeSubtext}>Tap to resume</Text>
                </TouchableOpacity>

                {/* ── Action buttons ── */}
                <View style={styles.workoutActions}>
                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handleDiscardWorkout}
                    activeOpacity={0.7}
                  >
                    <Trash2
                      size={18}
                      color={COLORS.textTertiary}
                      strokeWidth={1.5}
                    />
                    <Text style={[styles.workoutActionLabel, styles.discardLabel]}>Discard</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handlePauseWorkout}
                    activeOpacity={0.7}
                  >
                    {workoutPaused ? (
                      <Play size={18} color={COLORS.accent} strokeWidth={1.5} />
                    ) : (
                      <Pause size={18} color={COLORS.accent} strokeWidth={1.5} />
                    )}
                    <Text style={styles.workoutActionLabel}>
                      {workoutPaused ? 'Resume' : 'Pause'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handleFinishWorkout}
                    activeOpacity={0.7}
                  >
                    <Flag size={18} color={'#34D399'} strokeWidth={1.5} />
                    <Text style={[styles.workoutActionLabel, styles.finishLabel]}>Finish</Text>
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
                  <View style={styles.heroIconWrap}>
                    <Zap size={32} color="#FFFFFF" strokeWidth={2} />
                  </View>
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
                    <View style={styles.secondaryIconWrap}>
                      <LayoutTemplate size={24} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
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

  /* ── Header ──────────────────────────────── */
  headerSection: {
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleBlock: {
    paddingBottom: 16,
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 5,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000000',
  },
  avatarInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: COLORS.text,
    letterSpacing: 2,
    lineHeight: 46,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 3,
    marginTop: 6,
  },

  /* ── Content Area ──────────────────────────── */
  contentArea: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
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
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
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
    flex: 0.6,
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
  secondaryIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
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
    borderRadius: 19,
    overflow: 'hidden',
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
  activeHeader: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  statusDotPaused: {
    backgroundColor: COLORS.yellow,
  },
  statusPillText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 10,
    color: COLORS.accent,
    letterSpacing: 1.5,
  },
  activeCardContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 28,
  },
  timerText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 48,
    color: COLORS.text,
    lineHeight: 56,
    letterSpacing: 3,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  statItem: {
    alignItems: 'center',
    minWidth: 48,
  },
  statValue: {
    fontFamily: FONTS.mono.bold,
    fontSize: 20,
    color: COLORS.text,
    lineHeight: 24,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 1,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  activeSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginTop: 14,
  },

  /* ── Workout Actions ─────────────────────── */
  workoutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    alignSelf: 'stretch',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  workoutActionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  workoutActionLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  discardLabel: {
    color: COLORS.textTertiary,
  },
  finishLabel: {
    color: '#34D399',
  },
});
