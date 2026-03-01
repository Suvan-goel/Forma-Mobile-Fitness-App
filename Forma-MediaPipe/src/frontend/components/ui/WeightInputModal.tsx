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
import { X, Weight, Video, Download } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../../constants/theme';

interface WeightInputModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (weight: number, unit: 'kg' | 'lbs') => void;
  initialWeight?: number;
  initialUnit?: 'kg' | 'lbs';
  exerciseName?: string;
  setNumber?: number;
  hasRecording?: boolean;
  onSaveRecording?: (saveToCameraRoll: boolean) => void;
  onDiscardRecording?: () => void;
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
  onDiscardRecording,
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
    // Handle recording save/discard
    if (hasRecording) {
      if (saveToLibrary) {
        onSaveRecording?.(saveToCameraRoll);
      } else {
        onDiscardRecording?.();
      }
    }
    onClose();
  };

  const handleSkip = () => {
    // Discard recording when skipping
    if (hasRecording) {
      onDiscardRecording?.();
    }
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
          handleSkip();
        }}
      >
        <TouchableOpacity
          style={styles.cardOuter}
          activeOpacity={1}
          onPress={() => {}}
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>
                  {initialWeight !== undefined && initialWeight > 0 ? 'Edit Weight' : 'Log Weight'}
                </Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleSkip}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
                </TouchableOpacity>
              </View>

              {exerciseName && setNumber && (
                <Text style={styles.subtitle}>
                  {exerciseName} • Set {setNumber}
                </Text>
              )}

              {/* Weight input section */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>WEIGHT</Text>

                <View style={styles.inputRow}>
                  <View style={styles.rowIcon}>
                    <Weight
                      size={18}
                      color={COLORS.accent}
                      strokeWidth={1.5}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={COLORS.textTertiary}
                    autoFocus
                    selectTextOnFocus
                  />
                  <Text style={styles.inputUnitHint}>
                    {unit}
                  </Text>
                </View>
              </View>

              {/* Unit toggle section */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>UNIT</Text>

                <View style={styles.unitToggle}>
                  <TouchableOpacity
                    style={[styles.unitButton, unit === 'kg' && styles.unitButtonActive]}
                    onPress={() => setUnit('kg')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.unitText, unit === 'kg' && styles.unitTextActive]}>
                      kg
                    </Text>
                    <Text style={[styles.unitDescription, unit === 'kg' && styles.unitDescriptionActive]}>
                      Kilograms
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.unitButton, unit === 'lbs' && styles.unitButtonActive]}
                    onPress={() => setUnit('lbs')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.unitText, unit === 'lbs' && styles.unitTextActive]}>
                      lbs
                    </Text>
                    <Text style={[styles.unitDescription, unit === 'lbs' && styles.unitDescriptionActive]}>
                      Pounds
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Recording save section — only shown when a recording exists */}
              {hasRecording && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>SET RECORDING</Text>

                  <TouchableOpacity
                    style={[styles.recordingToggle, saveToLibrary && styles.recordingToggleActive]}
                    onPress={() => setSaveToLibrary(!saveToLibrary)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.rowIcon}>
                      <Video size={16} color={saveToLibrary ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                    </View>
                    <View style={styles.recordingToggleText}>
                      <Text style={[styles.recordingLabel, saveToLibrary && styles.recordingLabelActive]}>
                        Save to Video Library
                      </Text>
                    </View>
                    <View style={[styles.toggleDot, saveToLibrary && styles.toggleDotActive]} />
                  </TouchableOpacity>

                  {saveToLibrary && (
                    <TouchableOpacity
                      style={[styles.recordingSubToggle, saveToCameraRoll && styles.recordingToggleActive]}
                      onPress={() => setSaveToCameraRoll(!saveToCameraRoll)}
                      activeOpacity={0.7}
                    >
                      <Download size={14} color={saveToCameraRoll ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                      <Text style={[styles.recordingSubLabel, saveToCameraRoll && styles.recordingLabelActive]}>
                        Also save to Camera Roll
                      </Text>
                      <View style={[styles.toggleDotSmall, saveToCameraRoll && styles.toggleDotActive]} />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={handleSkip}
                  activeOpacity={0.7}
                >
                  <Text style={styles.skipButtonText}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={handleSubmit}
                  activeOpacity={0.7}
                >
                  <Text style={styles.submitButtonText}>Save</Text>
                </TouchableOpacity>
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
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xs,
  },
  title: {
    fontSize: 20,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    letterSpacing: 0.5,
  },
  section: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
    marginHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
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
  input: {
    flex: 1,
    fontSize: 36,
    fontFamily: FONTS.mono.bold,
    color: COLORS.accent,
    paddingVertical: SPACING.xs,
  },
  inputUnitHint: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginLeft: SPACING.sm,
  },
  unitToggle: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    paddingBottom: SPACING.sm,
  },
  unitButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  unitText: {
    fontSize: 15,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textTertiary,
    lineHeight: 20,
  },
  unitTextActive: {
    color: COLORS.accent,
  },
  unitDescription: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    opacity: 0.6,
    marginTop: 1,
  },
  unitDescriptionActive: {
    color: COLORS.textSecondary,
    opacity: 1,
  },
  recordingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: SPACING.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginBottom: SPACING.xs,
  },
  recordingToggleActive: {
    borderColor: 'rgba(139, 92, 246, 0.3)',
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
  },
  recordingToggleText: {
    flex: 1,
  },
  recordingLabel: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  recordingLabelActive: {
    color: COLORS.text,
  },
  recordingSubToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: SPACING.sm,
    marginLeft: 46,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    marginBottom: SPACING.xs,
  },
  recordingSubLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'transparent',
  },
  toggleDotSmall: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'transparent',
  },
  toggleDotActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  skipButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
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
  submitButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 14,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
