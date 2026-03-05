import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Database,
  Smartphone,
  Cloud,
  Trash2,
  Eye,
  ShieldCheck,
  Users,
  Globe,
  Lock,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useAlert } from '../contexts/AlertContext';
import { usePrivacyLevel, PrivacyLevel } from '../../backend/hooks';

interface PrivacySettingsScreenProps {
  navigation: any;
}

const VISIBILITY_OPTIONS: { level: PrivacyLevel; icon: any; label: string; description: string }[] = [
  {
    level: 'public',
    icon: Globe,
    label: 'Public',
    description: 'Anyone on Forma can see your stats and leaderboard position',
  },
  {
    level: 'friends',
    icon: Users,
    label: 'Friends Only',
    description: 'Only friends see your activity and where you rank',
  },
  {
    level: 'private',
    icon: Lock,
    label: 'Private',
    description: 'Hidden from all social features and leaderboards',
  },
];

export const PrivacySettingsScreen: React.FC<PrivacySettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { level: privacyLevel, isSaving: isSavingPrivacy, updateLevel } = usePrivacyLevel();

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

  const handleDeleteAccount = () => {
    showAlert(
      'Delete Account',
      'To delete your account and all associated data, please contact us at support@forma.app. We will process your request within 48 hours.',
      [{ text: 'OK' }],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Privacy Banner */}
          <View style={styles.banner}>
            <ShieldCheck size={16} color={COLORS.textSecondary} strokeWidth={1.5} />
            <Text style={styles.bannerText}>
              Your privacy is important. Pose detection runs entirely on-device — no video ever leaves your phone.
            </Text>
          </View>

          {/* Social Visibility */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Users size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>SOCIAL VISIBILITY</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              {VISIBILITY_OPTIONS.map((opt, index) => {
                const OptionIcon = opt.icon;
                const isSelected = privacyLevel === opt.level;
                const isLast = index === VISIBILITY_OPTIONS.length - 1;
                return (
                  <View key={opt.level}>
                    <TouchableOpacity
                      style={styles.visibilityRow}
                      onPress={() => !isSavingPrivacy && updateLevel(opt.level)}
                      activeOpacity={0.6}
                    >
                      <View style={[styles.visibilityIcon, isSelected && styles.visibilityIconActive]}>
                        <OptionIcon size={15} color={isSelected ? '#A78BFA' : COLORS.textTertiary} strokeWidth={1.5} />
                      </View>
                      <View style={styles.visibilityContent}>
                        <Text style={[styles.visibilityLabel, isSelected && styles.visibilityLabelActive]}>
                          {opt.label}
                        </Text>
                        <Text style={styles.visibilityDesc}>{opt.description}</Text>
                      </View>
                      <View style={[styles.radio, isSelected && styles.radioActive]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </TouchableOpacity>
                    {!isLast && <View style={styles.divider} />}
                  </View>
                );
              })}
            </View>
          </LinearGradient>

          {/* Data We Collect */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Database size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DATA WE COLLECT</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <View style={styles.dataRow}>
                <Eye size={14} color={COLORS.textSecondary} strokeWidth={1.5} />
                <View style={styles.dataContent}>
                  <Text style={styles.dataTitle}>Workout Data</Text>
                  <Text style={styles.dataDesc}>Reps, sets, form scores, and workout duration to track your progress.</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.dataRow}>
                <Smartphone size={14} color={COLORS.textSecondary} strokeWidth={1.5} />
                <View style={styles.dataContent}>
                  <Text style={styles.dataTitle}>Pose Detection</Text>
                  <Text style={styles.dataDesc}>Pose landmarks are processed entirely on your device. No video or camera frames are ever uploaded.</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.dataRow}>
                <Database size={14} color={COLORS.textSecondary} strokeWidth={1.5} />
                <View style={styles.dataContent}>
                  <Text style={styles.dataTitle}>Profile Information</Text>
                  <Text style={styles.dataDesc}>Your name, email, and avatar to personalize your experience.</Text>
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* Data Storage */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Cloud size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DATA STORAGE</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <Text style={styles.storageText}>
                Your workout data is stored securely in our cloud database. Pose detection runs entirely on your device — no video or camera frames ever leave your phone.
              </Text>
              <View style={styles.divider} />
              <Text style={styles.storageText}>
                Preferences and settings are stored locally on your device and are not synced to the cloud.
              </Text>
            </View>
          </LinearGradient>

          {/* Danger Zone */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Trash2 size={13} color="#EF4444" strokeWidth={1.5} />
              <Text style={[styles.sectionLabel, { color: 'rgba(239, 68, 68, 0.6)' }]}>DANGER ZONE</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteBtn}
            activeOpacity={0.7}
            onPress={handleDeleteAccount}
          >
            <View style={styles.deleteInner}>
              <Trash2 size={16} color="#EF4444" strokeWidth={1.5} />
              <View style={styles.deleteContent}>
                <Text style={styles.deleteText}>Delete Account</Text>
                <Text style={styles.deleteDesc}>Permanently remove your account and all data</Text>
              </View>
            </View>
          </TouchableOpacity>
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

  /* Banner */
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: SPACING.md,
    borderRadius: 16,
    backgroundColor: 'rgba(52, 211, 153, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.10)',
    marginTop: 18,
    marginBottom: 8,
  },
  bannerText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
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

  /* Cards (matches Home) */
  cardGradient: {
    borderRadius: 18,
  },
  cardEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 14,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginVertical: 8,
  },

  /* Visibility */
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  visibilityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityIconActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  visibilityContent: {
    flex: 1,
  },
  visibilityLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    letterSpacing: 0.1,
    marginBottom: 3,
  },
  visibilityLabelActive: {
    color: COLORS.text,
  },
  visibilityDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: '#A78BFA',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#A78BFA',
  },

  /* Data Items */
  dataRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 6,
  },
  dataContent: {
    flex: 1,
  },
  dataTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
    marginBottom: 3,
  },
  dataDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },

  /* Storage */
  storageText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },

  /* Delete */
  deleteBtn: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.12)',
    backgroundColor: 'rgba(239, 68, 68, 0.03)',
  },
  deleteInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  deleteContent: {
    flex: 1,
  },
  deleteText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#EF4444',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  deleteDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(239, 68, 68, 0.5)',
  },
});
