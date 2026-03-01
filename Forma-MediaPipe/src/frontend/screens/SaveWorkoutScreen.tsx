import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  X,
  Target,
  Clock,
  Dumbbell,
  FileText,
  ChevronRight,
  Layers,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { RecordStackParamList } from '../app/RootNavigator';
import { useSaveWorkout } from '../../backend/hooks';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useAlert } from '../contexts/AlertContext';

type SaveWorkoutRouteProp = RouteProp<RecordStackParamList, 'SaveWorkout'>;
type SaveWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'SaveWorkout'>;

export const SaveWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<SaveWorkoutNavigationProp>();
  const { showAlert } = useAlert();
  const route = useRoute<SaveWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const { workoutData } = route.params;
  const { clearSets, setWorkoutInProgress, exercises, workoutElapsedSeconds, sessionId } = useCurrentWorkout();

  const [workoutName, setWorkoutName] = useState('');
  const [workoutDescription, setWorkoutDescription] = useState('');
  const { isSaving, error: saveError, saveWorkout } = useSaveWorkout();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const scoreColor = getScoreColor(workoutData.avgFormScore);

  const handleSave = async () => {
    if (workoutData.totalSets === 0) {
      showAlert(
        'No sets recorded',
        'Add at least one set before ending the workout.'
      );
      return;
    }
    if (!workoutName.trim() || isSaving) return;

    const success = await saveWorkout({
      name: workoutName,
      durationSeconds: workoutElapsedSeconds,
      category: workoutData.category,
      notes: workoutDescription.trim() || undefined,
      exercises,
      workoutSessionId: sessionId,
    });

    if (!success) {
      showAlert('Save Failed', saveError ?? 'Could not save workout. Please try again.', [
        { text: 'OK' },
      ]);
      return;
    }

    clearSets();
    setWorkoutInProgress(false);

    const rootNav = navigation.getParent()?.getParent();
    rootNav?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'MainTabs',
            state: {
              routes: [
                { name: 'Logbook' },
                { name: 'Analytics' },
                { name: 'Record' },
                { name: 'Trainer' },
                { name: 'Rewards' },
              ],
              index: 0,
            },
          },
        ],
      })
    );
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleDiscardWorkout = () => {
    showAlert(
      'Discard Workout?',
      'Are you sure you want to discard this workout? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: () => {
            clearSets();
            setWorkoutInProgress(false);
            navigation.reset({
              index: 0,
              routes: [{ name: 'RecordLanding' }],
            });
          },
        },
      ]
    );
  };

  const canSave = workoutName.trim().length > 0 && !isSaving;

  return (
    <SafeAreaView
      style={[styles.container, { marginBottom: -insets.bottom }]}
      edges={['top', 'left', 'right']}
    >
      {/* ── HEADER ──────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleGoBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Save Workout</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleDiscardWorkout}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 96 + Math.max(insets.bottom, SPACING.sm) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ═══════════════════════════════════════════
              HERO: WORKOUT SCORE CARD
              ═══════════════════════════════════════════ */}
          <LinearGradient
            colors={['#1E1A2E', '#151020', '#0C0A14']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroEdge}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroLabelRow}>
                  <Target size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.heroLabel}>WORKOUT COMPLETE</Text>
                </View>
                <View style={styles.durationChip}>
                  <Clock size={11} color={COLORS.textSecondary} strokeWidth={1.5} />
                  <Text style={styles.durationChipText}>{workoutData.duration}</Text>
                </View>
              </View>

              <View style={styles.heroScoreRow}>
                <Text style={[styles.heroScore, { color: scoreColor }]}>
                  {workoutData.avgFormScore}
                </Text>
                <Text style={styles.heroScoreUnit}>/100</Text>
              </View>

              <Text style={styles.heroSubtext}>Average form score</Text>
            </View>
          </LinearGradient>

          {/* ═══════════════════════════════════════════
              STATS ROW: REPS + SETS
              ═══════════════════════════════════════════ */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <View style={[styles.statIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.statValue}>{workoutData.totalReps}</Text>
                  <Text style={styles.statLabel}>total reps</Text>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.statCell}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.statGradient}
              >
                <View style={styles.statEdge}>
                  <View style={styles.statIconRow}>
                    <View style={[styles.statIconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                      <Layers size={14} color={COLORS.yellow} strokeWidth={1.5} />
                    </View>
                  </View>
                  <Text style={styles.statValue}>{workoutData.totalSets}</Text>
                  <Text style={styles.statLabel}>sets</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* ═══════════════════════════════════════════
              DETAILS — Name & Notes inputs
              ═══════════════════════════════════════════ */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <FileText size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DETAILS</Text>
            </View>
          </View>

          <View style={styles.inputCardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.inputCardGradient}
            >
              <View style={styles.inputCardEdge}>
                <Text style={styles.inputLabel}>WORKOUT NAME *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter workout name"
                  placeholderTextColor={COLORS.textTertiary}
                  value={workoutName}
                  onChangeText={setWorkoutName}
                  autoFocus
                />
              </View>
            </LinearGradient>
          </View>

          <View style={styles.inputCardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.inputCardGradient}
            >
              <View style={styles.inputCardEdge}>
                <Text style={styles.inputLabel}>NOTES</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Add notes about your workout..."
                  placeholderTextColor={COLORS.textTertiary}
                  value={workoutDescription}
                  onChangeText={setWorkoutDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </LinearGradient>
          </View>

        </Animated.View>
      </ScrollView>

      {/* ── SAVE CTA (Quick-Start style) ───────── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) + SPACING.md }]}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={canSave
              ? ['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']
              : ['rgba(139, 92, 246, 0.20)', 'rgba(124, 58, 237, 0.10)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            <View style={styles.ctaInner}>
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <View style={styles.ctaTextWrap}>
                    <Text style={[styles.ctaTitle, !canSave && styles.ctaTitleDisabled]}>
                      Save Workout
                    </Text>
                    <Text style={[styles.ctaSub, !canSave && styles.ctaSubDisabled]}>
                      {canSave ? 'Tap to save to your logbook' : 'Enter a name to continue'}
                    </Text>
                  </View>
                  <ChevronRight
                    size={18}
                    color={canSave ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)'}
                    strokeWidth={1.5}
                  />
                </>
              )}
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// ── Styles ─────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ──────────────────────────────────── */
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
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },

  /* ── Scroll ──────────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* ── Hero Form Score ─────────────────────────── */
  heroCard: {
    borderRadius: 22,
    marginTop: 18,
    marginBottom: 12,
  },
  heroEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  durationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  durationChipText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: -0.3,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  heroScore: {
    fontFamily: FONTS.display.bold,
    fontSize: 56,
    letterSpacing: -2,
    lineHeight: 60,
  },
  heroScoreUnit: {
    fontFamily: FONTS.mono.regular,
    fontSize: 16,
    color: COLORS.textTertiary,
  },
  heroSubtext: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 4,
  },

  /* ── Stats Row ───────────────────────────────── */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
  },
  statGradient: {
    borderRadius: 18,
  },
  statEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
  },
  statIconRow: {
    marginBottom: 12,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 34,
  },
  statLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  /* ── Section Headers ─────────────────────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
  },

  /* ── Input Cards ─────────────────────────────── */
  inputCardOuter: {
    marginBottom: 10,
  },
  inputCardGradient: {
    borderRadius: 18,
  },
  inputCardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
    gap: 8,
  },
  inputLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },
  input: {
    backgroundColor: 'transparent',
    padding: 0,
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  textArea: {
    minHeight: 80,
    paddingTop: SPACING.xs,
  },

  /* ── Save CTA (Quick-Start style) ──────────── */
  bottomBar: {
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  ctaGradient: {
    borderRadius: 16,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  ctaTextWrap: {
    flex: 1,
    gap: 2,
  },
  ctaTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  ctaTitleDisabled: {
    color: 'rgba(255, 255, 255, 0.35)',
  },
  ctaSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  ctaSubDisabled: {
    color: 'rgba(255, 255, 255, 0.2)',
  },
});
