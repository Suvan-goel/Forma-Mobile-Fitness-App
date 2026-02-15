import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import { X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
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
        <TouchableOpacity style={styles.content} activeOpacity={1} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Show feedback messages</Text>
            <Switch
              value={showFeedback}
              onValueChange={setShowFeedback}
              trackColor={{ false: 'rgba(128, 128, 128, 0.4)', true: COLORS.primary }}
              thumbColor={COLORS.text}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Spoken feedback (TTS)</Text>
            <Switch
              value={isTTSEnabled}
              onValueChange={handleTTSChange}
              trackColor={{ false: 'rgba(128, 128, 128, 0.4)', true: COLORS.primary }}
              thumbColor={COLORS.text}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Show skeleton overlay</Text>
            <Switch
              value={showSkeletonOverlay}
              onValueChange={setShowSkeletonOverlay}
              trackColor={{ false: 'rgba(128, 128, 128, 0.4)', true: COLORS.primary }}
              thumbColor={COLORS.text}
            />
          </View>
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
  content: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
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
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  title: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
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
