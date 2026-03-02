import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bell, Timer } from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useNotificationPreferences } from '../../backend/hooks';

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
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Control when Forma sends you notifications during your workout.
          </Text>

          {/* Alerts Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Bell size={13} color={COLORS.yellow} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ALERTS</Text>
            </View>
          </View>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <View style={styles.toggleRow}>
                <View style={[styles.iconWrap, { backgroundColor: 'rgba(245, 166, 35, 0.10)' }]}>
                  <Timer size={14} color={COLORS.yellow} strokeWidth={1.5} />
                </View>
                <View style={styles.toggleContent}>
                  <Text style={styles.toggleLabel}>Rest Timer</Text>
                  <Text style={styles.toggleDesc}>
                    Get notified when your rest period finishes between sets
                  </Text>
                </View>
                <Switch
                  value={prefs.restTimerEnabled}
                  onValueChange={handleRestTimerToggle}
                  trackColor={{ false: 'rgba(255, 255, 255, 0.08)', true: 'rgba(139, 92, 246, 0.4)' }}
                  thumbColor={prefs.restTimerEnabled ? COLORS.primary : 'rgba(255, 255, 255, 0.3)'}
                  disabled={isLoading}
                />
              </View>
            </View>
          </LinearGradient>

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

  /* Subtitle */
  subtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 18,
    marginBottom: 8,
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

  /* Toggle */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleContent: {
    flex: 1,
  },
  toggleLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
    marginBottom: 3,
  },
  toggleDesc: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },

});
