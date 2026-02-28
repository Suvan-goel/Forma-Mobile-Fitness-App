import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
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

const DataItem = ({
  icon: Icon,
  title,
  description,
  isFirst,
  isLast,
}: {
  icon: any;
  title: string;
  description: string;
  isFirst?: boolean;
  isLast?: boolean;
}) => (
  <View style={[styles.dataItem, isFirst && styles.dataItemFirst, isLast && styles.dataItemLast]}>
    <View style={styles.dataIconBadge}>
      <Icon size={16} color="#A78BFA" strokeWidth={1.5} />
    </View>
    <View style={styles.dataContent}>
      <Text style={styles.dataTitle}>{title}</Text>
      <Text style={styles.dataDescription}>{description}</Text>
    </View>
  </View>
);

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
  const { level: privacyLevel, isSaving: isSavingPrivacy, updateLevel } = usePrivacyLevel();

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleDeleteAccount = () => {
    showAlert(
      'Delete Account',
      'To delete your account and all associated data, please contact us at support@forma.app. We will process your request within 48 hours.',
      [{ text: 'OK' }],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={20} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Page Title */}
          <View style={styles.titleSection}>
            <Text style={styles.pageTitle}>Privacy</Text>
            <Text style={styles.pageSubtitle}>
              How we handle and protect your data
            </Text>
          </View>

          {/* Privacy Badge */}
          <View style={styles.privacyBadge}>
            <View style={styles.privacyBadgeIcon}>
              <ShieldCheck size={18} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.privacyBadgeText}>
              Your privacy is important. Pose detection runs entirely on-device — no video ever leaves your phone.
            </Text>
          </View>

          {/* Social Visibility */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <Users size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Social Visibility</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                {VISIBILITY_OPTIONS.map((opt, index) => {
                  const OptionIcon = opt.icon;
                  const isSelected = privacyLevel === opt.level;
                  const isLast = index === VISIBILITY_OPTIONS.length - 1;
                  return (
                    <View
                      key={opt.level}
                      style={[styles.visibilityItem, isLast && styles.visibilityItemLast]}
                    >
                      <View style={[
                        styles.visibilityIconBadge,
                        isSelected && styles.visibilityIconBadgeActive,
                      ]}>
                        <OptionIcon size={15} color={isSelected ? '#A78BFA' : COLORS.textTertiary} strokeWidth={1.5} />
                      </View>
                      <View style={styles.visibilityContent}>
                        <Text style={[styles.visibilityLabel, isSelected && styles.visibilityLabelActive]}>
                          {opt.label}
                        </Text>
                        <Text style={styles.visibilityDesc}>{opt.description}</Text>
                      </View>
                      <View style={[styles.radioOuter, isSelected && styles.radioOuterActive]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                      {/* Tappable overlay */}
                      <TouchableOpacity
                        style={StyleSheet.absoluteFillObject}
                        onPress={() => !isSavingPrivacy && updateLevel(opt.level)}
                        activeOpacity={0.6}
                      />
                    </View>
                  );
                })}
              </View>
            </LinearGradient>
          </View>

          {/* Data We Collect */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <Database size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Data We Collect</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <DataItem
                  icon={Eye}
                  title="Workout Data"
                  description="Reps, sets, form scores, and workout duration to track your progress."
                  isFirst
                />
                <DataItem
                  icon={Smartphone}
                  title="Pose Detection"
                  description="Pose landmarks are processed entirely on your device. No video or camera frames are ever uploaded."
                />
                <DataItem
                  icon={Database}
                  title="Profile Information"
                  description="Your name, email, and avatar to personalize your experience."
                  isLast
                />
              </View>
            </LinearGradient>
          </View>

          {/* Data Storage */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <Cloud size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Data Storage</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <Text style={styles.storageText}>
                  Your workout data is stored securely in our cloud database. Pose detection runs entirely on your device — no video or camera frames ever leave your phone.
                </Text>
                <View style={styles.storageDivider} />
                <Text style={styles.storageText}>
                  Preferences and settings are stored locally on your device and are not synced to the cloud.
                </Text>
              </View>
            </LinearGradient>
          </View>

          {/* Delete Account */}
          <View style={styles.dangerSection}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconBadge, styles.dangerIconBadge]}>
                <Trash2 size={12} color="#EF4444" strokeWidth={1.5} />
              </View>
              <Text style={[styles.sectionTitle, styles.dangerSectionTitle]}>Danger Zone</Text>
            </View>
            <TouchableOpacity
              style={styles.deleteButton}
              activeOpacity={0.7}
              onPress={handleDeleteAccount}
            >
              <View style={styles.deleteInner}>
                <View style={styles.deleteIconBadge}>
                  <Trash2 size={16} color="#EF4444" strokeWidth={1.5} />
                </View>
                <View style={styles.deleteContent}>
                  <Text style={styles.deleteText}>Delete Account</Text>
                  <Text style={styles.deleteDescription}>
                    Permanently remove your account and all data
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
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
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
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

  /* ── Scroll ─────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl + 40,
  },

  /* ── Page Title ──────────────────────────── */
  titleSection: {
    marginBottom: SPACING.xl,
  },
  pageTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  pageSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  /* ── Privacy Badge ───────────────────────── */
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.1)',
    marginBottom: SPACING.xl,
  },
  privacyBadgeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  privacyBadgeText: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },

  /* ── Section Headers ───────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  sectionIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: SPACING.lg,
    overflow: 'hidden',
  },

  /* ── Data Items ──────────────────────── */
  dataItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  dataItemFirst: {
    paddingTop: 0,
  },
  dataItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  dataIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  dataContent: {
    flex: 1,
  },
  dataTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
    marginBottom: 4,
  },
  dataDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },

  /* ── Storage ─────────────────────────── */
  storageText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },
  storageDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: SPACING.md,
  },

  /* ── Social Visibility ──────────────────── */
  visibilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  visibilityItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  visibilityIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityIconBadgeActive: {
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
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: '#A78BFA',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#A78BFA',
  },

  /* ── Delete Account ──────────────────── */
  dangerSection: {
    marginTop: SPACING.xl,
  },
  dangerIconBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  dangerSectionTitle: {
    color: 'rgba(239, 68, 68, 0.6)',
  },
  deleteButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.12)',
    backgroundColor: 'rgba(239, 68, 68, 0.03)',
    overflow: 'hidden',
  },
  deleteInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: SPACING.lg,
  },
  deleteIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
  deleteDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: 'rgba(239, 68, 68, 0.5)',
    letterSpacing: 0.2,
  },
});
