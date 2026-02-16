import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LayoutTemplate,
  Plus,
  Timer,
  Trash2,
  Pause,
  Play,
  Flag,
} from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { MonoText } from '../components/typography/MonoText';

import type { RecordStackParamList } from '../app/RootNavigator';

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
  const insets = useSafeAreaInsets();
  const {
    workoutInProgress,
    sets,
    workoutElapsedSeconds,
    setWorkoutElapsedSeconds,
    clearSets,
  } = useCurrentWorkout();
  const navigationBarHeight = 90 + Math.max(insets.bottom, 8);
  const cardGap = 14;
  const bottomPadding = navigationBarHeight + cardGap;
  const [timerPaused, setTimerPaused] = useState(false);

  useEffect(() => {
    if (!workoutInProgress || timerPaused) return;
    const interval = setInterval(() => {
      setWorkoutElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [workoutInProgress, timerPaused, setWorkoutElapsedSeconds]);

  const handleStartWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleResumeWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleChooseTemplate = () => {
    navigation.navigate('ChooseExercise');
  };

  const handleDiscardWorkout = () => {
    Alert.alert(
      'Discard workout',
      'Are you sure? This will clear all sets and time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: clearSets },
      ]
    );
  };

  const handlePauseWorkout = () => {
    setTimerPaused((p) => !p);
  };

  const handleFinishWorkout = () => {
    if (sets.length === 0) {
      clearSets();
      return;
    }
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, set) => sum + set.reps, 0);
    const avgFormScore = Math.round(
      sets.reduce((sum, set) => sum + set.formScore, 0) / sets.length
    );
    const category = sets[0]?.exerciseName || 'General';
    const duration = formatStopwatch(workoutElapsedSeconds);

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

  return (
    <View style={styles.container}>
      {/* ── HEADER ──────────────────────────────── */}
      <View style={[styles.headerSection, { paddingTop: insets.top + 16 }]}>
        <View style={styles.titleBlock}>
          <Text style={styles.headerTitle}>CAPTURE</Text>
          <Text style={styles.headerSubtitle}>TODAY'S SESSION</Text>
        </View>
      </View>

      {/* ── ACTION CARDS ───────────────────────── */}
      <View style={[styles.cardsContainer, { paddingBottom: bottomPadding }]}>
        {workoutInProgress ? (
          /* ── Active Workout Card ── */
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={['#27272A', '#111111', '#000000']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <TouchableOpacity
                  style={styles.activeCardContent}
                  onPress={handleResumeWorkout}
                  activeOpacity={0.7}
                >
                  <View style={styles.activeTimerSection}>
                    <Timer size={36} color="#8B5CF6" strokeWidth={1} />
                    <MonoText style={styles.timerText}>
                      {formatStopwatch(workoutElapsedSeconds)}
                    </MonoText>
                  </View>
                  <Text style={styles.activeLabel}>Workout in progress</Text>
                  <Text style={styles.activeSubtext}>
                    {sets.length > 0
                      ? `${sets.length} set${sets.length === 1 ? '' : 's'} \u2022 Tap to resume`
                      : 'Tap to resume'}
                  </Text>
                </TouchableOpacity>
                <View style={styles.workoutActions}>
                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handleDiscardWorkout}
                    activeOpacity={0.7}
                  >
                    <View style={styles.workoutActionIconWrap}>
                      <Trash2
                        size={22}
                        color={COLORS.textTertiary}
                        strokeWidth={1.5}
                      />
                    </View>
                    <Text style={styles.workoutActionLabel}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handlePauseWorkout}
                    activeOpacity={0.7}
                  >
                    <View style={styles.workoutActionIconWrap}>
                      {timerPaused ? (
                        <Play size={22} color="#8B5CF6" strokeWidth={1.5} />
                      ) : (
                        <Pause size={22} color="#8B5CF6" strokeWidth={1.5} />
                      )}
                    </View>
                    <Text style={styles.workoutActionLabel}>
                      {timerPaused ? 'Resume' : 'Pause'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.workoutActionButton}
                    onPress={handleFinishWorkout}
                    activeOpacity={0.7}
                  >
                    <View style={styles.workoutActionIconWrap}>
                      <Flag size={22} color="#8B5CF6" strokeWidth={1.5} />
                    </View>
                    <Text style={styles.workoutActionLabel}>Finish</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </LinearGradient>
          </View>
        ) : (
          <>
            {/* ── Card 1: New Session ── */}
            <TouchableOpacity
              style={styles.cardOuter}
              onPress={handleStartWorkout}
              activeOpacity={0.82}
            >
              <LinearGradient
                colors={['#27272A', '#111111', '#000000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardGradient}
              >
                <View style={styles.cardGlassEdge}>
                  <View style={styles.cardInner}>
                    <Plus size={32} color="#8B5CF6" strokeWidth={1.5} />
                    <Text style={styles.cardTitle}>New Session</Text>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Card 2: Templates ── */}
            <TouchableOpacity
              style={styles.cardOuter}
              onPress={handleChooseTemplate}
              activeOpacity={0.82}
            >
              <LinearGradient
                colors={['#27272A', '#111111', '#000000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardGradient}
              >
                <View style={styles.cardGlassEdge}>
                  <View style={styles.cardInner}>
                    <LayoutTemplate
                      size={32}
                      color="#8B5CF6"
                      strokeWidth={1.5}
                    />
                    <Text style={styles.cardTitle}>Templates</Text>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}
      </View>
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
  },
  titleBlock: {
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 40,
    color: '#FFFFFF',
    letterSpacing: 2,
    lineHeight: 46,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 3,
    marginTop: 6,
  },

  /* ── Cards Container ─────────────────────── */
  cardsContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    gap: 14,
  },

  /* ── Card ─────────────────────────────────── */
  cardOuter: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    flex: 1,
    borderRadius: 22,
  },
  cardGlassEdge: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardInner: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 24,
    gap: 14,
  },
  cardTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },

  /* ── Active Workout Card ─────────────────── */
  activeCardContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: SPACING.lg,
  },
  activeTimerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  timerText: {
    fontFamily: FONTS.mono.bold,
    fontSize: 32,
    color: '#8B5CF6',
    lineHeight: 38,
  },
  activeLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: '#A1A1AA',
    marginBottom: 4,
  },
  activeSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: '#52525B',
    letterSpacing: 0.5,
  },

  /* ── Workout Actions ─────────────────────── */
  workoutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    alignSelf: 'stretch',
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  workoutActionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutActionIconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutActionLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: '#71717A',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
