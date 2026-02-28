import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Platform, Animated, Switch, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Bell,
  Lock,
  HelpCircle,
  LogOut,
  Shield,
  Mail,
  SlidersHorizontal,
  Eye,
  Volume2,
  Bone,
  UserRound,
  RefreshCcw,
  Calendar,
} from 'lucide-react-native';
import type { WeeklyTrainingTarget } from '../../backend/hooks/useWorkoutPreferences';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useAuth } from '../../backend/contexts/AuthContext';
import { useWorkoutPreferences, useUser } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';
import { useFocusEffect } from '@react-navigation/native';

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { user: authUser } = useAuth();
  const { user: profileUser, refetch: refetchUser } = useUser();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { prefs, updatePref } = useWorkoutPreferences();

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Refresh profile data when screen gains focus (e.g. after editing profile)
  useFocusEffect(
    React.useCallback(() => {
      refetchUser();
    }, [refetchUser]),
  );

  const displayName = profileUser?.displayName ?? authUser?.user_metadata?.full_name ?? 'Athlete';
  const userEmail = profileUser?.email ?? authUser?.email ?? '';
  const userInitial = (displayName[0] ?? 'A').toUpperCase();

  const SettingItem = ({
    icon: Icon,
    label,
    onPress,
    isFirst,
    isLast,
  }: {
    icon: any;
    label: string;
    onPress?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, isFirst && styles.settingItemFirst, isLast && styles.settingItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.settingLeft}>
        <View style={styles.settingIconBadge}>
          <Icon size={16} color="#A78BFA" strokeWidth={1.5} />
        </View>
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
    </TouchableOpacity>
  );

  const TRAINING_TARGET_OPTIONS: WeeklyTrainingTarget[] = ['1-2', '3-4', '5+'];
  const TRAINING_TARGET_LABELS: Record<WeeklyTrainingTarget, string> = {
    '1-2': '1–2 days / week',
    '3-4': '3–4 days / week',
    '5+': '5+ days / week',
  };

  const SelectItem = ({
    icon: Icon,
    label,
    value,
    onPress,
    isFirst,
    isLast,
  }: {
    icon: any;
    label: string;
    value: string;
    onPress: () => void;
    isFirst?: boolean;
    isLast?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, isFirst && styles.settingItemFirst, isLast && styles.settingItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.settingLeft}>
        <View style={styles.settingIconBadge}>
          <Icon size={16} color="#A78BFA" strokeWidth={1.5} />
        </View>
        <View style={styles.selectLabelColumn}>
          <Text style={styles.settingLabel}>{label}</Text>
          <Text style={styles.selectValueText}>{value}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
    </TouchableOpacity>
  );

  const handleTrainingTargetPress = () => {
    const current = prefs.weeklyTrainingTarget;
    const currentIdx = TRAINING_TARGET_OPTIONS.indexOf(current);
    const nextIdx = (currentIdx + 1) % TRAINING_TARGET_OPTIONS.length;
    updatePref('weeklyTrainingTarget', TRAINING_TARGET_OPTIONS[nextIdx]);
  };

  const ToggleItem = ({
    icon: Icon,
    label,
    value,
    onToggle,
    isFirst,
    isLast,
  }: {
    icon: any;
    label: string;
    value: boolean;
    onToggle: (v: boolean) => void;
    isFirst?: boolean;
    isLast?: boolean;
  }) => (
    <View style={[styles.settingItem, isFirst && styles.settingItemFirst, isLast && styles.settingItemLast]}>
      <View style={styles.settingLeft}>
        <View style={styles.settingIconBadge}>
          <Icon size={16} color="#A78BFA" strokeWidth={1.5} />
        </View>
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(139, 92, 246, 0.4)' }}
        thumbColor={value ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
      />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* ── HEADER ─────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>SETTINGS</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── PROFILE CARD ────────────────────────── */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.profileRow}>
                  {profileUser?.avatarUrl ? (
                    <Image source={{ uri: profileUser.avatarUrl }} style={styles.avatarImage} />
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
                    <Text style={styles.profileName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    {userEmail ? (
                      <View style={styles.emailRow}>
                        <Mail size={11} color={COLORS.textTertiary} strokeWidth={1.5} />
                        <Text style={styles.profileEmail} numberOfLines={1}>
                          {userEmail}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* ── ACCOUNT SECTION ─────────────────────── */}
          <View style={styles.sectionHeader}>
            <Shield size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>Account</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <SettingItem icon={User} label="Profile" onPress={() => navigation.navigate('ProfileSettings')} isFirst />
                <SettingItem icon={Bell} label="Notifications" onPress={() => navigation.navigate('NotificationSettings')} />
                <SettingItem icon={Lock} label="Privacy" onPress={() => navigation.navigate('PrivacySettings')} isLast />
              </View>
            </LinearGradient>
          </View>

          {/* ── WORKOUT PREFERENCES SECTION ──────────── */}
          <View style={styles.sectionHeader}>
            <SlidersHorizontal size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>Workout</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <ToggleItem
                  icon={Eye}
                  label="Visual Feedback"
                  value={prefs.showFeedback}
                  onToggle={(v) => updatePref('showFeedback', v)}
                  isFirst
                />
                <ToggleItem
                  icon={Volume2}
                  label="Voice Coaching (TTS)"
                  value={prefs.isTTSEnabled}
                  onToggle={(v) => updatePref('isTTSEnabled', v)}
                />
                <ToggleItem
                  icon={Bone}
                  label="Skeleton Overlay"
                  value={prefs.showSkeletonOverlay}
                  onToggle={(v) => updatePref('showSkeletonOverlay', v)}
                />
                <SelectItem
                  icon={Calendar}
                  label="Training Frequency"
                  value={TRAINING_TARGET_LABELS[prefs.weeklyTrainingTarget]}
                  onPress={handleTrainingTargetPress}
                  isLast
                />
              </View>
            </LinearGradient>
          </View>

          {/* ── YOUR TRAINER SECTION ──────────────── */}
          <View style={styles.sectionHeader}>
            <UserRound size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>Your Trainer</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <SettingItem
                  icon={UserRound}
                  label="Trainer"
                  onPress={() => navigation.navigate('TrainerPicker')}
                  isFirst
                  isLast
                />
              </View>
            </LinearGradient>
          </View>

          {/* ── SUPPORT SECTION ─────────────────────── */}
          <View style={styles.sectionHeader}>
            <HelpCircle size={14} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionTitle}>Support</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <SettingItem icon={HelpCircle} label="Help Center" onPress={() => navigation.navigate('HelpCenter')} isFirst isLast />
              </View>
            </LinearGradient>
          </View>

          {/* ── BACK TO ONBOARDING ──────────────────── */}
          <TouchableOpacity
            style={styles.devOnboardingOuter}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Onboarding')}
          >
            <View style={styles.devOnboardingInner}>
              <View style={styles.devOnboardingIconBadge}>
                <RefreshCcw size={14} color="#F59E0B" strokeWidth={1.5} />
              </View>
              <Text style={styles.devOnboardingText}>Back to Onboarding</Text>
            </View>
          </TouchableOpacity>

          {/* ── VERSION ─────────────────────────────── */}
          <Text style={styles.versionText}>FORMA v1.0.0</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: 2,
  },
  placeholder: {
    width: 40,
  },

  /* ── Scroll ─────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl,
  },

  /* ── Profile Card ──────────────────────── */
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarGradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#000000',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  profileEmail: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
    flex: 1,
  },

  /* ── Section Headers ───────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm + 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  /* ── Shared Gradient Card ────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    marginBottom: 2,
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
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
    overflow: 'hidden',
  },

  /* ── Setting Items ─────────────────────── */
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingItemFirst: {
    paddingTop: 0,
  },
  settingItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
  },

  /* ── Select Item ───────────────────────── */
  selectLabelColumn: {
    flexDirection: 'column',
    gap: 2,
  },
  selectValueText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },

  /* ── Dev: Back to Onboarding ───────────── */
  devOnboardingOuter: {
    marginTop: SPACING.xxl,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    backgroundColor: 'rgba(245, 158, 11, 0.04)',
    overflow: 'hidden',
  },
  devOnboardingInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  devOnboardingIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  devOnboardingText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: '#F59E0B',
    letterSpacing: 0.3,
  },
  devBadge: {
    fontFamily: FONTS.mono.regular,
    fontSize: 9,
    color: 'rgba(245, 158, 11, 0.5)',
    letterSpacing: 1.5,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },

  /* ── Version ───────────────────────────── */
  versionText: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: SPACING.xl,
  },
});
