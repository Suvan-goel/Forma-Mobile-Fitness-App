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
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ChevronRight, MessageSquareText, AudioLines, Bone, Bug, Timer, UserRound } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
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
  const selectedIndex = values.indexOf(selected);

  useEffect(() => {
    if (!isUserScrolling.current && selectedIndex >= 0) {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedIndex]);

  const handleMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(index, values.length - 1));
    if (values[clamped] !== selected) {
      onValueChange(values[clamped]);
    }
    isUserScrolling.current = false;
  }, [values, selected, onValueChange]);

  const handleScrollBegin = useCallback(() => {
    isUserScrolling.current = true;
  }, []);

  return (
    <View style={wheelStyles.columnWrapper}>
      <View style={wheelStyles.fadeTop} pointerEvents="none" />
      <View style={wheelStyles.fadeBottom} pointerEvents="none" />
      <View style={wheelStyles.selectionHighlight} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        style={wheelStyles.column}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        onScrollBeginDrag={handleScrollBegin}
        onMomentumScrollEnd={handleMomentumEnd}
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
  const {
    showFeedback,
    isTTSEnabled,
    showSkeletonOverlay,
    debugMode,
    restTimerEnabled,
    restTimerDurationSeconds,
    selectedTrainerId,
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDebugMode,
    setRestTimerEnabled,
    setRestTimerDurationSeconds,
  } = useCameraSettings();

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

  const handleRestTimerToggle = async (value: boolean) => {
    if (value) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        showAlert(
          'Notifications Disabled',
          'Enable notifications in your device settings to use the rest timer alert.'
        );
        return;
      }
    }
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
    <View style={styles.container}>
      {/* ── HEADER ──────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* ── SECTIONS ────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Feedback */}
        <TouchableOpacity style={styles.sectionOuter} activeOpacity={1}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.sectionGradient}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>FEEDBACK</Text>

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <MessageSquareText
                    size={18}
                    color={debugMode ? COLORS.textTertiary : COLORS.accent}
                    strokeWidth={1.5}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>Form messages</Text>
                  <Text style={[styles.description, debugMode && styles.descriptionDisabled]}>
                    On-screen feedback during reps
                  </Text>
                </View>
                <Switch
                  value={showFeedback}
                  onValueChange={setShowFeedback}
                  disabled={debugMode}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>

              <View style={styles.separator} />

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <AudioLines
                    size={18}
                    color={debugMode ? COLORS.textTertiary : COLORS.accent}
                    strokeWidth={1.5}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>Voice coaching</Text>
                  <Text style={[styles.description, debugMode && styles.descriptionDisabled]}>
                    Spoken cues via text-to-speech
                  </Text>
                </View>
                <Switch
                  value={isTTSEnabled}
                  onValueChange={handleTTSChange}
                  disabled={debugMode}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Trainer */}
        <TouchableOpacity
          style={styles.sectionOuter}
          activeOpacity={0.7}
          onPress={() => (navigation as any).navigate('TrainerPicker')}
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.sectionGradient}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>YOUR TRAINER</Text>
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <UserRound size={18} color={COLORS.accent} strokeWidth={1.5} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.label}>Trainer</Text>
                  <Text style={styles.description}>{currentTrainerName}</Text>
                </View>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Display */}
        <TouchableOpacity style={styles.sectionOuter} activeOpacity={1}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.sectionGradient}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>DISPLAY</Text>

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Bone
                    size={18}
                    color={debugMode ? COLORS.textTertiary : COLORS.accent}
                    strokeWidth={1.5}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>Skeleton overlay</Text>
                  <Text style={[styles.description, debugMode && styles.descriptionDisabled]}>
                    Show detected pose landmarks
                  </Text>
                </View>
                <Switch
                  value={showSkeletonOverlay}
                  onValueChange={setShowSkeletonOverlay}
                  disabled={debugMode}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Rest Timer */}
        <TouchableOpacity style={styles.sectionOuter} activeOpacity={1}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.sectionGradient}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>REST TIMER</Text>

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Timer
                    size={18}
                    color={restTimerEnabled ? COLORS.accent : COLORS.textSecondary}
                    strokeWidth={1.5}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.label}>Rest timer</Text>
                  <Text style={styles.description}>Countdown between sets</Text>
                </View>
                <Switch
                  value={restTimerEnabled}
                  onValueChange={handleRestTimerToggle}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>

              {restTimerEnabled && (
                <>
                  <View style={styles.separator} />
                  <View style={styles.restTimerValueRow}>
                    <MonoText bold style={styles.restTimerValueText}>{formattedDuration}</MonoText>
                    <TouchableOpacity style={styles.changeButton} onPress={openTimerModal} activeOpacity={0.7}>
                      <Text style={styles.changeButtonText}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Developer */}
        <TouchableOpacity style={styles.sectionOuter} activeOpacity={1}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.sectionGradient}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>DEVELOPER</Text>

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Bug
                    size={18}
                    color={debugMode ? COLORS.orange : COLORS.textSecondary}
                    strokeWidth={1.5}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.label, debugMode && styles.labelDebugActive]}>Debug mode</Text>
                  <Text style={[styles.description, debugMode && styles.descriptionDebugActive]}>
                    Skeleton on, TTS off, shows angles
                  </Text>
                </View>
                <Switch
                  value={debugMode}
                  onValueChange={handleDebugChange}
                  trackColor={{ false: COLORS.border, true: COLORS.orange }}
                  thumbColor={COLORS.text}
                />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>

      {/* Rest Timer Duration Modal */}
      <Modal
        visible={isTimerModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsTimerModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setIsTimerModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
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
          </TouchableOpacity>
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

  /* ── Header ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 16,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 2,
  },

  /* ── Scroll ──────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
    gap: 12,
  },

  /* ── Section Cards ───────────────────────── */
  sectionOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  sectionGradient: {
    borderRadius: 19,
  },
  sectionCard: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },

  /* ── Rows ────────────────────────────────── */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.xs,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowText: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    marginLeft: 46,
  },
  label: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    lineHeight: 20,
  },
  labelDisabled: {
    color: COLORS.textTertiary,
  },
  labelDebugActive: {
    color: COLORS.orange,
  },
  description: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 16,
    marginTop: 1,
  },
  descriptionDisabled: {
    color: COLORS.textTertiary,
    opacity: 0.7,
  },
  descriptionDebugActive: {
    color: COLORS.textSecondary,
  },

  /* ── Wheel Picker ────────────────────────── */
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

  /* ── Rest Timer Value Row ─────────────────── */
  restTimerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: SPACING.xs,
  },
  restTimerValueText: {
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

  /* ── Timer Modal ──────────────────────────── */
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
});
