import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
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
          <Text style={styles.headingText}>Record New Workout</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={handleStartWorkout}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
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
  headingText: {
    fontSize: 22,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.xl,
  },
  addButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    fontSize: 36,
    fontFamily: FONTS.ui.bold,
    color: '#000000',
    lineHeight: 40,
  },
});
