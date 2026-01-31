import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';

type InsightsScreenRouteProp = RouteProp<RootStackParamList, 'Insights'>;
type InsightsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Insights'>;

const insightsData: { [key: string]: string[] } = {
  Form: [
    "Your form has improved significantly over the past week, with a 15% increase in average score.",
    "Focus on maintaining proper posture during squats - your lower back alignment shows room for improvement.",
    "Your deadlift form is excellent, with consistent hip hinge mechanics throughout your sets.",
    "Consider reducing weight slightly on overhead presses to maintain better shoulder stability.",
    "Your bench press form is solid, but try to keep your feet flat on the floor for better power transfer."
  ],
  Effort: [
    "Your effort levels have been consistently high, averaging 92% intensity across all workouts.",
    "You're pushing yourself appropriately - your RPE (Rate of Perceived Exertion) matches your performance metrics.",
    "Consider adding 1-2 rest days this week to allow for optimal recovery and prevent overtraining.",
    "Your effort distribution is well-balanced between strength and endurance training.",
    "Great job maintaining intensity even during longer workout sessions - your mental toughness is showing."
  ],
  Consistency: [
    "You've maintained a 79% consistency rate over the past month - keep up the momentum!",
    "Your workout frequency has been steady, with 5-6 sessions per week on average.",
    "Try to establish a more consistent morning routine to improve your adherence rate.",
    "Your consistency is strongest on weekdays - consider adding weekend sessions to boost your overall rate.",
    "You're building excellent habits - consistency is the key to long-term progress."
  ],
  Strength: [
    "Your strength has been steadily increasing, with a 14-point improvement over the past month.",
    "Your progressive overload strategy is working well - continue gradually increasing weight or reps.",
    "Focus on compound movements like squats and deadlifts to maximize strength gains.",
    "Your bench press strength is progressing nicely - consider adding accessory work for triceps.",
    "Maintain proper form as you increase weight - strength without form is counterproductive."
  ]
};

export const InsightsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<InsightsScreenNavigationProp>();
  const route = useRoute<InsightsScreenRouteProp>();
  const { metric } = route.params;
  
  const insights = insightsData[metric] || [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{metric} Analysis</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* AI Insights Section */}
        <View style={styles.insightsCard}>
          <View style={styles.insightsHeader}>
            <View style={styles.aiIconContainer}>
              <Sparkles size={24} color={COLORS.primary} />
            </View>
            <Text style={styles.insightsTitle}>AI-Generated Insights</Text>
          </View>
          
          {insights.map((insight, index) => (
            <View key={index} style={styles.insightItem}>
              <View style={styles.insightBullet} />
              <Text style={styles.insightText}>{insight}</Text>
            </View>
          ))}
        </View>

        {/* Recommendations Card */}
        <View style={styles.recommendationsCard}>
          <Text style={styles.recommendationsTitle}>Recommendations</Text>
          <Text style={styles.recommendationsText}>
            Based on your {metric.toLowerCase()} metrics, we recommend focusing on maintaining your current training intensity while paying attention to recovery. Continue tracking your progress and adjust your routine as needed.
          </Text>
        </View>
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  placeholder: {
    width: 24 + SPACING.sm * 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: SPACING.md,
  },
  insightsCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 24,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: SPACING.lg,
  },
  aiIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.cardBackgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightsTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
    gap: 12,
  },
  insightBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginTop: 6,
  },
  insightText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    lineHeight: 22,
  },
  recommendationsCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 24,
    padding: SPACING.lg,
  },
  recommendationsTitle: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  recommendationsText: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
});

