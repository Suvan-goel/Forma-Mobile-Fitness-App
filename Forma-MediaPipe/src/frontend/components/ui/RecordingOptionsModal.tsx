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
import { COLORS, FONTS, SPACING } from '../../constants/theme';

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
            colors={['#1E1A2E', '#151020', '#0C0A14']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>Recording Options</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
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

              {/* Recording toggles */}
              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.recordingToggle, saveToLibrary && styles.recordingToggleActive]}
                  onPress={() => {
                    const newSaveToLibrary = !saveToLibrary;
                    onUpdate(newSaveToLibrary, newSaveToLibrary ? saveToCameraRoll : false);
                  }}
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
                  <View style={[styles.toggleDot, saveToLibrary && styles.toggleDotActive]}>
                    {saveToLibrary && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>

                {saveToLibrary && (
                  <TouchableOpacity
                    style={[styles.recordingSubToggle, saveToCameraRoll && styles.recordingToggleActive]}
                    onPress={() => onUpdate(saveToLibrary, !saveToCameraRoll)}
                    activeOpacity={0.7}
                  >
                    <Download size={14} color={saveToCameraRoll ? COLORS.accent : COLORS.textTertiary} strokeWidth={1.5} />
                    <Text style={[styles.recordingSubLabel, saveToCameraRoll && styles.recordingLabelActive]}>
                      Also save to Camera Roll
                    </Text>
                    <View style={[styles.toggleDotSmall, saveToCameraRoll && styles.toggleDotActive]}>
                      {saveToCameraRoll && <Check size={10} color="#FFFFFF" strokeWidth={3} />}
                    </View>
                  </TouchableOpacity>
                )}
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
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
  },
  cardGradient: {
    borderRadius: 22,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
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
    fontSize: 18,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
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
    borderTopColor: 'rgba(139, 92, 246, 0.08)',
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
  recordingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginBottom: SPACING.xs,
  },
  recordingToggleActive: {
    borderColor: 'rgba(139, 92, 246, 0.3)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
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
    borderRadius: 12,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleDotSmall: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleDotActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  buttonRow: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
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
