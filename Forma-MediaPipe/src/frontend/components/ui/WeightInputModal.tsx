import React, { useState, useEffect } from 'react';
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
import { COLORS, FONTS, SPACING, SCREEN_GRADIENT_COLORS } from '../../constants/theme';

interface WeightInputModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (weight: number, unit: 'kg' | 'lbs') => void;
  initialWeight?: number;
  initialUnit?: 'kg' | 'lbs';
  exerciseName?: string;
  setNumber?: number;
  hasRecording?: boolean;
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
  onSaveRecording,
}) => {
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>(initialUnit);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [saveToCameraRoll, setSaveToCameraRoll] = useState(false);

  useEffect(() => {
    if (visible) {
      setWeight(initialWeight ? String(initialWeight) : '');
      setUnit(initialUnit);
      setSaveToLibrary(true);
      setSaveToCameraRoll(false);
    }
  }, [visible, initialWeight, initialUnit]);

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
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
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
            colors={SCREEN_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title}>
                    {hasRecording ? 'Log Set' : (initialWeight !== undefined && initialWeight > 0 ? 'Edit Weight' : 'Log Weight')}
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
                <View style={styles.weightIconWrap}>
                  <Dumbbell size={16} color={COLORS.accent} strokeWidth={1.5} />
                </View>
                <View style={styles.weightInputWrap}>
                  <TextInput
                    style={styles.weightInput}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="rgba(139, 92, 246, 0.25)"
                    autoFocus
                    selectTextOnFocus
                  />
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
                  <View style={styles.recordingDisabledRow}>
                    <View style={[styles.recordingCardsRow, styles.recordingCardsDisabled]}>
                      <View style={[styles.recordingCard, styles.recordingCardDisabled]}>
                        <View style={styles.recordingCardIcon}>
                          <Video size={18} color={COLORS.textTertiary} strokeWidth={1.5} />
                        </View>
                        <Text style={styles.recordingCardLabel}>Video Library</Text>
                        <View style={styles.recordingCardCheck} />
                      </View>
                      <View style={[styles.recordingCard, styles.recordingCardDisabled]}>
                        <View style={styles.recordingCardIcon}>
                          <Download size={18} color={COLORS.textTertiary} strokeWidth={1.5} />
                        </View>
                        <Text style={styles.recordingCardLabel}>Camera Roll</Text>
                        <View style={styles.recordingCardCheck} />
                      </View>
                    </View>
                    <Text style={styles.notRecordedText}>Set was not recorded</Text>
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
                    colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  cardOuter: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
      },
      android: { elevation: 10 },
    }),
  },
  cardGradient: {
    borderRadius: 22,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  title: {
    fontSize: 20,
    fontFamily: FONTS.display.bold,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Body ─────────────────────────────────── */
  body: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
  },

  /* ── Weight Hero ──────────────────────────── */
  weightHero: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.1)',
    marginBottom: SPACING.md,
  },
  weightIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  weightInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  weightInput: {
    flex: 1,
    fontSize: 38,
    fontFamily: FONTS.display.bold,
    color: COLORS.accent,
    letterSpacing: -1,
    paddingVertical: 2,
  },
  weightUnitHint: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginLeft: SPACING.sm,
    marginBottom: 4,
  },

  /* ── Unit Toggle ──────────────────────────── */
  unitRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  unitPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillActive: {
    borderColor: 'rgba(139, 92, 246, 0.35)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  unitPillText: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textTertiary,
    lineHeight: 20,
  },
  unitPillTextActive: {
    color: COLORS.accent,
  },
  unitPillSub: {
    fontSize: 10,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    opacity: 0.5,
    marginTop: 1,
  },
  unitPillSubActive: {
    color: COLORS.textSecondary,
    opacity: 1,
  },

  /* ── Recording Section ────────────────────── */
  recordingSection: {
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(139, 92, 246, 0.08)',
    marginBottom: SPACING.sm,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  recordingSaveToHeading: {
    fontSize: 11,
    fontFamily: FONTS.display.bold,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  recordingCardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  recordingCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    gap: 8,
  },
  recordingCardActive: {
    borderColor: 'rgba(139, 92, 246, 0.3)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  recordingCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCardIconActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  recordingCardLabel: {
    fontSize: 12,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textTertiary,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  recordingCardLabelActive: {
    color: COLORS.text,
  },
  recordingCardCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.12)',
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
  recordingDisabledRow: {
    alignItems: 'center' as const,
  },
  recordingCardsDisabled: {
    opacity: 0.35,
  },
  recordingCardDisabled: {
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  notRecordedText: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: 10,
  },

  /* ── Buttons ──────────────────────────────── */
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingTop: SPACING.md,
  },
  skipButton: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  saveButtonOuter: {
    flex: 2,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  saveButtonGradient: {
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
