import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Animated, Switch, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  User,
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
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { prefs, updatePref } = useWorkoutPreferences();

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
  const userEmail = profileUser?.email ?? authUser?.email ?? '';
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
  const RowCard = ({ icon: Icon, iconBg, iconColor, label, onPress, right }: {
    icon: any; iconBg: string; iconColor: string; label: string;
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
            <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
              <Icon size={14} color={iconColor} strokeWidth={1.5} />
            </View>
            <Text style={styles.rowLabel}>{label}</Text>
            {right ?? <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />}
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  /* Reusable single-row card with sub-label */
  const RowCardWithSub = ({ icon: Icon, iconBg, iconColor, label, sub, onPress }: {
    icon: any; iconBg: string; iconColor: string; label: string; sub: string; onPress: () => void;
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
            <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
              <Icon size={14} color={iconColor} strokeWidth={1.5} />
            </View>
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
  const ToggleCard = ({ icon: Icon, iconBg, iconColor, label, value, onToggle }: {
    icon: any; iconBg: string; iconColor: string; label: string;
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
          <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
            <Icon size={14} color={iconColor} strokeWidth={1.5} />
          </View>
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
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
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
              colors={['#1E1A2E', '#151020', '#0C0A14']}
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
                    {profileUser?.bio ? (
                      <Text style={styles.profileSub} numberOfLines={1}>{profileUser.bio}</Text>
                    ) : userEmail ? (
                      <Text style={styles.profileSub} numberOfLines={1}>{userEmail}</Text>
                    ) : null}
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
              <TouchableOpacity style={styles.groupRow} onPress={() => navigation.navigate('ProfileSettings')} activeOpacity={0.7}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                  <User size={14} color="#A78BFA" strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Profile</Text>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </TouchableOpacity>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.groupRow} onPress={() => navigation.navigate('NotificationSettings')} activeOpacity={0.7}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                  <Bell size={14} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Notifications</Text>
                <ChevronRight size={16} color={COLORS.textTertiary} strokeWidth={1.5} />
              </TouchableOpacity>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.groupRow} onPress={() => navigation.navigate('PrivacySettings')} activeOpacity={0.7}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(52, 211, 153, 0.10)' }]}>
                  <Lock size={14} color="#34D399" strokeWidth={1.5} />
                </View>
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
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                  <Eye size={14} color="#A78BFA" strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Visual Feedback</Text>
                <Switch
                  value={prefs.showFeedback}
                  onValueChange={(v) => updatePref('showFeedback', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.showFeedback ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(96, 165, 250, 0.10)' }]}>
                  <Volume2 size={14} color="#60A5FA" strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Voice Coaching</Text>
                <Switch
                  value={prefs.isTTSEnabled}
                  onValueChange={(v) => updatePref('isTTSEnabled', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.isTTSEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.groupRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                  <Bone size={14} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
                <Text style={styles.rowLabel}>Skeleton Overlay</Text>
                <Switch
                  value={prefs.showSkeletonOverlay}
                  onValueChange={(v) => updatePref('showSkeletonOverlay', v)}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.showSkeletonOverlay ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                />
              </View>
              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.groupRow} onPress={handleTrainingTargetPress} activeOpacity={0.7}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(52, 211, 153, 0.10)' }]}>
                  <Calendar size={14} color="#34D399" strokeWidth={1.5} />
                </View>
                <View style={styles.rowLabelCol}>
                  <Text style={styles.rowLabel}>Training Frequency</Text>
                  <Text style={styles.rowSubLabel}>{TRAINING_TARGET_LABELS[prefs.weeklyTrainingTarget]}</Text>
                </View>
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
            <RowCard icon={UserRound} iconBg="rgba(244, 114, 182, 0.10)" iconColor="#F472B6" label="Choose Trainer" onPress={() => navigation.navigate('TrainerPicker')} />
          </View>

          {/* Support Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <HelpCircle size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>SUPPORT</Text>
            </View>
          </View>
          <View style={styles.cardStack}>
            <RowCard icon={HelpCircle} iconBg="rgba(96, 165, 250, 0.10)" iconColor="#60A5FA" label="Help Center" onPress={() => navigation.navigate('HelpCenter')} />
          </View>

          {/* Back to Onboarding */}
          <TouchableOpacity
            style={styles.onboardingBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Onboarding')}
          >
            <RefreshCcw size={13} color={COLORS.textTertiary} strokeWidth={1.5} />
            <Text style={styles.onboardingText}>Back to Onboarding</Text>
          </TouchableOpacity>

          <Text style={styles.versionText}>FORMA v1.0.0</Text>
        </Animated.View>
      </ScrollView>
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
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  headerSpacer: {
    width: 40,
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
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
});
