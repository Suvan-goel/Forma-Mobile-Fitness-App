import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Video, Download, Check } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, SCREEN_GRADIENT_COLORS ,
  CARD_SHADOW
} from '../../constants/theme';

interface RecordingOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  saveToLibrary: boolean;
  saveToCameraRoll: boolean;
  onUpdate: (saveToLibrary: boolean, saveToCameraRoll: boolean) => void;
  exerciseName?: string;
  setNumber?: number;
}

export const RecordingOptionsModal: React.FC<RecordingOptionsModalProps> = ({
  visible,
  onClose,
  saveToLibrary,
  saveToCameraRoll,
  onUpdate,
  exerciseName,
  setNumber,
}) => {
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
        onPress={onClose}
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
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title}>Recording</Text>
                  {exerciseName && setNumber != null && (
                    <Text style={styles.subtitle}>{exerciseName} · Set {setNumber}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Save To subheading + side-by-side toggle cards */}
              <Text style={styles.sectionHeading}>Save To</Text>
              <View style={styles.cardsRow}>
                <TouchableOpacity
                  style={[styles.optionCard, saveToLibrary && styles.optionCardActive]}
                  onPress={() => onUpdate(!saveToLibrary, !saveToLibrary ? saveToCameraRoll : false)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionIconWrap, saveToLibrary && styles.optionIconWrapActive]}>
                    <Video size={20} color={saveToLibrary ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                  </View>
                  <Text style={[styles.optionLabel, saveToLibrary && styles.optionLabelActive]}>
                    Video Library
                  </Text>
                  <View style={[styles.optionCheck, saveToLibrary && styles.optionCheckActive]}>
                    {saveToLibrary && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.optionCard, saveToCameraRoll && styles.optionCardActive]}
                  onPress={() => {
                    const next = !saveToCameraRoll;
                    onUpdate(next ? true : saveToLibrary, next);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.optionIconWrap, saveToCameraRoll && styles.optionIconWrapActive]}>
                    <Download size={20} color={saveToCameraRoll ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                  </View>
                  <Text style={[styles.optionLabel, saveToCameraRoll && styles.optionLabelActive]}>
                    Camera Roll
                  </Text>
                  <View style={[styles.optionCheck, saveToCameraRoll && styles.optionCheckActive]}>
                    {saveToCameraRoll && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>
              </View>

              {/* Done button */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.doneButtonOuter}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={['rgba(139, 92, 246, 0.65)', 'rgba(124, 58, 237, 0.35)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.doneButton}
                  >
                    <Text style={styles.doneButtonText}>Done</Text>
                  </LinearGradient>
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
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
  },
  cardGradient: {
    borderRadius: 22,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
  },
  header: {
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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Side-by-side cards ──────────────────── */
  sectionHeading: {
    fontSize: 11,
    fontFamily: FONTS.display.bold,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textAlign: 'center',
    paddingTop: SPACING.md,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  optionCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(39, 48, 55, 0.78)',
    gap: 10,

    ...CARD_SHADOW,
},
  optionCardActive: {
    borderColor: 'rgba(139, 92, 246, 0.3)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  optionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconWrapActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  optionLabel: {
    fontSize: 13,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textTertiary,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  optionLabelActive: {
    color: COLORS.text,
  },
  optionCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCheckActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },

  /* ── Button ──────────────────────────────── */
  buttonRow: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  doneButtonOuter: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  doneButton: {
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 14,
    fontFamily: FONTS.display.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
