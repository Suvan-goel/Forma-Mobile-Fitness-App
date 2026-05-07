import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  Animated,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Timer, Smartphone, Info, CheckCircle } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_VERTICAL_GAP,
  CARD_SHADOW
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { useNotificationPreferences } from '../../backend/hooks/useNotificationPreferences';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

interface NotificationSettingsScreenProps {
  navigation: any;
}

export const NotificationSettingsScreen: React.FC<NotificationSettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { prefs, updatePref, isLoading } = useNotificationPreferences();

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

  const handleRestTimerToggle = (value: boolean) => {
    updatePref('restTimerEnabled', value);
  };

  const restTimerStatus = prefs.restTimerEnabled ? 'Enabled' : 'Disabled';

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="NOTIFICATIONS" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 112) },
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
                {isLoading ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Bell size={22} color={prefs.restTimerEnabled ? COLORS.primary : COLORS.textSecondary} strokeWidth={1.8} />
                )}
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.heroLabel}>Workout Alerts</Text>
                <Text style={styles.heroTitle}>{restTimerStatus}</Text>
                <Text style={styles.heroText}>
                  Forma can notify you when it is time to start your next set.
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* Alerts Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>WORKOUT ALERTS</Text>
            </View>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.toggleRow}>
                <View style={styles.iconBubble}>
                  <Timer size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.toggleContent}>
                  <Text style={styles.toggleLabel}>Rest Timer</Text>
                  <Text style={styles.toggleDesc}>
                    Get a prompt when your rest period finishes between sets.
                  </Text>
                </View>
                <Switch
                  value={prefs.restTimerEnabled}
                  onValueChange={handleRestTimerToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.055)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.restTimerEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                  disabled={isLoading}
                />
              </View>
            </View>
          </LinearGradient>

          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>DELIVERY</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.infoRow}>
                <View style={styles.iconBubble}>
                  <Smartphone size={16} color={COLORS.green} strokeWidth={1.8} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoTitle}>On-device reminders</Text>
                  <Text style={styles.infoDesc}>
                    Timer alerts are controlled locally and update instantly.
                  </Text>
                </View>
                <CheckCircle size={18} color={COLORS.green} strokeWidth={1.8} />
              </View>
              <View style={styles.rowDivider} />
              <View style={styles.infoRow}>
                <View style={styles.iconBubble}>
                  <Info size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoTitle}>During active workouts</Text>
                  <Text style={styles.infoDesc}>
                    Alerts are designed for training flow and will not add marketing notifications.
                  </Text>
                </View>
              </View>
            </View>
          </LinearGradient>

        </Animated.View>
      </ScrollView>
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
    paddingTop: 4,
  },

  /* Hero */
  heroCard: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: CARD_VERTICAL_GAP,
  },
  heroInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  heroIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 3,
  },
  heroLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: 0,
  },
  heroText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
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

  /* Cards (matches Home) */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
  },
  groupEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  iconBubble: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginLeft: 42,
  },

  /* Toggle */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
  },
  toggleContent: {
    flex: 1,
    gap: 3,
  },
  toggleLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 14.5,
    color: COLORS.text,
    letterSpacing: 0,
  },
  toggleDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
    lineHeight: 16,
  },

  /* Info */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingVertical: 12,
  },
  infoContent: {
    flex: 1,
    gap: 3,
  },
  infoTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 14.5,
    color: COLORS.text,
  },
  infoDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11.5,
    color: COLORS.textTertiary,
    lineHeight: 16,
  },

});
