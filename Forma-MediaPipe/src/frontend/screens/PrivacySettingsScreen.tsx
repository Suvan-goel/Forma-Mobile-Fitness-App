import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CheckCircle,
  ChevronLeft,
  Cloud,
  Database,
  Eye,
  Globe,
  Lock,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react-native';
import {
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_END,
  CARD_GRADIENT_START,
  CARD_RADIUS,
  CARD_VERTICAL_GAP,
  COLORS,
  FONTS,
  SPACING,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { useAlert } from '../contexts/AlertContext';
import { usePrivacyLevel, type PrivacyLevel } from '../../backend/hooks/usePrivacyLevel';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

interface PrivacySettingsScreenProps {
  navigation: any;
}

const VISIBILITY_OPTIONS: {
  level: PrivacyLevel;
  icon: typeof Globe;
  label: string;
  description: string;
}[] = [
  {
    level: 'public',
    icon: Globe,
    label: 'Public',
    description: 'Anyone on Forma can see your public stats and leaderboard position.',
  },
  {
    level: 'friends',
    icon: Users,
    label: 'Friends Only',
    description: 'Only friends can see your activity, profile stats, and ranking context.',
  },
  {
    level: 'private',
    icon: Lock,
    label: 'Private',
    description: 'Hide your profile from social discovery, activity feeds, and leaderboards.',
  },
];

const DATA_ITEMS = [
  {
    icon: Eye,
    color: COLORS.primary,
    title: 'Workout Data',
    description: 'Reps, sets, form scores, duration, and workout history are stored to track progress.',
  },
  {
    icon: Smartphone,
    color: COLORS.green,
    title: 'Pose Detection',
    description: 'Pose landmarks are processed on your device. Camera frames are not uploaded.',
  },
  {
    icon: Database,
    color: '#60A5FA',
    title: 'Profile Information',
    description: 'Name, email, avatar, and preferences personalize the app experience.',
  },
];

export const PrivacySettingsScreen: React.FC<PrivacySettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;
  const {
    level: privacyLevel,
    isLoading: isLoadingPrivacy,
    isSaving: isSavingPrivacy,
    error: privacyError,
    updateLevel,
  } = usePrivacyLevel();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleDeleteAccount = () => {
    showAlert(
      'Delete Account',
      'To delete your account and all associated data, please contact us at support@forma.app. We will process your request within 48 hours.',
      [{ text: 'OK' }],
    );
  };

  const selectedOption = VISIBILITY_OPTIONS.find(option => option.level === privacyLevel) ?? VISIBILITY_OPTIONS[1];
  const SelectedIcon = selectedOption.icon;

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader
        title="PRIVACY"
        onBack={() => navigation.goBack()}
        rightSlot={isSavingPrivacy ? (
          <ActivityIndicator color={COLORS.primary} size="small" />
        ) : (
          <ShieldCheck size={22} color={COLORS.textSecondary} strokeWidth={1.7} />
        )}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 96) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.heroCard}
          >
            <View style={styles.heroInner}>
              <View style={styles.heroIcon}>
                <SelectedIcon size={24} color={COLORS.primary} strokeWidth={1.8} />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>Current Visibility</Text>
                <Text style={styles.heroTitle}>{selectedOption.label}</Text>
                <Text style={styles.heroDescription}>
                  Pose detection stays on-device. Your camera frames are never uploaded.
                </Text>
              </View>
            </View>
          </LinearGradient>

          <SectionTitle icon={<Users size={14} color={COLORS.primary} strokeWidth={1.7} />} title="Social Visibility" />
          <View style={styles.optionStack}>
            {VISIBILITY_OPTIONS.map(option => {
              const Icon = option.icon;
              const isSelected = privacyLevel === option.level;
              return (
                <TouchableOpacity
                  key={option.level}
                  activeOpacity={0.78}
                  disabled={isLoadingPrivacy || isSavingPrivacy}
                  onPress={() => updateLevel(option.level)}
                >
                  <LinearGradient
                    colors={[...CARD_GRADIENT_COLORS]}
                    start={CARD_GRADIENT_START}
                    end={CARD_GRADIENT_END}
                    style={styles.optionCard}
                  >
                    <View style={[styles.optionInner, isSelected && styles.optionInnerSelected]}>
                      <View style={styles.optionIcon}>
                        <Icon size={18} color={isSelected ? COLORS.primary : COLORS.textSecondary} strokeWidth={1.7} />
                      </View>
                      <View style={styles.optionCopy}>
                        <Text style={[styles.optionTitle, isSelected && styles.optionTitleSelected]}>
                          {option.label}
                        </Text>
                        <Text style={styles.optionDescription}>{option.description}</Text>
                      </View>
                      <View style={[styles.radio, isSelected && styles.radioSelected]}>
                        {isSelected && <CheckCircle size={15} color="#FFFFFF" strokeWidth={2.7} />}
                      </View>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>

          {privacyError ? (
            <Text style={styles.errorText} selectable>{privacyError}</Text>
          ) : null}

          <SectionTitle icon={<Database size={14} color={COLORS.primary} strokeWidth={1.7} />} title="Data We Use" />
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.infoCard}
          >
            <View style={styles.infoInner}>
              {DATA_ITEMS.map((item, index) => {
                const Icon = item.icon;
                return (
                  <View key={item.title}>
                    <View style={styles.infoRow}>
                      <View style={styles.infoIcon}>
                        <Icon size={16} color={item.color} strokeWidth={1.7} />
                      </View>
                      <View style={styles.infoCopy}>
                        <Text style={styles.infoTitle}>{item.title}</Text>
                        <Text style={styles.infoDescription}>{item.description}</Text>
                      </View>
                    </View>
                    {index < DATA_ITEMS.length - 1 && <View style={styles.divider} />}
                  </View>
                );
              })}
            </View>
          </LinearGradient>

          <SectionTitle icon={<Cloud size={14} color={COLORS.primary} strokeWidth={1.7} />} title="Storage" />
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.infoCard}
          >
            <View style={styles.storageInner}>
              <Text style={styles.storageText}>
                Workout data is stored securely in the cloud so your progress and badges remain available across sessions.
              </Text>
              <View style={styles.divider} />
              <Text style={styles.storageText}>
                Device preferences are stored locally. Pose analysis runs on your phone and camera frames do not leave your device.
              </Text>
            </View>
          </LinearGradient>

          <SectionTitle icon={<Trash2 size={14} color={COLORS.red} strokeWidth={1.7} />} title="Account" danger />
          <TouchableOpacity activeOpacity={0.78} onPress={handleDeleteAccount}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.deleteCard}
            >
              <View style={styles.deleteIcon}>
                <Trash2 size={18} color={COLORS.red} strokeWidth={1.8} />
              </View>
              <View style={styles.deleteCopy}>
                <Text style={styles.deleteTitle}>Delete Account</Text>
                <Text style={styles.deleteDescription}>Request permanent removal of your account and stored data.</Text>
              </View>
              <ChevronLeft size={16} color="rgba(240,82,82,0.45)" strokeWidth={1.7} style={styles.deleteChevron} />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
};

const SectionTitle = ({
  icon,
  title,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  danger?: boolean;
}) => (
  <View style={styles.sectionHeader}>
    {icon}
    <Text style={[styles.sectionTitle, danger && styles.sectionTitleDanger]}>{title}</Text>
  </View>
);

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
    paddingTop: 8,
  },
  heroCard: {
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
  },
  heroInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  heroIcon: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  heroEyebrow: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
  },
  heroDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 16,
    color: COLORS.text,
  },
  sectionTitleDanger: {
    color: COLORS.red,
  },
  optionStack: {
    gap: CARD_VERTICAL_GAP,
    marginBottom: CARD_VERTICAL_GAP,
  },
  optionCard: {
    borderRadius: CARD_RADIUS,
  },
  optionInner: {
    minHeight: 84,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  optionInnerSelected: {
    borderColor: 'rgba(122,85,255,0.34)',
  },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  optionTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  optionTitleSelected: {
    color: COLORS.text,
  },
  optionDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  radioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.red,
    marginBottom: 12,
  },
  infoCard: {
    borderRadius: CARD_RADIUS,
    marginBottom: CARD_VERTICAL_GAP,
  },
  infoInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  infoIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCopy: {
    flex: 1,
    gap: 3,
  },
  infoTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
  },
  infoDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  storageInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 14,
    gap: 12,
  },
  storageText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.textSecondary,
  },
  deleteCard: {
    minHeight: 74,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  deleteIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCopy: {
    flex: 1,
    gap: 3,
  },
  deleteTitle: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: COLORS.red,
  },
  deleteDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(240,82,82,0.62)',
  },
  deleteChevron: {
    transform: [{ rotate: '180deg' }],
  },
});
