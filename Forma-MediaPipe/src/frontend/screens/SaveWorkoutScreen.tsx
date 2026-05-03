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
import {
  Check,
  ChevronDown,
  Globe2,
  Shield,
  Trophy,
  Users,
  X,
} from 'lucide-react-native';
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
  CARD_RADIUS_LG,
  CARD_RADIUS_SM,
} from '../constants/theme';
import { RecordStackParamList } from '../app/RootNavigator';
import { useSaveWorkout } from '../../backend/hooks/useSaveWorkout';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';
import { useAlert } from '../contexts/AlertContext';
import { cleanupTempRecording } from '../../backend/services/screenRecording';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

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
              accessibilityLabel="Close save workout"
            >
              <X size={22} color={COLORS.textSecondary} strokeWidth={1.8} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Save Workout</Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: getBottomOverlayPadding(insets.bottom, SPACING.xl) },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
          >
            <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={styles.completionBlock}>
                <View style={styles.checkRing}>
                  <Check size={34} color={COLORS.green} strokeWidth={2.25} />
                </View>
                <Text style={styles.completeTitle}>Workout Complete!</Text>
                <Text style={styles.completeSubtitle}>Great work today.</Text>
              </View>

              <Text style={styles.sectionLabel}>SUMMARY</Text>

              <View style={styles.summaryGrid}>
                <SummaryTile label="Duration" value={workoutData.duration} />
                <SummaryTile label="Total Sets" value={String(workoutData.totalSets)} />
                <SummaryTile label="Total Reps" value={String(workoutData.totalReps)} />
                <SummaryTile label="Avg Form Score" value={avgFormScoreLabel} accent />
              </View>

              <LinearGradient
                colors={['rgba(232, 178, 70, 0.16)', 'rgba(232, 178, 70, 0.045)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.bestSetCard}
              >
                <View style={styles.bestSetCopy}>
                  <Text style={styles.bestSetTitle}>New Personal Best</Text>
                  <Text style={styles.bestSetExercise} numberOfLines={1}>{bestSetLabel}</Text>
                </View>
                <View style={styles.bestSetMetricBlock}>
                  <Text style={styles.bestSetMetric}>{bestSetMetric}</Text>
                  <Trophy size={24} color="#E8B246" strokeWidth={2.1} />
                </View>
              </LinearGradient>

              <Text style={styles.sectionLabel}>WORKOUT TITLE</Text>

              <View style={styles.titleCard}>
                <TextInput
                  style={styles.titleInput}
                  placeholder="Workout title"
                  placeholderTextColor="rgba(177, 183, 189, 0.62)"
                  value={workoutName}
                  onChangeText={setWorkoutName}
                  maxLength={60}
                  returnKeyType="done"
                  selectTextOnFocus
                />
              </View>

              <Text style={styles.sectionLabel}>NOTES (OPTIONAL)</Text>

              <View style={styles.notesCard}>
                <TextInput
                  style={styles.notesInput}
                  placeholder="Felt strong on squats. Keep improving depth on lunges."
                  placeholderTextColor="rgba(177, 183, 189, 0.62)"
                  value={workoutDescription}
                  onChangeText={setWorkoutDescription}
                  maxLength={NOTES_MAX_LENGTH}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={styles.charCount}>{workoutDescription.length}/{NOTES_MAX_LENGTH}</Text>
              </View>

              <TouchableOpacity
                style={styles.privacyRow}
                onPress={() => setPrivacyModalVisible(true)}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Choose workout privacy"
              >
                <Text style={styles.settingTitle}>Privacy</Text>
                <View style={styles.privacyValue}>
                  <Text style={styles.settingValue}>{selectedPrivacy.label}</Text>
                  <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={2} />
                </View>
              </TouchableOpacity>

              <View style={styles.shareRow}>
                <View style={styles.shareCopy}>
                  <Text style={styles.settingTitle}>Share to Feed</Text>
                  <Text style={styles.settingDescription}>Share this workout</Text>
                </View>
                <Switch
                  value={shareToFeed}
                  onValueChange={handleShareToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.10)', true: 'rgba(122, 85, 255, 0.88)' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="rgba(255, 255, 255, 0.10)"
                />
              </View>

              {isFinalizingRecordings && (
                <View style={styles.statusNotice}>
                  <ActivityIndicator size="small" color={COLORS.accent} />
                  <Text style={styles.statusNoticeText}>Finalizing recordings before saving.</Text>
                </View>
              )}

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
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.modalCard}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Privacy</Text>
                <Text style={styles.modalSubtitle}>Choose who can see this workout.</Text>
              </View>
              {PRIVACY_OPTIONS.map((option) => {
                const isSelected = option.value === privacy;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.privacyOption, isSelected && styles.privacyOptionSelected]}
                    onPress={() => handlePrivacySelect(option.value)}
                    activeOpacity={0.82}
                  >
                    <View style={[styles.privacyOptionIcon, isSelected && styles.privacyOptionIconSelected]}>
                      <PrivacyIcon value={option.value} color={isSelected ? COLORS.accent : COLORS.textTertiary} />
                    </View>
                    <View style={styles.privacyOptionText}>
                      <Text style={styles.privacyOptionLabel}>{option.label}</Text>
                      <Text style={styles.privacyOptionHelper}>{option.helper}</Text>
                    </View>
                    <View style={[styles.privacyCheck, isSelected && styles.privacyCheckSelected]}>
                      {isSelected && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </LinearGradient>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
};

const SummaryTile: React.FC<{
  label: string;
  value: string;
  accent?: boolean;
}> = ({ label, value, accent }) => (
  <View style={styles.summaryTile}>
    <Text style={styles.summaryTileLabel}>{label}</Text>
    <Text style={[styles.summaryTileValue, accent && styles.summaryTileValueAccent]} numberOfLines={1}>{value}</Text>
  </View>
);

const PrivacyIcon: React.FC<{ value: WorkoutPrivacy; color: string }> = ({ value, color }) => {
  if (value === 'friends') return <Users size={16} color={color} strokeWidth={1.8} />;
  if (value === 'public') return <Globe2 size={16} color={color} strokeWidth={1.8} />;
  return <Shield size={16} color={color} strokeWidth={1.8} />;
};

const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
  },
  android: { elevation: 6 },
}) ?? {};

const subtleCardShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  android: { elevation: 3 },
}) ?? {};

const surfaceBorder = {
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.065)',
  borderTopColor: 'rgba(255, 255, 255, 0.105)',
} as const;

const violetSurfaceBorder = {
  borderWidth: 1,
  borderColor: 'rgba(122, 85, 255, 0.22)',
} as const;

const styles = StyleSheet.create({
  background: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardAvoid: { flex: 1 },
  header: {
    minHeight: 50,
    paddingHorizontal: SPACING.screenHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    lineHeight: 22,
    color: COLORS.text,
    letterSpacing: 0,
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 10,
  },
  content: {
    gap: 12,
  },
  completionBlock: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 8,
    gap: 8,
  },
  checkRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(52, 224, 166, 0.74)',
    backgroundColor: 'rgba(52, 224, 166, 0.075)',
  },
  completeTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    lineHeight: 27,
    color: COLORS.text,
    letterSpacing: 0,
    marginTop: 2,
  },
  completeSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryTile: {
    width: '48.4%',
    minHeight: 66,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    ...surfaceBorder,
    justifyContent: 'center',
    gap: 4,
  },
  summaryTileLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    lineHeight: 13,
    color: COLORS.textTertiary,
  },
  summaryTileValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 21,
    lineHeight: 25,
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  summaryTileValueAccent: {
    color: COLORS.green,
  },
  bestSetCard: {
    minHeight: 66,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(232, 178, 70, 0.35)',
    ...subtleCardShadow,
  },
  bestSetCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  bestSetTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    lineHeight: 18,
    color: '#E8B246',
  },
  bestSetExercise: {
    maxWidth: '100%',
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textSecondary,
  },
  bestSetMetricBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bestSetMetric: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.text,
  },
  titleCard: {
    minHeight: 52,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    ...surfaceBorder,
  },
  titleInput: {
    minHeight: 34,
    padding: 0,
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.text,
  },
  notesCard: {
    minHeight: 96,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    ...surfaceBorder,
  },
  notesInput: {
    minHeight: 56,
    padding: 0,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.text,
  },
  charCount: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  privacyRow: {
    minHeight: 48,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    ...surfaceBorder,
  },
  privacyValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  shareRow: {
    minHeight: 65,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    ...surfaceBorder,
  },
  shareCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  settingTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    lineHeight: 17,
    color: COLORS.text,
  },
  settingValue: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textSecondary,
  },
  settingDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textTertiary,
  },
  statusNotice: {
    minHeight: 46,
    borderRadius: CARD_RADIUS_SM,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
    ...violetSurfaceBorder,
  },
  statusNoticeText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: CARD_RADIUS_SM,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    marginTop: 4,
  },
  saveButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  discardButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.textTertiary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
  },
  modalCard: {
    width: '100%',
    maxWidth: 388,
    borderRadius: CARD_RADIUS_LG,
    padding: 16,
    gap: 10,
    ...surfaceBorder,
    ...cardShadow,
  },
  modalHeader: {
    paddingBottom: 6,
    gap: 3,
  },
  modalTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    lineHeight: 27,
    color: COLORS.text,
  },
  modalSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textSecondary,
  },
  privacyOption: {
    minHeight: 72,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  privacyOptionSelected: {
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderColor: 'rgba(122, 85, 255, 0.30)',
  },
  privacyOptionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyOptionIconSelected: {
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
  },
  privacyOptionText: {
    flex: 1,
    gap: 3,
  },
  privacyOptionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: COLORS.text,
  },
  privacyOptionHelper: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
  },
  privacyCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyCheckSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
});
