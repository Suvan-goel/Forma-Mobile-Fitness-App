import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  Modal,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronRight,
  Eye,
  Volume2,
  Bone,
  Bug,
  Timer,
  UserRound,
  SlidersHorizontal,
  Tv,
  Video,
  Wrench,
  Info,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_SHADOW,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { MonoText } from '../components/typography/MonoText';
import { TRAINERS } from '../constants/trainers';
import { DEV_FEATURES_ENABLED } from '../../config/devFeatures';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

/* ── Scroll Wheel Picker ─────────────────── */

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 3;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

interface WheelColumnProps {
  values: number[];
  selected: number;
  onValueChange: (value: number) => void;
  pad?: boolean;
}

const WheelColumn: React.FC<WheelColumnProps> = ({ values, selected, onValueChange, pad = true }) => {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrolling = useRef(false);
  const dragEndTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedIndex = values.indexOf(selected);

  useEffect(() => {
    if (!isUserScrolling.current && selectedIndex >= 0) {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedIndex]);

  const commitY = useCallback((y: number) => {
    const index = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(index, values.length - 1));
    if (values[clamped] !== selected) {
      onValueChange(values[clamped]);
    }
    isUserScrolling.current = false;
  }, [values, selected, onValueChange]);

  const handleScrollBeginDrag = useCallback(() => {
    isUserScrolling.current = true;
    if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
  }, []);

  const handleScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    dragEndTimer.current = setTimeout(() => {
      commitY(y);
    }, 50);
  }, [commitY]);

  const handleMomentumScrollBegin = useCallback(() => {
    if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
  }, []);

  const handleMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragEndTimer.current) clearTimeout(dragEndTimer.current);
    commitY(e.nativeEvent.contentOffset.y);
  }, [commitY]);

  return (
    <View style={wheelStyles.columnWrapper}>
      <View style={wheelStyles.fadeTop} pointerEvents="none" />
      <View style={wheelStyles.fadeBottom} pointerEvents="none" />
      <View style={wheelStyles.selectionHighlight} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        style={wheelStyles.column}
        contentContainerStyle={wheelStyles.columnContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
      >
        {values.map((val) => {
          const isSelected = val === selected;
          return (
            <View key={val} style={wheelStyles.item}>
              <MonoText
                bold={isSelected}
                style={[
                  wheelStyles.itemText,
                  isSelected && wheelStyles.itemTextSelected,
                ]}
              >
                {pad ? val.toString().padStart(2, '0') : val.toString()}
              </MonoText>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const MINUTES = Array.from({ length: 11 }, (_, i) => i);
const SECONDS = Array.from({ length: 12 }, (_, i) => i * 5);

const wheelStyles = StyleSheet.create({
  columnWrapper: {
    height: WHEEL_HEIGHT,
    width: 52,
    overflow: 'hidden',
  },
  column: {
    height: WHEEL_HEIGHT,
  },
  columnContent: {
    paddingVertical: ITEM_HEIGHT,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 18,
    color: COLORS.textTertiary,
  },
  itemTextSelected: {
    fontSize: 20,
    color: COLORS.accent,
  },
  fadeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  selectionHighlight: {
    position: 'absolute',
    top: ITEM_HEIGHT,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
    zIndex: 1,
  },
});

/* ── Settings Screen ─────────────────────── */

export const CameraSettingsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const {
    showFeedback,
    isTTSEnabled,
    showSkeletonOverlay,
    debugMode,
    restTimerEnabled,
    restTimerDurationSeconds,
    selectedTrainerId,
    autoScreenRecording,
    poseModel,
    poseBackend,
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDebugMode,
    setRestTimerEnabled,
    setRestTimerDurationSeconds,
    setAutoScreenRecording,
    setPoseModel,
    setPoseBackend,
  } = useCameraSettings();

  const [infoModal, setInfoModal] = useState<string | null>(null);

  const SETTING_INFO: Record<string, { title: string; description: string }> = {
    'Form Messages': {
      title: 'Form Messages',
      description: 'Shows real-time form feedback messages on screen during your workout, helping you correct your technique as you exercise.',
    },
    'Voice Coaching': {
      title: 'Voice Coaching',
      description: 'Enables AI voice coaching that speaks form corrections and encouragement during your workout using text-to-speech.',
    },
    'Skeleton Overlay': {
      title: 'Skeleton Overlay',
      description: 'Displays a skeleton overlay on the camera view showing your detected body joints and connections in real-time.',
    },
    'Auto Screen Recording': {
      title: 'Auto Screen Recording',
      description: 'Automatically records your screen during workouts so you can review your form afterwards.\n\nThis will increase battery drain and use additional phone storage.',
    },
    'Rest Timer': {
      title: 'Rest Timer',
      description: 'Automatically starts a countdown timer between sets so you can track your rest periods and stay on schedule.',
    },
    'Debug Mode': {
      title: 'Debug Mode',
      description: 'Enables the developer debug overlay showing joint angles, detection confidence, and raw pose data. Turns on skeleton overlay and disables TTS.',
    },
    'Heavy Model': {
      title: 'Heavy Model',
      description: 'Uses the heavy (29 MB) pose detection model instead of the default full (9 MB) model. The heavy model may provide more accurate landmark detection but uses more memory and may run slower on older devices.\n\nRequires a brief re-initialization when toggled.',
    },
    'Pose Backend': {
      title: 'Pose Backend',
      description: 'Selects the on-device pose detector used for rep counting and form feedback on iOS. Vision 3D requires iOS 17 or newer; MediaPipe remains available as a fallback.',
    },
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const currentTrainerName = TRAINERS.find((t) => t.id === selectedTrainerId)?.name ?? 'Maya';

  const currentMinutes = Math.floor(restTimerDurationSeconds / 60);
  const currentSeconds = restTimerDurationSeconds % 60;
  const snappedSeconds = Math.round(currentSeconds / 5) * 5;

  const handleTTSChange = (value: boolean) => {
    setIsTTSEnabled(value);
  };

  const handleDebugChange = (value: boolean) => {
    setDebugMode(value);
  };

  const handleRestTimerToggle = (value: boolean) => {
    setRestTimerEnabled(value);
  };

  const [isTimerModalVisible, setIsTimerModalVisible] = useState(false);
  const [pendingMinutes, setPendingMinutes] = useState(currentMinutes);
  const [pendingSeconds, setPendingSeconds] = useState(snappedSeconds);

  const openTimerModal = useCallback(() => {
    setPendingMinutes(currentMinutes);
    setPendingSeconds(snappedSeconds);
    setIsTimerModalVisible(true);
  }, [currentMinutes, snappedSeconds]);

  const handleTimerModalDone = useCallback(() => {
    const newTotal = pendingMinutes * 60 + pendingSeconds;
    setRestTimerDurationSeconds(Math.max(5, newTotal));
    setIsTimerModalVisible(false);
  }, [pendingMinutes, pendingSeconds, setRestTimerDurationSeconds]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'Record',
      params: { screen: 'RecordLanding' },
    });
  }, [navigation]);

  const formattedDuration = `${currentMinutes}:${snappedSeconds.toString().padStart(2, '0')}`;
  const IconBubble = ({ icon: Icon, color = COLORS.textSecondary }: { icon: any; color?: string }) => (
    <View style={styles.iconBubble}>
      <Icon size={17} color={color} strokeWidth={1.8} />
    </View>
  );

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="CAMERA SETTINGS" onBack={handleBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 120) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── FEEDBACK Section ──────────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <SlidersHorizontal size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>FEEDBACK</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.groupRow}>
                <IconBubble icon={Eye} />
                <View style={styles.rowLabelCol}>
                  <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Form Messages</Text>
                  <Text style={styles.rowSubLabel}>Live technique cues on screen</Text>
                </View>
                <TouchableOpacity onPress={() => setInfoModal('Form Messages')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={showFeedback}
                  onValueChange={setShowFeedback}
                  disabled={debugMode}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={showFeedback ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <IconBubble icon={Volume2} />
                <View style={styles.rowLabelCol}>
                  <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Voice Coaching</Text>
                  <Text style={styles.rowSubLabel}>Spoken feedback during sets</Text>
                </View>
                <TouchableOpacity onPress={() => setInfoModal('Voice Coaching')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={isTTSEnabled}
                  onValueChange={handleTTSChange}
                  disabled={debugMode}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={isTTSEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
            </View>
          </LinearGradient>

          {/* ── YOUR TRAINER Section ──────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <UserRound size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>YOUR TRAINER</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => (navigation as any).navigate('TrainerPicker')}
          >
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardEdge}>
                <View style={styles.row}>
                  <IconBubble icon={UserRound} />
                  <View style={styles.rowLabelCol}>
                    <Text style={styles.rowLabel}>Choose Trainer</Text>
                    <Text style={styles.rowSubLabel}>{currentTrainerName}</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── DISPLAY Section ───────────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Tv size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DISPLAY</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              {DEV_FEATURES_ENABLED && (
                <>
                  <View style={styles.groupRow}>
                    <IconBubble icon={Bone} />
                    <View style={styles.rowLabelCol}>
                      <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Skeleton Overlay</Text>
                      <Text style={styles.rowSubLabel}>Show pose landmarks on camera</Text>
                    </View>
                    <TouchableOpacity onPress={() => setInfoModal('Skeleton Overlay')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                    </TouchableOpacity>
                    <Switch
                      value={showSkeletonOverlay}
                      onValueChange={setShowSkeletonOverlay}
                      disabled={debugMode}
                      trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                      thumbColor={showSkeletonOverlay ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                    />
                  </View>
                  <View style={styles.rowDivider} />
                </>
              )}
              <View style={styles.groupRow}>
                <IconBubble icon={Video} />
                <View style={styles.rowLabelCol}>
                  <Text style={styles.rowLabel}>Auto Screen Recording</Text>
                  <Text style={styles.rowSubLabel}>Capture workout sessions</Text>
                </View>
                <TouchableOpacity onPress={() => setInfoModal('Auto Screen Recording')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={autoScreenRecording}
                  onValueChange={setAutoScreenRecording}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={autoScreenRecording ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              {Platform.OS === 'ios' && (
                <>
                  <View style={styles.rowDivider} />
                  <View style={styles.groupRow}>
                    <IconBubble icon={SlidersHorizontal} color={poseBackend === 'vision3d' ? COLORS.accent : COLORS.textSecondary} />
                    <View style={styles.rowLabelCol}>
                      <Text style={styles.rowLabel}>Pose Backend</Text>
                      <Text style={styles.rowSubLabel}>{poseBackend === 'vision3d' ? 'Apple Vision 3D' : 'MediaPipe fallback'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setInfoModal('Pose Backend')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                    </TouchableOpacity>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity
                        style={[styles.segmentOption, poseBackend === 'vision3d' && styles.segmentOptionActive]}
                        onPress={() => setPoseBackend('vision3d')}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.segmentText, poseBackend === 'vision3d' && styles.segmentTextActive]}>Vision</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.segmentOption, poseBackend === 'mediapipe' && styles.segmentOptionActive]}
                        onPress={() => setPoseBackend('mediapipe')}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.segmentText, poseBackend === 'mediapipe' && styles.segmentTextActive]}>MP</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}
            </View>
          </LinearGradient>

          {/* ── REST TIMER Section ────────────────── */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Timer size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>REST TIMER</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.groupRow}>
                <IconBubble icon={Timer} color={COLORS.green} />
                <View style={styles.rowLabelCol}>
                  <Text style={styles.rowLabel}>Rest Timer</Text>
                  <Text style={styles.rowSubLabel}>Countdown between sets</Text>
                </View>
                <TouchableOpacity onPress={() => setInfoModal('Rest Timer')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={restTimerEnabled}
                  onValueChange={handleRestTimerToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={restTimerEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              {restTimerEnabled && (
                <>
                  <View style={styles.rowDivider} />
                  <View style={styles.groupRow}>
                    <View style={styles.iconSpacer} />
                    <MonoText bold style={styles.restTimerValueText}>{formattedDuration}</MonoText>
                    <TouchableOpacity style={styles.changeButton} onPress={openTimerModal} activeOpacity={0.7}>
                      <Text style={styles.changeButtonText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </LinearGradient>

          {DEV_FEATURES_ENABLED && (
            <>
              {/* ── DEVELOPER Section ─────────────────── */}
              <View style={styles.sectionRow}>
                <View style={styles.sectionLabelRow}>
                  <Wrench size={13} color={COLORS.accent} strokeWidth={1.5} />
                  <Text style={styles.sectionLabel}>DEVELOPER</Text>
                </View>
              </View>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.cardGradient}
              >
                <View style={styles.groupEdge}>
                  <View style={styles.groupRow}>
                    <IconBubble icon={Bug} color={debugMode ? COLORS.orange : COLORS.textSecondary} />
                    <View style={styles.rowLabelCol}>
                      <Text style={[styles.rowLabel, debugMode && { color: COLORS.orange }]}>Debug Mode</Text>
                      <Text style={styles.rowSubLabel}>Developer pose diagnostics</Text>
                    </View>
                    <TouchableOpacity onPress={() => setInfoModal('Debug Mode')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                    </TouchableOpacity>
                    <Switch
                      value={debugMode}
                      onValueChange={handleDebugChange}
                      trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(224, 120, 86, 0.4)' }}
                      thumbColor={debugMode ? COLORS.orange : 'rgba(255, 255, 255, 0.3)'}
                    />
                  </View>
                  <View style={styles.rowDivider} />
                  <View style={styles.groupRow}>
                    <IconBubble icon={SlidersHorizontal} color={poseModel === 'pose_landmarker_heavy' ? '#60A5FA' : COLORS.textSecondary} />
                    <View style={styles.rowLabelCol}>
                      <Text style={[styles.rowLabel, poseModel === 'pose_landmarker_heavy' && { color: '#60A5FA' }]}>Heavy Model</Text>
                      <Text style={styles.rowSubLabel}>Higher accuracy, more memory</Text>
                    </View>
                    <TouchableOpacity onPress={() => setInfoModal('Heavy Model')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                    </TouchableOpacity>
                    <Switch
                      value={poseModel === 'pose_landmarker_heavy'}
                      onValueChange={(val) => setPoseModel(val ? 'pose_landmarker_heavy' : 'pose_landmarker_full')}
                      trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(96, 165, 250, 0.4)' }}
                      thumbColor={poseModel === 'pose_landmarker_heavy' ? '#60A5FA' : 'rgba(255, 255, 255, 0.3)'}
                    />
                  </View>
                </View>
              </LinearGradient>
            </>
          )}

        </Animated.View>
      </ScrollView>

      {/* Rest Timer Duration Modal */}
      <Modal
        visible={isTimerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsTimerModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            onPress={() => setIsTimerModalVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>REST DURATION</Text>
            <View style={styles.wheelRow}>
              <WheelColumn
                values={MINUTES}
                selected={pendingMinutes}
                onValueChange={setPendingMinutes}
              />
              <MonoText bold style={styles.wheelColon}>:</MonoText>
              <WheelColumn
                values={SECONDS}
                selected={pendingSeconds}
                onValueChange={setPendingSeconds}
              />
            </View>
            <View style={styles.wheelLabels}>
              <Text style={styles.wheelLabelText}>min</Text>
              <Text style={styles.wheelLabelText}>sec</Text>
            </View>
            <TouchableOpacity style={styles.modalDoneButton} onPress={handleTimerModalDone} activeOpacity={0.8}>
              <Text style={styles.modalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Info Modal */}
      <Modal
        visible={infoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModal(null)}
      >
        <TouchableOpacity
          style={styles.infoModalOverlay}
          activeOpacity={1}
          onPress={() => setInfoModal(null)}
        >
          <View style={styles.infoModalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.infoModalHeader}>
              <Text style={styles.infoModalTitle}>{infoModal ? SETTING_INFO[infoModal]?.title : ''}</Text>
              <TouchableOpacity onPress={() => setInfoModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
            <Text style={styles.infoModalDescription}>{infoModal ? SETTING_INFO[infoModal]?.description : ''}</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* Scroll */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* Section Headers — matches HomeScreen / SettingsScreen */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },

  /* Individual card */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
  },
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },

  /* Grouped card (multiple rows) */
  groupEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingVertical: 12,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginLeft: 44,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: CARD_RADIUS_SM,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
  },
  iconSpacer: {
    width: 30,
  },

  /* Row inside card */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13.5,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  rowLabelDisabled: {
    color: COLORS.textTertiary,
  },
  rowLabelCol: {
    flex: 1,
    gap: 2,
  },
  rowSubLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    lineHeight: 15,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.28)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    overflow: 'hidden',
  },
  segmentOption: {
    minWidth: 48,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentOptionActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.22)',
  },
  segmentText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  segmentTextActive: {
    color: COLORS.accent,
  },

  /* Rest Timer Value */
  restTimerValueText: {
    flex: 1,
    fontSize: 24,
    color: COLORS.accent,
  },
  changeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    backgroundColor: 'rgba(122, 85, 255, 0.1)',
  },
  changeButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 0.1,
  },

  /* Wheel Picker */
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    gap: 4,
  },
  wheelColon: {
    fontSize: 22,
    color: COLORS.accent,
    marginBottom: 2,
  },
  wheelLabels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 48,
    paddingBottom: 8,
  },
  wheelLabelText: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  /* Timer Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: 260,
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    ...CARD_SHADOW,
  },
  modalTitle: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  modalDoneButton: {
    marginTop: 20,
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: COLORS.accent,
  },
  modalDoneText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* Info Modal */
  infoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  infoModalContent: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    ...CARD_SHADOW,
  },
  infoModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  infoModalTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  infoModalDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },
});
