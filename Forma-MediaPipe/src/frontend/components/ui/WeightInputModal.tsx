import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Keyboard,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Video, Download, Check, Dumbbell } from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_LG,
  CARD_SHADOW
} from '../../constants/theme';

interface WeightInputModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (weight: number, unit: 'kg' | 'lbs') => void;
  initialWeight?: number;
  initialUnit?: 'kg' | 'lbs';
  exerciseName?: string;
  setNumber?: number;
  hasRecording?: boolean;
  initialSaveToLibrary?: boolean;
  initialSaveToCameraRoll?: boolean;
  onSaveRecording?: (saveToLibrary: boolean, saveToCameraRoll: boolean) => void;
}

export const WeightInputModal: React.FC<WeightInputModalProps> = ({
  visible,
  onClose,
  onSubmit,
  initialWeight,
  initialUnit = 'kg',
  exerciseName,
  setNumber,
  hasRecording,
  initialSaveToLibrary = true,
  initialSaveToCameraRoll = false,
  onSaveRecording,
}) => {
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>(initialUnit);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [saveToCameraRoll, setSaveToCameraRoll] = useState(false);
  const [isModalReady, setIsModalReady] = useState(false);
  const weightInputRef = useRef<TextInput>(null);
  const revealFrameRef = useRef<number | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setIsModalReady(false);
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = null;
      }
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
      return;
    }

    if (visible) {
      setWeight(initialWeight ? String(initialWeight) : '');
      setUnit(initialUnit);
      setSaveToLibrary(initialSaveToLibrary);
      setSaveToCameraRoll(initialSaveToCameraRoll);
    }
  }, [visible, initialWeight, initialUnit, initialSaveToLibrary, initialSaveToCameraRoll]);

  useEffect(() => {
    return () => {
      if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const handleModalShow = useCallback(() => {
    if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);

    revealFrameRef.current = requestAnimationFrame(() => {
      revealFrameRef.current = null;
      setIsModalReady(true);
      focusTimerRef.current = setTimeout(() => {
        weightInputRef.current?.focus();
      }, Platform.OS === 'ios' ? 80 : 120);
    });
  }, []);

  const handleSubmit = () => {
    const weightNum = parseFloat(weight);
    if (!isNaN(weightNum) && weightNum > 0) {
      onSubmit(weightNum, unit);
      setWeight('');
    } else if (weight === '' || weightNum === 0) {
      onSubmit(0, unit);
      setWeight('');
    }
    // Store recording preferences (actual save deferred to workout save)
    if (hasRecording) {
      onSaveRecording?.(saveToLibrary, saveToCameraRoll);
    }
    onClose();
  };

  const handleSkip = () => {
    setWeight('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={handleModalShow}
      onRequestClose={() => {
        Keyboard.dismiss();
        hasRecording ? handleSubmit() : handleSkip();
      }}
    >
      <TouchableOpacity
        style={[styles.backdrop, !isModalReady && styles.backdropHidden]}
        activeOpacity={1}
        onPress={() => {
          Keyboard.dismiss();
          hasRecording ? handleSubmit() : handleSkip();
        }}
      >
        <TouchableOpacity
          style={styles.cardOuter}
          activeOpacity={1}
          onPress={() => {}}
        >
          <LinearGradient
            colors={CARD_GRADIENT_COLORS as any}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title}>
                    {initialWeight !== undefined && initialWeight > 0 ? 'Edit Weight' : 'Log Weight'}
                  </Text>
                  {exerciseName && setNumber != null && (
                    <Text style={styles.subtitle}>{exerciseName} · Set {setNumber}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={hasRecording ? handleSubmit : handleSkip}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
                </TouchableOpacity>
              </View>

            {/* Body */}
            <View style={styles.body}>
              {/* Weight input hero */}
              <View style={styles.weightHero}>
                <View style={styles.weightHeroHeader}>
                  <View style={styles.weightIconWrap}>
                    <Dumbbell size={15} color={COLORS.accent} strokeWidth={1.7} />
                  </View>
                  <Text style={styles.weightLabel}>WEIGHT</Text>
                </View>
                <View style={styles.weightEntryRow}>
                  <View style={styles.weightInputWrap}>
                    <TextInput
                      ref={weightInputRef}
                      style={styles.weightInput}
                      value={weight}
                      onChangeText={setWeight}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      placeholder="0"
                      placeholderTextColor="rgba(255, 255, 255, 0.22)"
                      selectTextOnFocus
                    />
                  </View>
                  <Text style={styles.weightUnitHint}>{unit}</Text>
                </View>
              </View>

              {/* Unit toggle — inline pills */}
              <View style={styles.unitRow}>
                <TouchableOpacity
                  style={[styles.unitPill, unit === 'kg' && styles.unitPillActive]}
                  onPress={() => setUnit('kg')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.unitPillText, unit === 'kg' && styles.unitPillTextActive]}>kg</Text>
                  <Text style={[styles.unitPillSub, unit === 'kg' && styles.unitPillSubActive]}>Kilograms</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitPill, unit === 'lbs' && styles.unitPillActive]}
                  onPress={() => setUnit('lbs')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.unitPillText, unit === 'lbs' && styles.unitPillTextActive]}>lbs</Text>
                  <Text style={[styles.unitPillSub, unit === 'lbs' && styles.unitPillSubActive]}>Pounds</Text>
                </TouchableOpacity>
              </View>

              {/* Recording options — side-by-side cards */}
              <View style={styles.recordingSection}>
                <View style={styles.sectionLabelRow}>
                  <Video size={12} color={hasRecording ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                  <Text style={[styles.sectionLabel, !hasRecording && styles.sectionLabelDisabled]}>RECORDING</Text>
                </View>

                {hasRecording ? (
                  <>
                    <Text style={styles.recordingSaveToHeading}>Save To</Text>
                    <View style={styles.recordingCardsRow}>
                      <TouchableOpacity
                        style={[styles.recordingCard, saveToLibrary && styles.recordingCardActive]}
                        onPress={() => {
                          const next = !saveToLibrary;
                          setSaveToLibrary(next);
                          if (!next) setSaveToCameraRoll(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.recordingCardIcon, saveToLibrary && styles.recordingCardIconActive]}>
                          <Video size={18} color={saveToLibrary ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                        </View>
                        <Text style={[styles.recordingCardLabel, saveToLibrary && styles.recordingCardLabelActive]}>
                          Video Library
                        </Text>
                        <View style={[styles.recordingCardCheck, saveToLibrary && styles.recordingCardCheckActive]}>
                          {saveToLibrary && <Check size={10} color="#FFFFFF" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.recordingCard, saveToCameraRoll && styles.recordingCardActive]}
                        onPress={() => {
                          const next = !saveToCameraRoll;
                          if (next) setSaveToLibrary(true);
                          setSaveToCameraRoll(next);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.recordingCardIcon, saveToCameraRoll && styles.recordingCardIconActive]}>
                          <Download size={18} color={saveToCameraRoll ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                        </View>
                        <Text style={[styles.recordingCardLabel, saveToCameraRoll && styles.recordingCardLabelActive]}>
                          Camera Roll
                        </Text>
                        <View style={[styles.recordingCardCheck, saveToCameraRoll && styles.recordingCardCheckActive]}>
                          {saveToCameraRoll && <Check size={10} color="#FFFFFF" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={styles.recordingStatusRow}>
                    <View style={styles.recordingStatusIcon}>
                      <Video size={16} color={COLORS.textTertiary} strokeWidth={1.6} />
                    </View>
                    <View style={styles.recordingStatusCopy}>
                      <Text style={styles.recordingStatusTitle}>No recording attached</Text>
                      <Text style={styles.recordingStatusText}>This set will save weight only.</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Action buttons */}
              <View style={styles.buttonRow}>
                {!hasRecording && (
                  <TouchableOpacity
                    style={styles.skipButton}
                    onPress={handleSkip}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.skipButtonText}>Skip</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.saveButtonOuter}
                  onPress={handleSubmit}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[COLORS.primary, COLORS.primaryDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.saveButtonGradient}
                  >
                    <Text style={styles.saveButtonText}>Save</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal + 4,
  },
  backdropHidden: {
    opacity: 0,
  },
  cardOuter: {
    width: '100%',
    maxWidth: 388,
    borderRadius: CARD_RADIUS_LG,
    ...CARD_SHADOW,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.32,
        shadowRadius: 26,
      },
      android: { elevation: 8 },
    }),
  },
  cardGradient: {
    borderRadius: CARD_RADIUS_LG,
    overflow: 'hidden',
  },
  cardGlassEdge: {
    borderRadius: CARD_RADIUS_LG,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 17,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.045)',
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  title: {
    fontSize: 22,
    lineHeight: 27,
    fontFamily: FONTS.display.bold,
    color: COLORS.text,
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Body ─────────────────────────────────── */
  body: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 22,
    gap: 15,
  },

  /* ── Weight Hero ──────────────────────────── */
  weightHero: {
    minHeight: 114,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: CARD_RADIUS,
    backgroundColor: 'rgba(122, 85, 255, 0.075)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.20)',
    gap: 12,
  },
  weightHeroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weightIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(122, 85, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 1.2,
  },
  weightEntryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  weightInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weightInput: {
    flex: 1,
    minHeight: 46,
    fontSize: 34,
    lineHeight: 42,
    fontFamily: FONTS.display.bold,
    color: COLORS.accent,
    letterSpacing: 0,
    padding: 0,
  },
  weightUnitHint: {
    minWidth: 34,
    paddingBottom: 7,
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
    textAlign: 'right',
  },

  /* ── Unit Toggle ──────────────────────────── */
  unitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  unitPill: {
    flex: 1,
    minHeight: 62,
    paddingVertical: 10,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillActive: {
    borderColor: 'rgba(122, 85, 255, 0.42)',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
  },
  unitPillText: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textTertiary,
  },
  unitPillTextActive: {
    color: COLORS.accent,
  },
  unitPillSub: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  unitPillSubActive: {
    color: COLORS.textSecondary,
  },

  /* ── Recording Section ────────────────────── */
  recordingSection: {
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.055)',
    gap: 11,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 1.4,
  },
  recordingSaveToHeading: {
    fontSize: 10,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
    letterSpacing: 1.2,
    marginTop: -2,
  },
  recordingCardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  recordingCard: {
    flex: 1,
    minHeight: 96,
    alignItems: 'flex-start',
    paddingVertical: 13,
    paddingHorizontal: 13,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    gap: 9,
  },
  recordingCardActive: {
    borderColor: 'rgba(122, 85, 255, 0.38)',
    backgroundColor: 'rgba(122, 85, 255, 0.11)',
  },
  recordingCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCardIconActive: {
    backgroundColor: 'rgba(122, 85, 255, 0.16)',
  },
  recordingCardLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
  },
  recordingCardLabelActive: {
    color: COLORS.text,
  },
  recordingCardCheck: {
    position: 'absolute',
    right: 12,
    top: 13,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCardCheckActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  sectionLabelDisabled: {
    color: COLORS.textTertiary,
  },
  recordingStatusRow: {
    minHeight: 62,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  recordingStatusIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  recordingStatusCopy: {
    flex: 1,
    gap: 2,
  },
  recordingStatusTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
  },
  recordingStatusText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },

  /* ── Buttons ──────────────────────────────── */
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 2,
  },
  skipButton: {
    flex: 1,
    height: 52,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.075)',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
  },
  saveButtonOuter: {
    flex: 2,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  saveButtonGradient: {
    height: 52,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15.5,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
  },
});
