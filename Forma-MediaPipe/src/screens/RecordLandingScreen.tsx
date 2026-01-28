import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutTemplate, Dumbbell } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { AppHeader } from '../components/ui/AppHeader';

type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: any } | undefined;
  ChooseExercise: undefined;
  Camera: { exerciseName: string; category: string; returnToCurrentWorkout: true };
};

type RecordLandingNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'RecordLanding'>;

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
              <Dumbbell size={100} color={COLORS.primary} strokeWidth={1.5} />
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
              <LayoutTemplate size={100} color={COLORS.primary} strokeWidth={1.5} />
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
