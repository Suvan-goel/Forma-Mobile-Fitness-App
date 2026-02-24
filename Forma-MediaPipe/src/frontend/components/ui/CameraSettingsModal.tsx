import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
  Animated,
  BackHandler,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X, MessageSquareText, AudioLines, Bone, Bug } from 'lucide-react-native';
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
    debugMode,
    setShowFeedback,
    setIsTTSEnabled,
    setShowSkeletonOverlay,
    setDebugMode,
  } = useCameraSettings();

  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  // Handle Android back button
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const handleTTSChange = (value: boolean) => {
    if (!value) {
      onTTSDisable?.();
    }
    setIsTTSEnabled(value);
  };

  const handleDebugChange = (value: boolean) => {
    if (value) {
      onTTSDisable?.();
    }
    setDebugMode(value);
  };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.backdrop, { opacity }]} pointerEvents="auto">
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      />
      <TouchableOpacity style={styles.cardOuter} activeOpacity={1} onPress={() => {}}>
        <LinearGradient
          colors={[...CARD_GRADIENT_COLORS]}
          start={CARD_GRADIENT_START}
          end={CARD_GRADIENT_END}
          style={styles.cardGradient}
        >
          <View style={styles.cardGlassEdge}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Settings</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>

            {/* Feedback section */}
            <View style={styles.section}>
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
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>
                    Form messages
                  </Text>
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
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>
                    Voice coaching
                  </Text>
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

            {/* Display section */}
            <View style={styles.section}>
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
                  <Text style={[styles.label, debugMode && styles.labelDisabled]}>
                    Skeleton overlay
                  </Text>
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

            {/* Developer section */}
            <View style={[styles.section, styles.sectionLast]}>
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
                  <Text style={[styles.label, debugMode && styles.labelDebugActive]}>
                    Debug mode
                  </Text>
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
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    zIndex: 1000,
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
    paddingBottom: SPACING.sm,
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
  section: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
    marginHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  sectionLast: {
    paddingBottom: SPACING.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textTertiary,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
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
});
