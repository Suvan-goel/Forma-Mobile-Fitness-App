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
  Crown,
  Check,
  Lock,
  Sparkles,
  Star,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  SCREEN_GRADIENT_COLORS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';
import { useSubscription } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';

interface MembershipScreenProps {
  navigation: any;
}

export const MembershipScreen: React.FC<MembershipScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { subscription } = useSubscription();

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

  const isPremium = subscription?.plan === 'premium';

  const handleUpgrade = () => {
    showAlert(
      'Coming Soon',
      'Premium subscriptions are not yet available. Stay tuned for updates!',
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
        <Text style={styles.headerTitle}>Membership</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Current Plan Card */}
          <LinearGradient
            colors={isPremium
              ? ['#2D1B69', '#1A1035', '#0E0A1A'] as const
              : SCREEN_GRADIENT_COLORS
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.planCard}
          >
            <View style={[styles.planCardEdge, isPremium && styles.planCardEdgePremium]}>
              <View style={styles.planBadgeRow}>
                {isPremium ? (
                  <Crown size={20} color="#F5A623" strokeWidth={1.5} />
                ) : (
                  <Star size={20} color="#A78BFA" strokeWidth={1.5} />
                )}
                <View style={styles.planInfo}>
                  <Text style={styles.planBadgeLabel}>CURRENT PLAN</Text>
                  <Text style={styles.planName}>
                    {subscription?.planLabel ?? 'Free'}
                  </Text>
                </View>
              </View>
              {!isPremium && (
                <Text style={styles.planHint}>
                  Unlock all exercises, voice coaching, and advanced analytics
                </Text>
              )}
              {isPremium && (
                <Text style={styles.planHint}>
                  You have access to all Forma features
                </Text>
              )}
            </View>
          </LinearGradient>

          {/* Feature Comparison Section */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Sparkles size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>FEATURES</Text>
            </View>
          </View>

          {/* Column Headers */}
          <View style={styles.columnHeaders}>
            <Text style={styles.featureHeaderLabel}>Feature</Text>
            <Text style={styles.planHeaderLabel}>Free</Text>
            <Text style={styles.planHeaderLabel}>Pro</Text>
          </View>

          {/* Feature Rows */}
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              {(subscription?.features ?? []).map((feature, index) => {
                const isLast = index === (subscription?.features?.length ?? 0) - 1;
                return (
                  <View key={feature.name}>
                    <View style={styles.featureRow}>
                      <Text style={styles.featureName}>{feature.name}</Text>
                      <View style={styles.featureCheck}>
                        {feature.freeIncluded ? (
                          <Check size={14} color="#34E0A6" strokeWidth={2} />
                        ) : (
                          <Lock size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
                        )}
                      </View>
                      <View style={styles.featureCheck}>
                        <Check size={14} color="#34E0A6" strokeWidth={2} />
                      </View>
                    </View>
                    {!isLast && <View style={styles.divider} />}
                  </View>
                );
              })}
            </View>
          </LinearGradient>

          {/* Upgrade Button or Current Plan indicator */}
          {!isPremium ? (
            <TouchableOpacity activeOpacity={0.8} onPress={handleUpgrade} style={styles.upgradeBtn}>
              <LinearGradient
                colors={['#7A55FF', '#633FE5'] as const}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.upgradeBtnGradient}
              >
                <Crown size={18} color="#FFFFFF" strokeWidth={1.5} />
                <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.currentPlanBadge}>
              <Check size={14} color="#34E0A6" strokeWidth={2} />
              <Text style={styles.currentPlanText}>You're on the Premium plan</Text>
            </View>
          )}

          <Text style={styles.footerNote}>
            Subscriptions can be managed anytime in your device settings
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 6,
    paddingBottom: 12,
  },
  backBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
    flex: 1,
  },
  headerSpacer: {
    width: 28,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 160,
  },
  planCard: {
    borderRadius: 22,
    marginTop: 18,
    marginBottom: 8,

    ...CARD_SHADOW,
},
  planCardEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 20,
  },
  planCardEdgePremium: {
    borderColor: 'rgba(245, 166, 35, 0.25)',
  },
  planBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  planInfo: {
    flex: 1,
  },
  planBadgeLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    marginBottom: 2,
  },
  planName: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  planHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 7,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  featureHeaderLabel: {
    flex: 1,
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
  planHeaderLabel: {
    width: 48,
    textAlign: 'center',
    fontFamily: FONTS.display.bold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  cardGradient: {
    borderRadius: 8,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  featureName: {
    flex: 1,
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  featureCheck: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  upgradeBtn: {
    marginTop: 28,
    borderRadius: 16,
    overflow: 'hidden',
  },
  upgradeBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  upgradeBtnText: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  currentPlanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 28,
    borderRadius: 16,
    backgroundColor: 'rgba(52, 211, 153, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.12)',
  },
  currentPlanText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: '#34E0A6',
  },
  footerNote: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: 24,
  },
});
