import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronDown, ChevronLeft, Trophy } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
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
import { RecordStackParamList } from '../app/RootNavigator';
import { useSaveWorkout } from '../../backend/hooks/useSaveWorkout';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useAlert } from '../contexts/AlertContext';
import { cleanupTempRecording } from '../../backend/services/screenRecording';

type SaveWorkoutRouteProp = RouteProp<RecordStackParamList, 'SaveWorkout'>;
type SaveWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'SaveWorkout'>;
type WorkoutPrivacy = 'private' | 'friends' | 'public';

const PRIVACY_OPTIONS: { value: WorkoutPrivacy; label: string; helper: string }[] = [
  { value: 'private', label: 'Only me', helper: 'Save privately without posting to the feed.' },
  { value: 'friends', label: 'Friends', helper: 'Share the workout with friends in your feed.' },
  { value: 'public', label: 'Everyone', helper: 'Use your public profile visibility for this workout.' },
];

const NOTES_MAX_LENGTH = 200;

const formatWorkoutName = (category?: string) => {
  const date = new Date();
  const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${category || 'Workout'} - ${formattedDate}`;
};

const formatWeight = (weight: number) => {
  if (Number.isInteger(weight)) return String(weight);
  return weight.toFixed(1);
};

export const SaveWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<SaveWorkoutNavigationProp>();
  const { showAlert } = useAlert();
  const route = useRoute<SaveWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const { workoutData } = route.params;
  const {
    clearSets,
    setWorkoutInProgress,
    exercises,
    workoutElapsedSeconds,
    sessionId,
    pendingRecording,
    recordingFinalizationCount,
  } = useCurrentWorkout();

  const [workoutName, setWorkoutName] = useState(() => formatWorkoutName(workoutData.category));
  const [workoutDescription, setWorkoutDescription] = useState('');
  const [privacy, setPrivacy] = useState<WorkoutPrivacy>('private');
  const [shareToFeed, setShareToFeed] = useState(true);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const { isSaving, error: saveError, saveWorkout } = useSaveWorkout();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 550, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const selectedPrivacy = PRIVACY_OPTIONS.find((option) => option.value === privacy) ?? PRIVACY_OPTIONS[0];

  const bestSet = useMemo(() => {
    let currentBest: {
      exerciseName: string;
      reps: number;
      weight: number;
      weightUnit: 'kg' | 'lbs';
      formScore: number;
    } | null = null;

    for (const exercise of exercises) {
      for (const set of exercise.sets) {
        const candidate = {
          exerciseName: exercise.name,
          reps: set.reps,
          weight: set.weight ?? 0,
          weightUnit: set.weightUnit ?? 'kg',
          formScore: set.formScore,
        };

        if (!currentBest) {
          currentBest = candidate;
          continue;
        }

        const candidateScore = candidate.weight * 1000 + candidate.reps * 10 + candidate.formScore;
        const bestScore = currentBest.weight * 1000 + currentBest.reps * 10 + currentBest.formScore;
        if (candidateScore > bestScore) currentBest = candidate;
      }
    }

    return currentBest;
  }, [exercises]);

  const bestSetMetric = bestSet
    ? bestSet.weight > 0
      ? `${formatWeight(bestSet.weight)} ${bestSet.weightUnit} x ${bestSet.reps}`
      : `${bestSet.reps} reps`
    : `${workoutData.totalReps} reps`;

  const bestSetLabel = bestSet?.exerciseName ?? workoutData.category ?? 'Workout';
  const highlightTitle = bestSet && bestSet.weight > 0 ? 'New Personal Best' : 'Session Highlight';
  const avgFormScoreLabel = workoutData.avgFormScore > 0 ? String(workoutData.avgFormScore) : '-';
  const shouldShareWorkout = shareToFeed && privacy !== 'private';
  const isFinalizingRecordings = recordingFinalizationCount > 0 || !!pendingRecording;
  const canSave = workoutData.totalSets > 0 && workoutName.trim().length > 0 && !isSaving && !isFinalizingRecordings;

  const handleSave = async () => {
    if (workoutData.totalSets === 0) {
      showAlert(
        'No sets recorded',
        'Add at least one set before ending the workout.'
      );
      return;
    }
    if (isSaving) return;

    const success = await saveWorkout({
      name: workoutName.trim(),
      durationSeconds: workoutElapsedSeconds,
      category: workoutData.category,
      notes: workoutDescription.trim() || undefined,
      exercises,
      shareToFeed: shouldShareWorkout,
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
                { name: 'Home' },
                { name: 'Logbook' },
                { name: 'Record' },
                { name: 'Analytics' },
                { name: 'Social' },
              ],
              index: 1,
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
            for (const ex of exercises) {
              for (const s of ex.sets) {
                if (s.tempRecordingUrl) {
                  cleanupTempRecording(s.tempRecordingUrl).catch(() => {});
                }
              }
            }
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

  const handleShareToggle = (value: boolean) => {
    setShareToFeed(value);
    if (value && privacy === 'private') {
      setPrivacy('friends');
    }
  };

  const handlePrivacySelect = (value: WorkoutPrivacy) => {
    setPrivacy(value);
    setPrivacyModalVisible(false);
  };

  return (
    <LinearGradient
      colors={SCREEN_GRADIENT_COLORS}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={styles.background}
    >
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={handleGoBack}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={23} color={COLORS.textSecondary} strokeWidth={1.7} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Save Workout</Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: Math.max(insets.bottom, SPACING.lg) + 24 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={styles.completeBlock}>
                <View style={styles.checkRing}>
                  <Check size={39} color="#54D878" strokeWidth={2.15} />
                </View>
                <Text style={styles.completeTitle}>Workout Complete!</Text>
                <Text style={styles.completeSubtitle}>Great work today.</Text>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>SUMMARY</Text>
              </View>

              <View style={styles.summaryGrid}>
                <SummaryTile label="Duration" value={workoutData.duration} />
                <SummaryTile label="Total Sets" value={String(workoutData.totalSets)} />
                <SummaryTile label="Total Reps" value={String(workoutData.totalReps)} />
                <SummaryTile label="Avg Form Score" value={avgFormScoreLabel} accent />
              </View>

              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.prCard}
              >
                <View style={styles.prContent}>
                  <View style={styles.prTextGroup}>
                    <Text style={styles.prTitle}>{highlightTitle}</Text>
                    <View style={styles.prBottomRow}>
                      <Text style={styles.prExercise} numberOfLines={1}>{bestSetLabel}</Text>
                      <Text style={styles.prMetric}>{bestSetMetric}</Text>
                    </View>
                  </View>
                  <Trophy size={24} color="#F2B340" fill="rgba(242, 179, 64, 0.28)" strokeWidth={1.8} />
                </View>
              </LinearGradient>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>WORKOUT NAME</Text>
              </View>

              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.nameCard}
              >
                <TextInput
                  style={styles.nameInput}
                  placeholder="Name your workout"
                  placeholderTextColor="rgba(173, 178, 182, 0.58)"
                  value={workoutName}
                  onChangeText={setWorkoutName}
                  maxLength={60}
                  returnKeyType="done"
                  selectTextOnFocus
                />
              </LinearGradient>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>NOTES (OPTIONAL)</Text>
              </View>

              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.notesCard}
              >
                <TextInput
                  style={styles.notesInput}
                  placeholder="Felt strong on squats. Keep improving depth on lunges."
                  placeholderTextColor="rgba(173, 178, 182, 0.58)"
                  value={workoutDescription}
                  onChangeText={setWorkoutDescription}
                  maxLength={NOTES_MAX_LENGTH}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={styles.charCount}>{workoutDescription.length}/{NOTES_MAX_LENGTH}</Text>
              </LinearGradient>

              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => setPrivacyModalVisible(true)}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Choose workout privacy"
              >
                <Text style={styles.settingTitle}>Privacy</Text>
                <View style={styles.settingValueRow}>
                  <Text style={styles.settingValue}>{selectedPrivacy.label}</Text>
                  <ChevronDown size={18} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
              </TouchableOpacity>

              <View style={styles.shareRow}>
                <View style={styles.shareTextGroup}>
                  <Text style={styles.settingTitle}>Share to Feed</Text>
                  <Text style={styles.settingDescription}>Share this workout</Text>
                </View>
                <Switch
                  value={shareToFeed}
                  onValueChange={handleShareToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.10)', true: 'rgba(122, 85, 255, 0.80)' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="rgba(255, 255, 255, 0.10)"
                />
              </View>

              <TouchableOpacity
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.86}
                accessibilityRole="button"
                accessibilityLabel="Save workout"
              >
                <LinearGradient
                  colors={canSave ? ['#7B58FF', '#5A31CF'] : ['rgba(122, 85, 255, 0.30)', 'rgba(90, 49, 207, 0.25)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.saveButton}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveButtonText}>
                      {isFinalizingRecordings ? 'Finalizing Recordings...' : 'Save Workout'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDiscardWorkout}
                style={styles.discardButton}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Discard workout"
              >
                <Text style={styles.discardText}>Discard</Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          visible={privacyModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPrivacyModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setPrivacyModalVisible(false)}
          >
            <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle}>Privacy</Text>
              {PRIVACY_OPTIONS.map((option) => {
                const isSelected = option.value === privacy;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.privacyOption, isSelected && styles.privacyOptionSelected]}
                    onPress={() => handlePrivacySelect(option.value)}
                    activeOpacity={0.82}
                  >
                    <View style={styles.privacyOptionText}>
                      <Text style={styles.privacyOptionLabel}>{option.label}</Text>
                      <Text style={styles.privacyOptionHelper}>{option.helper}</Text>
                    </View>
                    {isSelected && <Check size={18} color={COLORS.green} strokeWidth={2} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
};

const SummaryTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <LinearGradient
    colors={[...CARD_GRADIENT_COLORS]}
    start={CARD_GRADIENT_START}
    end={CARD_GRADIENT_END}
    style={styles.summaryTile}
  >
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={[styles.summaryValue, accent && styles.summaryValueAccent]}>{value}</Text>
  </LinearGradient>
);

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    height: 54,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  content: {
    gap: CARD_VERTICAL_GAP,
  },
  completeBlock: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 8,
  },
  checkRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: '#54D878',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
    backgroundColor: 'rgba(84, 216, 120, 0.045)',
  },
  completeTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 25,
    lineHeight: 30,
    color: COLORS.text,
  },
  completeSubtitle: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  sectionHeader: {
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryTile: {
    width: '48%',
    minHeight: 76,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'space-between',
    ...CARD_SHADOW,
  },
  summaryLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  summaryValue: {
    fontFamily: FONTS.display.medium,
    fontSize: 24,
    lineHeight: 28,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  summaryValueAccent: {
    color: '#43DA75',
  },
  prCard: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    overflow: 'hidden',
    marginTop: 1,
    ...CARD_SHADOW,
  },
  prContent: {
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  prTextGroup: {
    flex: 1,
    gap: 10,
  },
  prTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 15,
    color: '#F2B340',
  },
  prBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  prExercise: {
    flex: 1,
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  prMetric: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  nameCard: {
    minHeight: 58,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
  nameInput: {
    padding: 0,
    fontFamily: FONTS.display.semibold,
    fontSize: 17,
    color: COLORS.text,
  },
  notesCard: {
    minHeight: 101,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    ...CARD_SHADOW,
  },
  notesInput: {
    minHeight: 62,
    padding: 0,
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.text,
  },
  charCount: {
    alignSelf: 'flex-end',
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  settingRow: {
    minHeight: 54,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: COLORS.cardBackground,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...CARD_SHADOW,
  },
  settingTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  settingValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  shareRow: {
    minHeight: 66,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: COLORS.cardBackground,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    ...CARD_SHADOW,
  },
  shareTextGroup: {
    flex: 1,
    gap: 4,
  },
  settingDescription: {
    fontFamily: FONTS.ui.bold,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  saveButton: {
    height: 56,
    borderRadius: CARD_RADIUS_SM,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
  },
  discardButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.textTertiary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    backgroundColor: COLORS.cardBackground,
    padding: 14,
    gap: 8,
    ...CARD_SHADOW,
  },
  modalTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    marginBottom: 4,
  },
  privacyOption: {
    borderRadius: CARD_RADIUS_SM,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  privacyOptionSelected: {
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
  },
  privacyOptionText: {
    flex: 1,
    gap: 3,
  },
  privacyOptionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
  },
  privacyOptionHelper: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
  },
});
