import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../../constants/theme';
import { useCameraSettings } from '../../contexts/CameraSettingsContext';


interface CameraSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called when TTS is turned off (e.g. to stop any playing audio). Optional. */
  onTTSDisable?: () => void;
}

export const CameraSettingsModal: React.FC<CameraSettingsModalProps> = ({
  visible,
  onClose,
  onTTSDisable,
}) => {
  const {
    showFeedback,
    isTTSEnabled,
    showSkeletonOverlay,
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
  } = useCameraSettings();

  const handleTTSChange = (value: boolean) => {
    if (!value) {
      onTTSDisable?.();
    }
    setIsTTSEnabled(value);
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
        onPress={onClose}
      >
        <TouchableOpacity style={styles.cardOuter} activeOpacity={1} onPress={() => {}}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardGlassEdge}>
              <View style={styles.header}>
                <Text style={styles.title}>Settings</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={24} color={COLORS.text} strokeWidth={1.5} />
                </TouchableOpacity>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Show feedback messages</Text>
                <Switch
                  value={showFeedback}
                  onValueChange={setShowFeedback}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Spoken feedback (TTS)</Text>
                <Switch
                  value={isTTSEnabled}
                  onValueChange={handleTTSChange}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Show skeleton overlay</Text>
                <Switch
                  value={showSkeletonOverlay}
                  onValueChange={setShowSkeletonOverlay}
                  trackColor={{ false: COLORS.border, true: COLORS.accent }}
                  thumbColor={COLORS.text}
                />
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  cardOuter: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 22,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  title: {
    fontSize: 18,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    flex: 1,
  },
  closeButton: {
    padding: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  label: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    flex: 1,
  },
});
