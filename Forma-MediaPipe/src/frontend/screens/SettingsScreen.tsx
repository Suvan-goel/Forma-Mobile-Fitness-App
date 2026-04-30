import React, { useRef, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Animated, Switch, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Bell,
  Lock,
  HelpCircle,
  Eye,
  Volume2,
  Bone,
  UserRound,
  RefreshCcw,
  Calendar,
  Crown,
  Video,
  Camera,
  MessageSquare,
  Info,
  X,
} from 'lucide-react-native';
import type { WeeklyTrainingTarget } from '../../backend/hooks/useWorkoutPreferences';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_SHADOW,
} from '../constants/theme';
import { ScreenBackground, SettingsHeader } from '../components/ui';
import { DEFAULT_TRAINER_ID, TRAINERS } from '../constants/trainers';
import { useAuth } from '../../backend/contexts/AuthContext';
import { useWorkoutPreferences, useUser } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';
import { useFocusEffect } from '@react-navigation/native';
import { DEV_FEATURES_ENABLED } from '../../config/devFeatures';

const hexToRgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { signOut } = useAuth();
  const { refetch: refetchUser } = useUser();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { prefs, updatePref } = useWorkoutPreferences();
  const [infoModal, setInfoModal] = useState<string | null>(null);
  const selectedTrainer = useMemo(
    () =>
      TRAINERS.find((trainer) => trainer.id === prefs.selectedTrainerId) ??
      TRAINERS.find((trainer) => trainer.id === DEFAULT_TRAINER_ID),
    [prefs.selectedTrainerId],
  );

  const SETTING_INFO: Record<string, { title: string; description: string }> = {
    'Visual Feedback': {
      title: 'Visual Feedback',
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
    'Training Frequency': {
      title: 'Training Frequency',
      description: 'Set your weekly training goal to help personalize your workout recommendations and track your consistency.',
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

  useFocusEffect(
    React.useCallback(() => {
      refetchUser();
    }, [refetchUser]),
  );

  const TRAINING_TARGET_OPTIONS: WeeklyTrainingTarget[] = ['1-2', '3-4', '5+'];
  const TRAINING_TARGET_LABELS: Record<WeeklyTrainingTarget, string> = {
    '1-2': '1–2 days / week',
    '3-4': '3–4 days / week',
    '5+': '5+ days / week',
  };

  const handleTrainingTargetPress = () => {
    const current = prefs.weeklyTrainingTarget;
    const currentIdx = TRAINING_TARGET_OPTIONS.indexOf(current);
    const nextIdx = (currentIdx + 1) % TRAINING_TARGET_OPTIONS.length;
    updatePref('weeklyTrainingTarget', TRAINING_TARGET_OPTIONS[nextIdx]);
  };

  const handleSignOutPress = () => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (signOutError) {
            showAlert('Error', 'Failed to sign out. Please try again.');
          }
        },
      },
    ]);
  };

  const handleSendFeedback = () => {
    showAlert('Send Feedback', 'Feedback sharing is coming soon. For now, please contact support from the Help Center.');
  };

  /* Icon bubble — rounded square w/ tinted background */
  const IconBubble = ({ icon: Icon, color }: { icon: any; color: string }) => (
    <View style={[styles.iconBubble, { backgroundColor: hexToRgba(color, 0.14) }]}>
      <Icon size={17} color={color} strokeWidth={2} />
    </View>
  );

  /* Reusable navigation row (chevron) — used inside grouped cards */
  const NavRow = ({
    icon: Icon, iconColor, label, sub, onPress,
  }: {
    icon: any; iconColor: string; label: string; sub?: string; onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.groupRow} onPress={onPress} activeOpacity={0.7}>
      <IconBubble icon={Icon} color={iconColor} />
      <View style={styles.rowLabelCol}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub && <Text style={styles.rowSubLabel}>{sub}</Text>}
      </View>
      <ChevronRight size={18} color={COLORS.textTertiary} strokeWidth={2} />
    </TouchableOpacity>
  );

  /* Toggle row — used inside grouped cards */
  const ToggleRow = ({
    icon: Icon, iconColor, label, sub, value, onToggle, infoKey,
  }: {
    icon: any; iconColor: string; label: string; sub?: string;
    value: boolean; onToggle: (v: boolean) => void; infoKey?: string;
  }) => (
    <View style={styles.groupRow}>
      <IconBubble icon={Icon} color={iconColor} />
      <View style={styles.rowLabelCol}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub && <Text style={styles.rowSubLabel}>{sub}</Text>}
      </View>
      {infoKey && (
        <TouchableOpacity onPress={() => setInfoModal(infoKey)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
        </TouchableOpacity>
      )}
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
        thumbColor={value ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
      />
    </View>
  );

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="SETTINGS" onBack={() => navigation.navigate('MainTabs', { screen: 'Home' })} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Account Section */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>ACCOUNT</Text>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <NavRow
                icon={UserRound}
                iconColor={COLORS.textSecondary}
                label="Profile"
                sub="View your public profile"
                onPress={() => navigation.navigate('UserProfile')}
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={Crown}
                iconColor={COLORS.textSecondary}
                label="Membership"
                sub="Pro plan"
                onPress={() => navigation.navigate('Membership')}
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={Volume2}
                iconColor={COLORS.textSecondary}
                label="Trainer Voice"
                sub={selectedTrainer ? `${selectedTrainer.name} · ${selectedTrainer.specialty}` : 'Default trainer'}
                onPress={() => navigation.navigate('TrainerPicker')}
              />
            </View>
          </LinearGradient>

          {/* Preferences Section */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>PREFERENCES</Text>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <NavRow
                icon={Camera}
                iconColor={COLORS.textSecondary}
                label="Camera Settings"
                sub="Angles, grid, resolution"
                onPress={() => navigation.navigate('MainTabs', { screen: 'Record', params: { screen: 'WorkoutSettings' } })}
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={Bell}
                iconColor={COLORS.textSecondary}
                label="Notifications"
                sub="Push, email, reminders"
                onPress={() => navigation.navigate('NotificationSettings')}
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={Lock}
                iconColor={COLORS.textSecondary}
                label="Privacy"
                sub="Account & data settings"
                onPress={() => navigation.navigate('PrivacySettings')}
              />
            </View>
          </LinearGradient>

          {/* Workout Section */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>WORKOUT</Text>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <ToggleRow
                icon={Eye}
                iconColor={COLORS.textSecondary}
                label="Visual Feedback"
                sub="Real-time form correction"
                value={prefs.showFeedback}
                onToggle={(v) => updatePref('showFeedback', v)}
                infoKey="Visual Feedback"
              />
              <View style={styles.rowDivider} />
              <ToggleRow
                icon={Volume2}
                iconColor={COLORS.textSecondary}
                label="Voice Coaching"
                sub="AI coach speaks corrections"
                value={prefs.isTTSEnabled}
                onToggle={(v) => updatePref('isTTSEnabled', v)}
                infoKey="Voice Coaching"
              />
              {DEV_FEATURES_ENABLED && (
                <>
                  <View style={styles.rowDivider} />
                  <ToggleRow
                    icon={Bone}
                    iconColor={COLORS.textSecondary}
                    label="Skeleton Overlay"
                    sub="Body joints overlay"
                    value={prefs.showSkeletonOverlay}
                    onToggle={(v) => updatePref('showSkeletonOverlay', v)}
                    infoKey="Skeleton Overlay"
                  />
                </>
              )}
              <View style={styles.rowDivider} />
              <ToggleRow
                icon={Video}
                iconColor={COLORS.textSecondary}
                label="Auto Screen Recording"
                sub="Capture workouts"
                value={prefs.autoScreenRecording}
                onToggle={(v) => updatePref('autoScreenRecording', v)}
                infoKey="Auto Screen Recording"
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={Calendar}
                iconColor={COLORS.textSecondary}
                label="Training Frequency"
                sub={TRAINING_TARGET_LABELS[prefs.weeklyTrainingTarget]}
                onPress={handleTrainingTargetPress}
              />
            </View>
          </LinearGradient>

          {/* Support Section */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>SUPPORT</Text>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <NavRow
                icon={HelpCircle}
                iconColor={COLORS.textSecondary}
                label="Help Center"
                sub="Get help and support"
                onPress={() => navigation.navigate('HelpCenter')}
              />
              <View style={styles.rowDivider} />
              <NavRow
                icon={MessageSquare}
                iconColor={COLORS.textSecondary}
                label="Send Feedback"
                sub="Help us improve"
                onPress={handleSendFeedback}
              />
            </View>
          </LinearGradient>

          {/* Sign Out */}
          <TouchableOpacity
            style={styles.signOutBtn}
            activeOpacity={0.85}
            onPress={handleSignOutPress}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          {/* Back to Onboarding (dev only) */}
          {__DEV__ && (
            <TouchableOpacity
              style={styles.onboardingBtn}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Onboarding')}
            >
              <RefreshCcw size={13} color={COLORS.textTertiary} strokeWidth={1.5} />
              <Text style={styles.onboardingText}>Back to Onboarding</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.versionText}>FORMA v1.0.0</Text>
        </Animated.View>
      </ScrollView>

      {/* Info Modal */}
      <Modal
        visible={infoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoModal(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setInfoModal(null)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{infoModal ? SETTING_INFO[infoModal]?.title : ''}</Text>
              <TouchableOpacity onPress={() => setInfoModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDescription}>{infoModal ? SETTING_INFO[infoModal]?.description : ''}</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 150,
    paddingTop: 4,
  },

  /* Section Headers */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },

  /* Individual card */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
  },

  /* Grouped card (multiple rows) */
  groupEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingVertical: 12,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginLeft: 44,
  },

  /* Icon bubble — rounded square containing the row icon */
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: CARD_RADIUS_SM,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13.5,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  rowLabelCol: {
    flex: 1,
    gap: 2,
  },
  rowSubLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    lineHeight: 15,
  },

  /* Sign Out button */
  signOutBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
  },
  signOutText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.red,
    letterSpacing: 0.1,
  },

  /* Onboarding */
  onboardingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 24,
  },
  onboardingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* Version */
  versionText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 4,
  },

  /* Info Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalContent: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    ...CARD_SHADOW,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  modalDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },
});
