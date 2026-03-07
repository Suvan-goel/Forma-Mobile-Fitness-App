import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Animated, Switch, Image, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  Bell,
  Lock,
  HelpCircle,
  Shield,
  Eye,
  Volume2,
  Bone,
  UserRound,
  RefreshCcw,
  Calendar,
  SlidersHorizontal,
  Crown,
  Video,
  Info,
  X,
} from 'lucide-react-native';
import type { WeeklyTrainingTarget } from '../../backend/hooks/useWorkoutPreferences';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useAuth } from '../../backend/contexts/AuthContext';
import { useWorkoutPreferences, useUser } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';
import { useFocusEffect } from '@react-navigation/native';

const formatHeaderDate = (): string => {
  const d = new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()} \u2022 TODAY`;
};

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { user: authUser } = useAuth();
  const { user: profileUser, refetch: refetchUser } = useUser();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { prefs, updatePref } = useWorkoutPreferences();
  const [infoModal, setInfoModal] = useState<string | null>(null);

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

  const displayName = profileUser?.displayName ?? authUser?.user_metadata?.full_name ?? 'Athlete';
  const userInitial = (displayName[0] ?? 'A').toUpperCase();

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

  /* Reusable single-row card */
  const RowCard = ({ icon: Icon, iconColor, label, onPress, right }: {
    icon: any; iconColor: string; label: string;
    onPress?: () => void; right?: React.ReactNode;
  }) => (
    <TouchableOpacity activeOpacity={onPress ? 0.7 : 1} onPress={onPress} disabled={!onPress}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          <View style={styles.row}>
            <Icon size={14} color={iconColor} strokeWidth={1.5} />
            <Text style={styles.rowLabel}>{label}</Text>
            {right ?? <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />}
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  /* Reusable single-row card with sub-label */
  const RowCardWithSub = ({ icon: Icon, iconColor, label, sub, onPress }: {
    icon: any; iconColor: string; label: string; sub: string; onPress: () => void;
  }) => (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          <View style={styles.row}>
            <Icon size={14} color={iconColor} strokeWidth={1.5} />
            <View style={styles.rowLabelCol}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowSubLabel}>{sub}</Text>
            </View>
            <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  /* Toggle card */
  const ToggleCard = ({ icon: Icon, iconColor, label, value, onToggle }: {
    icon: any; iconColor: string; label: string;
    value: boolean; onToggle: (v: boolean) => void;
  }) => (
    <LinearGradient
      colors={[...CARD_GRADIENT_COLORS]}
      start={CARD_GRADIENT_START}
      end={CARD_GRADIENT_END}
      style={styles.cardGradient}
    >
      <View style={styles.cardEdge}>
        <View style={styles.row}>
          <Icon size={14} color={iconColor} strokeWidth={1.5} />
          <Text style={styles.rowLabel}>{label}</Text>
          <Switch
            value={value}
            onValueChange={onToggle}
            trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
            thumbColor={value ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
          />
        </View>
      </View>
    </LinearGradient>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })} activeOpacity={0.7} style={styles.backBtn}>
            <ChevronLeft size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/forma_purple_logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerName}>SETTINGS</Text>
            <Text style={styles.headerSubtitle}>{formatHeaderDate()}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile')}
          activeOpacity={0.7}
          style={styles.profileBtn}
        >
          {profileUser?.avatarUrl ? (
            <Image source={{ uri: profileUser.avatarUrl }} style={styles.profileImage} />
          ) : profileUser ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <Text style={styles.profileInitial}>{userInitial}</Text>
            </LinearGradient>
          ) : (
            <View style={styles.profilePlaceholder} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Profile Card */}
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('UserProfile')}>
            <LinearGradient
              colors={SCREEN_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileCard}
            >
              <View style={styles.profileEdge}>
                <View style={styles.profileRow}>
                  {profileUser?.avatarUrl ? (
                    <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatar} />
                  ) : profileUser ? (
                    <LinearGradient
                      colors={['#8B5CF6', '#7C3AED']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.avatarGradient}
                    >
                      <Text style={styles.avatarText}>{userInitial}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.avatarPlaceholder} />
                  )}
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
                    <Text style={styles.profileSub} numberOfLines={1}>View your public profile</Text>
                  </View>
                  <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Account Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Shield size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ACCOUNT</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <TouchableOpacity style={styles.groupRow} onPress={() => navigation.navigate('NotificationSettings')} activeOpacity={0.7}>
                <Bell size={14} color={COLORS.yellow} strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Notifications</Text>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </TouchableOpacity>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.groupRow} onPress={() => navigation.navigate('PrivacySettings')} activeOpacity={0.7}>
                <Lock size={14} color="#34D399" strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Privacy</Text>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* Workout Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <SlidersHorizontal size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>WORKOUT</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.groupRow}>
                <Eye size={14} color="#A78BFA" strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Visual Feedback</Text>
                <TouchableOpacity onPress={() => setInfoModal('Visual Feedback')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={prefs.showFeedback}
                  onValueChange={(v) => updatePref('showFeedback', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.showFeedback ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <Volume2 size={14} color="#A78BFA" strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Voice Coaching</Text>
                <TouchableOpacity onPress={() => setInfoModal('Voice Coaching')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={prefs.isTTSEnabled}
                  onValueChange={(v) => updatePref('isTTSEnabled', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.isTTSEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <Bone size={14} color={COLORS.yellow} strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Skeleton Overlay</Text>
                <TouchableOpacity onPress={() => setInfoModal('Skeleton Overlay')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={prefs.showSkeletonOverlay}
                  onValueChange={(v) => updatePref('showSkeletonOverlay', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.showSkeletonOverlay ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <Video size={14} color={COLORS.yellow} strokeWidth={1.5} />
                <Text style={styles.rowLabel}>Auto Screen Recording</Text>
                <TouchableOpacity onPress={() => setInfoModal('Auto Screen Recording')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <Switch
                  value={prefs.autoScreenRecording}
                  onValueChange={(v) => updatePref('autoScreenRecording', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.autoScreenRecording ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.groupRow} onPress={handleTrainingTargetPress} activeOpacity={0.7}>
                <Calendar size={14} color="#34D399" strokeWidth={1.5} />
                <View style={styles.rowLabelCol}>
                  <Text style={styles.rowLabel}>Training Frequency</Text>
                  <Text style={styles.rowSubLabel}>{TRAINING_TARGET_LABELS[prefs.weeklyTrainingTarget]}</Text>
                </View>
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); setInfoModal('Training Frequency'); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Info size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
                </TouchableOpacity>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {/* Trainer Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <UserRound size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>YOUR TRAINER</Text>
            </View>
          </View>
          <View style={styles.cardStack}>
            <RowCard icon={UserRound} iconColor="#A78BFA" label="Choose Trainer" onPress={() => navigation.navigate('TrainerPicker')} />
          </View>

          {/* Your Plan Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Crown size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>YOUR PLAN</Text>
            </View>
          </View>
          <View style={styles.cardStack}>
            <RowCard icon={Crown} iconColor="#F5A623" label="Membership" onPress={() => navigation.navigate('Membership')} />
          </View>

          {/* Support Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <HelpCircle size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>SUPPORT</Text>
            </View>
          </View>
          <View style={styles.cardStack}>
            <RowCard icon={HelpCircle} iconColor="#34D399" label="Help Center" onPress={() => navigation.navigate('HelpCenter')} />
          </View>

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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backBtn: {
    width: 24,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  logoWrap: {
    width: 50,
    height: 55,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 55,
    height: 55,
  },
  headerTextWrap: {
    gap: 1,
  },
  headerName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  profileGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
  },
  profileInitial: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 160,
  },

  /* Profile Card */
  profileCard: {
    borderRadius: 22,
    marginTop: 18,
    marginBottom: 8,
  },
  profileEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 18,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#27272A',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  profileSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  /* Section Headers */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 12,
    color: COLORS.text,
    letterSpacing: 2,
  },

  /* Card stack — gap between individual cards */
  cardStack: {
    gap: 8,
  },

  /* Individual card */
  cardGradient: {
    borderRadius: 18,
  },
  cardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },

  /* Grouped card (multiple rows) */
  groupEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },

  /* Row inside card */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  rowLabelCol: {
    flex: 1,
    gap: 2,
  },
  rowSubLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
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
    backgroundColor: '#1A1625',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    padding: 22,
    width: '100%',
    maxWidth: 340,
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
