import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { RecordStackParamList } from '../app/RootNavigator';
import { saveWorkout } from '../services/workoutStorage';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';

type SaveWorkoutRouteProp = RouteProp<RecordStackParamList, 'SaveWorkout'>;
type SaveWorkoutNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'SaveWorkout'>;

export const SaveWorkoutScreen: React.FC = () => {
  const navigation = useNavigation<SaveWorkoutNavigationProp>();
  const route = useRoute<SaveWorkoutRouteProp>();
  const insets = useSafeAreaInsets();
  const { workoutData } = route.params;
  const { clearSets, setWorkoutInProgress } = useCurrentWorkout();

  const [workoutName, setWorkoutName] = useState('');
  const [workoutDescription, setWorkoutDescription] = useState('');

  const handleSave = () => {
    if (!workoutName.trim()) {
      return; // Don't save if name is empty
    }

    // Save the workout
    saveWorkout({
      name: workoutName.trim(),
      description: workoutDescription.trim() || undefined,
      category: workoutData.category,
      duration: workoutData.duration,
      totalSets: workoutData.totalSets,
      totalReps: workoutData.totalReps,
      formScore: workoutData.avgFormScore,
      effortScore: workoutData.avgEffortScore,
    });

    clearSets();
    setWorkoutInProgress(false);

    // Navigate to Logbook tab to show the saved workout
    const rootNav = navigation.getParent()?.getParent();
    rootNav?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'MainTabs',
            state: {
              routes: [
                { name: 'Logbook' },
                { name: 'Analytics' },
                { name: 'Record' },
                { name: 'Trainer' },
                { name: 'Rewards' },
              ],
              index: 0, // Logbook tab index
            },
          },
        ],
      })
    );
  };

  const handleGoBack = () => {
    Alert.alert(
      'Discard Workout?',
      'Are you sure you want to discard this workout? This action cannot be undone.',
      [
        {
          text: 'No',
          style: 'cancel',
        },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: () => {
            clearSets();
            setWorkoutInProgress(false);
            navigation.reset({
              index: 0,
              routes: [{ name: 'RecordLanding' }],
            });
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          activeOpacity={0.7}
        >
          <X size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: Math.max(insets.bottom, SPACING.xl) + 100,
            backgroundColor: COLORS.background, // Ensure safe-area/scroll bg stays dark.
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Save Workout</Text>
          <Text style={styles.headerSubtitle}>Give your workout a name and optional description</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Workout Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter workout name"
              placeholderTextColor={COLORS.textSecondary}
              value={workoutName}
              onChangeText={setWorkoutName}
              autoFocus
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notes (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add notes..."
              placeholderTextColor={COLORS.textSecondary}
              value={workoutDescription}
              onChangeText={setWorkoutDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Workout Summary Preview */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Workout Summary</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Duration:</Text>
              <Text style={styles.summaryValue}>{workoutData.duration}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Reps:</Text>
              <Text style={styles.summaryValue}>{workoutData.totalReps}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Avg Form Score:</Text>
              <Text style={styles.summaryValue}>{workoutData.avgFormScore}%</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Avg Effort Score:</Text>
              <Text style={styles.summaryValue}>{workoutData.avgEffortScore}%</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.buttonContainer, {
        paddingTop: Math.max(insets.bottom, SPACING.md),
        paddingBottom: Math.max(insets.bottom, SPACING.md),
        bottom: -insets.bottom, // Extend into bottom inset to eliminate white bar.
      }]}>
        <TouchableOpacity
          style={[
            styles.saveButton,
            !workoutName.trim() && styles.saveButtonDisabled
          ]}
          onPress={handleSave}
          disabled={!workoutName.trim()}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>Save Workout</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  header: {
    marginBottom: SPACING.xl,
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  headerSubtitle: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  form: {
    gap: SPACING.xl,
  },
  inputGroup: {
    gap: SPACING.sm,
  },
  label: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  input: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: SPACING.md,
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 100,
    paddingTop: SPACING.md,
  },
  summaryCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  summaryLabel: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 40,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.border,
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
  },
});

