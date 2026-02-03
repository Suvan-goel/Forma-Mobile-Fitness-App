import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/RootNavigator';
import { insightsService, InsightsData } from '../services/api';
import { LoadingSkeleton, ErrorState } from '../components/ui';

type InsightsScreenRouteProp = RouteProp<RootStackParamList, 'Insights'>;
type InsightsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Insights'>;

export const InsightsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<InsightsScreenNavigationProp>();
  const route = useRoute<InsightsScreenRouteProp>();
  const { metric } = route.params;

  // Local state for insights
  const [insights, setInsights] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch insights from service
  const fetchInsights = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await insightsService.getInsights(metric as keyof InsightsData);
      if (response.success) {
        setInsights(response.data);
      } else {
        setError(response.error || 'Failed to fetch insights');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{metric} Analysis</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <LoadingSkeleton variant="card" height={300} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={120} />
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{metric} Analysis</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.errorContainer}>
          <ErrorState message={error} onRetry={fetchInsights} />
        </View>
      </View>
    );
  }

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
  loadingContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
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
    ...CARD_STYLE,
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
    ...CARD_STYLE,
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

