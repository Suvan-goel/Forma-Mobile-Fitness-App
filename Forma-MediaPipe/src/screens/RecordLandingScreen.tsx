import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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

  const handleStartWorkout = () => {
    navigation.navigate('CurrentWorkout');
  };

  return (
    <View style={styles.container}>
      <View style={styles.centerContent} pointerEvents="box-none">
        <View style={styles.centeredBlock}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={handleStartWorkout}
            activeOpacity={0.7}
          >
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.instructionText}>Tap to start new workout</Text>
        </View>
      </View>
      <AppHeader />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  centeredBlock: {
    alignItems: 'center',
  },
  addButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  addButtonText: {
    fontSize: 140,
    color: COLORS.primary,
    lineHeight: 150,
    fontWeight: '100',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-thin',
  },
  instructionText: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    opacity: 0.6,
  },
});
