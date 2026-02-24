import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
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
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';

interface PrivacySettingsScreenProps {
  navigation: any;
}

const DataItem = ({
  icon: Icon,
  title,
  description,
  isLast,
}: {
  icon: any;
  title: string;
  description: string;
  isLast?: boolean;
}) => (
  <View style={[styles.dataItem, isLast && styles.dataItemLast]}>
    <View style={styles.dataIconBadge}>
      <Icon size={16} color="#A78BFA" strokeWidth={1.5} />
    </View>
    <View style={styles.dataContent}>
      <Text style={styles.dataTitle}>{title}</Text>
      <Text style={styles.dataDescription}>{description}</Text>
    </View>
  </View>
);

export const PrivacySettingsScreen: React.FC<PrivacySettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleDeleteAccount = () => {
    Alert.alert(
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
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>PRIVACY</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Data We Collect */}
          <View style={styles.sectionHeader}>
            <Database size={14} color={COLORS.accent} strokeWidth={1.5} />
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
            <Cloud size={14} color={COLORS.accent} strokeWidth={1.5} />
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
          <TouchableOpacity
            style={styles.deleteButton}
            activeOpacity={0.7}
            onPress={handleDeleteAccount}
          >
            <View style={styles.deleteInner}>
              <View style={styles.deleteIconBadge}>
                <Trash2 size={16} color="#EF4444" strokeWidth={1.5} />
              </View>
              <Text style={styles.deleteText}>Delete Account</Text>
            </View>
          </TouchableOpacity>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
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
  dataItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  dataItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  dataIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
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
  storageText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  storageDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: SPACING.md,
  },
  deleteButton: {
    marginTop: SPACING.xxl,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
    backgroundColor: 'rgba(239, 68, 68, 0.04)',
    overflow: 'hidden',
  },
  deleteInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  deleteIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#EF4444',
    letterSpacing: 0.5,
  },
});
