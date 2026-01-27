import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { AppHeader } from '../components/ui/AppHeader';

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: any } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; returnToCurrentWorkout: true };
};

type RecordLandingNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'RecordLanding'>;

// Thin Plus Icon Component using SVG for consistent rendering across all devices
const ThinPlusIcon: React.FC<{ size?: number; color?: string }> = ({ size = 140, color = COLORS.primary }) => {
  const strokeWidth = 2; // Very thin stroke
  const center = size / 2;
  const lineLength = size * 0.4; // Length of each line in the plus
  
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Horizontal line */}
      <Line
        x1={center - lineLength / 2}
        y1={center}
        x2={center + lineLength / 2}
        y2={center}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Vertical line */}
      <Line
        x1={center}
        y1={center - lineLength / 2}
        x2={center}
        y2={center + lineLength / 2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
};

export const RecordLandingScreen: React.FC = () => {
  const navigation = useNavigation<RecordLandingNavigationProp>();
  const insets = useSafeAreaInsets();
  const navigationBarHeight = 60 + Math.max(insets.bottom, 8); // Approximate nav bar height + safe area

  const handleStartWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  const handleChooseTemplate = () => {
    // Navigate to template selection - adjust route as needed
    navigation.navigate('ChooseExercise');
  };

  return (
    <View style={styles.container}>
      <AppHeader />
      <View style={[styles.cardsContainer, { paddingBottom: navigationBarHeight + SPACING.lg }]}>
        {/* Top Card - Start New Workout */}
        <TouchableOpacity
          style={styles.card}
          onPress={handleStartWorkout}
          activeOpacity={0.7}
        >
          <View style={styles.cardContent}>
            <View style={styles.plusIconContainer}>
              <ThinPlusIcon size={140} color={COLORS.primary} />
            </View>
            <Text style={styles.cardText}>Start New Workout</Text>
          </View>
        </TouchableOpacity>

        {/* Bottom Card - Choose Template */}
        <TouchableOpacity
          style={styles.card}
          onPress={handleChooseTemplate}
          activeOpacity={0.7}
        >
          <View style={styles.cardContent}>
            <View style={styles.plusIconContainer}>
              <ThinPlusIcon size={140} color={COLORS.primary} />
            </View>
            <Text style={styles.cardText}>Choose Template</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  cardsContainer: {
    flex: 1,
    flexDirection: 'column',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.lg,
  },
  card: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  cardContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIconContainer: {
    marginBottom: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    fontSize: 18,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    opacity: 0.4,
  },
});
