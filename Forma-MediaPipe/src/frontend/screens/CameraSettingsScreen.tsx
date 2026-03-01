import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
  ScrollView,
  Modal,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft,
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
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { useAlert } from '../contexts/AlertContext';
import { MonoText } from '../components/typography/MonoText';
import { TRAINERS } from '../constants/trainers';

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
  const navigation = useNavigation();
  const { showAlert } = useAlert();
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
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDebugMode,
    setRestTimerEnabled,
    setRestTimerDurationSeconds,
    setAutoScreenRecording,
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

  const formattedDuration = `${currentMinutes}:${snappedSeconds.toString().padStart(2, '0')}`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
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
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                  <Eye size={14} color="#A78BFA" strokeWidth={1.5} />
                </View>
                <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Form Messages</Text>
                <TouchableOpacity onPress={() => setInfoModal('Form Messages')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={showFeedback}
                  onValueChange={setShowFeedback}
                  disabled={debugMode}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={showFeedback ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(96, 165, 250, 0.10)' }]}>
                  <Volume2 size={14} color="#60A5FA" strokeWidth={1.5} />
                </View>
                <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Voice Coaching</Text>
                <TouchableOpacity onPress={() => setInfoModal('Voice Coaching')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={isTTSEnabled}
                  onValueChange={handleTTSChange}
                  disabled={debugMode}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
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
                  <View style={[styles.iconWrap, { backgroundColor: 'rgba(244, 114, 182, 0.10)' }]}>
                    <UserRound size={14} color="#F472B6" strokeWidth={1.5} />
                  </View>
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
              <View style={styles.groupRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                  <Bone size={14} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
                <Text style={[styles.rowLabel, debugMode && styles.rowLabelDisabled]}>Skeleton Overlay</Text>
                <TouchableOpacity onPress={() => setInfoModal('Skeleton Overlay')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={showSkeletonOverlay}
                  onValueChange={setShowSkeletonOverlay}
                  disabled={debugMode}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={showSkeletonOverlay ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.10)' }]}>
                  <Video size={14} color="#EF4444" strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Auto Screen Recording</Text>
                <TouchableOpacity onPress={() => setInfoModal('Auto Screen Recording')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={autoScreenRecording}
                  onValueChange={setAutoScreenRecording}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={autoScreenRecording ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
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
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(52, 211, 153, 0.10)' }]}>
                  <Timer size={14} color="#34D399" strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Rest Timer</Text>
                <TouchableOpacity onPress={() => setInfoModal('Rest Timer')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={restTimerEnabled}
                  onValueChange={handleRestTimerToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={restTimerEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              {restTimerEnabled && (
                <>
                  <View style={styles.rowDivider} />
                  <View style={styles.groupRow}>
                    <View style={[styles.iconWrap, { backgroundColor: 'transparent' }]} />
                    <MonoText bold style={styles.restTimerValueText}>{formattedDuration}</MonoText>
                    <TouchableOpacity style={styles.changeButton} onPress={openTimerModal} activeOpacity={0.7}>
                      <Text style={styles.changeButtonText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </LinearGradient>

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
            <View style={styles.cardEdge}>
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: debugMode ? 'rgba(224, 120, 86, 0.10)' : 'rgba(255, 255, 255, 0.04)' }]}>
                  <Bug size={14} color={debugMode ? COLORS.orange : COLORS.textTertiary} strokeWidth={1.5} />
                </View>
                <Text style={[styles.rowLabel, debugMode && { color: COLORS.orange }]}>Debug Mode</Text>
                <TouchableOpacity onPress={() => setInfoModal('Debug Mode')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={debugMode}
                  onValueChange={handleDebugChange}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(224, 120, 86, 0.4)' }}
                  thumbColor={debugMode ? COLORS.orange : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
            </View>
          </LinearGradient>

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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header — matches SettingsScreen */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backBtn: {
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
  headerSpacer: {
    width: 40,
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

  /* Individual card */
  cardGradient: {
    borderRadius: 18,
  },
  cardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },

  /* Grouped card (multiple rows) */
  groupEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },

  /* Row inside card */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.1,
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
  },

  /* Rest Timer Value */
  restTimerValueText: {
    flex: 1,
    fontSize: 22,
    color: COLORS.accent,
  },
  changeButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  changeButtonText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: 0.3,
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
    backgroundColor: '#111113',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
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
    borderRadius: 14,
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
    backgroundColor: '#1A1625',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 22,
    width: '100%',
    maxWidth: 340,
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
