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
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { RecordStackParamList } from '../app/RootNavigator';
import { saveWorkout } from '../services/workoutStorage';
import { useCurrentWorkout } from '../contexts/CurrentWorkoutContext';

const CARD_GRADIENT_COLORS: [string, string, string] = ['#1A1A1A', '#0F0F0F', '#0A0A0A'];

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
    <SafeAreaView
      style={[styles.container, { marginBottom: -insets.bottom }]}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
      >
      <View style={[styles.topBar, { paddingTop: SPACING.md }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          activeOpacity={0.7}
        >
          <X size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: Math.max(insets.bottom, SPACING.xl) + 100,
            backgroundColor: COLORS.background,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Save Workout</Text>
          <Text style={styles.headerSubtitle}>Give your workout a name and optional description</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputCardOuter}>
            <LinearGradient colors={CARD_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.inputCardGradient}>
              <View style={styles.inputCardGlass}>
                <Text style={styles.label}>Workout Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter workout name"
                  placeholderTextColor={COLORS.textTertiary}
                  value={workoutName}
                  onChangeText={setWorkoutName}
                  autoFocus
                />
              </View>
            </LinearGradient>
          </View>

          <View style={styles.inputCardOuter}>
            <LinearGradient colors={CARD_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.inputCardGradient}>
              <View style={styles.inputCardGlass}>
                <Text style={styles.label}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Add notes..."
                  placeholderTextColor={COLORS.textTertiary}
                  value={workoutDescription}
                  onChangeText={setWorkoutDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </LinearGradient>
          </View>

          {/* Workout Summary */}
          <View style={styles.summaryCardOuter}>
            <LinearGradient colors={CARD_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryCardGradient}>
              <View style={styles.summaryCardGlass}>
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
              </View>
            </LinearGradient>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.buttonContainer, {
        paddingTop: SPACING.md,
        paddingBottom: 12,
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
          {workoutName.trim() ? (
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.saveButtonGradient}
            >
              <Text style={styles.saveButtonText}>Save Workout</Text>
            </LinearGradient>
          ) : (
            <Text style={styles.saveButtonText}>Save Workout</Text>
          )}
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    paddingHorizontal: SPACING.screenHorizontal,
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
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  header: {
    marginBottom: SPACING.xl,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: SPACING.xs,
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  form: {
    gap: SPACING.xl,
  },
  inputCardOuter: {
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  inputCardGradient: {
    borderRadius: 22,
  },
  inputCardGlass: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  label: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  input: {
    backgroundColor: 'transparent',
    padding: 0,
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  textArea: {
    minHeight: 100,
    paddingTop: SPACING.xs,
  },
  summaryCardOuter: {
    borderRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  summaryCardGradient: {
    borderRadius: 22,
  },
  summaryCardGlass: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
  },
  summaryTitle: {
    fontSize: 18,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
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
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
  },
  keyboardView: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.screenHorizontal,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  saveButton: {
    borderRadius: 22,
    overflow: 'hidden',
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.border,
    opacity: 0.6,
  },
  saveButtonGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  saveButtonText: {
    fontSize: 17,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
});

