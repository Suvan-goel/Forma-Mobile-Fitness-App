import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronUp, ChevronDown, Plus, Minus, X, Dumbbell } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END } from '../constants/theme';
import { useCustomTemplates } from '../../backend/hooks';
import { useAlert } from '../contexts/AlertContext';
import type { RecordStackParamList } from '../app/RootNavigator';

type CreateTemplateNavigationProp = NativeStackNavigationProp<RecordStackParamList, 'CreateTemplate'>;

interface TemplateExerciseLocal {
  localId: string;
  name: string;
  category: string;
  targetSets: number;
}

const DELETE_AREA_WIDTH = 72;

// Module-level queue: ChooseExercise pushes here, CreateTemplate consumes on focus
let _pendingTemplateExercises: { name: string; category: string }[] = [];

export function addPendingTemplateExercise(exercise: { name: string; category: string }) {
  _pendingTemplateExercises.push(exercise);
}

/* ── Swipeable Exercise Card ────────────── */

const ExerciseCard: React.FC<{
  exercise: TemplateExerciseLocal;
  index: number;
  total: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onAdjustSets: (localId: string, delta: number) => void;
  onDelete: (localId: string) => void;
}> = ({ exercise, index, total, onMoveUp, onMoveDown, onAdjustSets, onDelete }) => {
  const { showAlert } = useAlert();
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpen = useRef(false);

  const closeSwipe = useCallback(() => {
    isSwipeOpen.current = false;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 2 && Math.abs(gs.dx) > 8,
      onPanResponderGrant: () => {
        translateX.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const newValue = startOffset + gs.dx;
        translateX.setValue(Math.min(0, Math.max(newValue, -DELETE_AREA_WIDTH)));
      },
      onPanResponderRelease: (_, gs) => {
        const startOffset = isSwipeOpen.current ? -DELETE_AREA_WIDTH : 0;
        const projected = startOffset + gs.dx;
        const shouldOpen = projected < -(DELETE_AREA_WIDTH / 2);
        isSwipeOpen.current = shouldOpen;
        Animated.spring(translateX, {
          toValue: shouldOpen ? -DELETE_AREA_WIDTH : 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      },
    })
  ).current;

  const handleDelete = useCallback(() => {
    closeSwipe();
    showAlert(
      'Remove Exercise?',
      `Remove ${exercise.name} from this template?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => onDelete(exercise.localId) },
      ],
    );
  }, [closeSwipe, showAlert, exercise.name, exercise.localId, onDelete]);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View style={styles.swipeContainer}>
      {/* Delete area */}
      <View style={styles.deleteArea}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.7}>
          <X size={18} color="#EF4444" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* Card */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <View style={styles.exerciseCardOuter}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.exerciseCardGradient}
          >
            <View style={styles.exerciseCardGlassEdge}>
              <View style={styles.exerciseAccentLine} />
              <View style={styles.exerciseCardContent}>
                {/* Left: name */}
                <View style={styles.exerciseCardLeft}>
                  <Text style={styles.exerciseCardName} numberOfLines={1}>{exercise.name}</Text>
                </View>

                {/* Right: arrows + sets adjuster */}
                <View style={styles.exerciseCardRight}>
                  {/* Move arrows */}
                  <View style={styles.arrowsColumn}>
                    <TouchableOpacity
                      onPress={() => onMoveUp(index)}
                      disabled={isFirst}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 2, left: 8, right: 8 }}
                    >
                      <ChevronUp size={16} color={isFirst ? COLORS.textTertiary : COLORS.accent} strokeWidth={1.5} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onMoveDown(index)}
                      disabled={isLast}
                      activeOpacity={0.7}
                      hitSlop={{ top: 2, bottom: 6, left: 8, right: 8 }}
                    >
                      <ChevronDown size={16} color={isLast ? COLORS.textTertiary : COLORS.accent} strokeWidth={1.5} />
                    </TouchableOpacity>
                  </View>

                  {/* Sets adjuster */}
                  <View style={styles.setsAdjuster}>
                    <TouchableOpacity
                      onPress={() => onAdjustSets(exercise.localId, -1)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    >
                      <Minus size={14} color={COLORS.accent} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.setsCount}>{exercise.targetSets}</Text>
                    <TouchableOpacity
                      onPress={() => onAdjustSets(exercise.localId, 1)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    >
                      <Plus size={14} color={COLORS.accent} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.setsLabel}>sets</Text>
                  </View>
                </View>
              </View>
            </View>
          </LinearGradient>
        </View>
      </Animated.View>
    </View>
  );
};

/* ── Main Screen ────────────────────────── */

export const CreateTemplateScreen: React.FC = () => {
  const navigation = useNavigation<CreateTemplateNavigationProp>();
  const insets = useSafeAreaInsets();
  const { createTemplate } = useCustomTemplates();
  const { showAlert } = useAlert();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [exercises, setExercises] = useState<TemplateExerciseLocal[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Consume pending exercises pushed by ChooseExercise on every focus
  useFocusEffect(
    useCallback(() => {
      if (_pendingTemplateExercises.length === 0) return;
      const toAdd = _pendingTemplateExercises.map(ex => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: ex.name,
        category: ex.category,
        targetSets: 3,
      }));
      _pendingTemplateExercises = [];
      setExercises(prev => [...prev, ...toAdd]);
    }, [])
  );


  const moveExercise = useCallback((index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    setExercises(prev => {
      if (target < 0 || target >= prev.length) return prev;
      const arr = [...prev];
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  }, []);

  const adjustSets = useCallback((localId: string, delta: number) => {
    setExercises(prev =>
      prev.map(ex =>
        ex.localId === localId
          ? { ...ex, targetSets: Math.max(1, Math.min(10, ex.targetSets + delta)) }
          : ex
      )
    );
  }, []);

  const deleteExercise = useCallback((localId: string) => {
    setExercises(prev => prev.filter(ex => ex.localId !== localId));
  }, []);

  const handleMoveUp = useCallback((index: number) => moveExercise(index, 'up'), [moveExercise]);
  const handleMoveDown = useCallback((index: number) => moveExercise(index, 'down'), [moveExercise]);

  const handleAddExercise = useCallback(() => {
    navigation.navigate('ChooseExercise', { mode: 'template' });
  }, [navigation]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert('Name Required', 'Please enter a template name.');
      return;
    }
    if (exercises.length === 0) {
      showAlert('No Exercises', 'Add at least one exercise to the template.');
      return;
    }

    setIsSaving(true);
    const success = await createTemplate({
      name: trimmedName,
      description: description.trim() || undefined,
      exercises: exercises.map((ex, i) => ({
        name: ex.name,
        category: ex.category,
        orderIndex: i,
        targetSets: ex.targetSets,
      })),
    });
    setIsSaving(false);

    if (success) {
      navigation.goBack();
    } else {
      showAlert('Error', 'Failed to save template. Please try again.');
    }
  }, [name, description, exercises, createTemplate, navigation, showAlert]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── Header ────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack} activeOpacity={0.7}>
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Template</Text>
        </View>
        <TouchableOpacity
          style={[styles.saveButton, (!name.trim() || exercises.length === 0 || isSaving) && styles.saveButtonDisabled]}
          onPress={handleSave}
          activeOpacity={0.7}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Name Input ────────────── */}
        <Text style={styles.inputLabel}>TEMPLATE NAME</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Upper Body Power"
          placeholderTextColor={COLORS.textTertiary}
          maxLength={50}
          returnKeyType="next"
        />

        {/* ── Description Input ─────── */}
        <Text style={styles.inputLabel}>DESCRIPTION</Text>
        <TextInput
          style={[styles.textInput, styles.textInputMultiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional description..."
          placeholderTextColor={COLORS.textTertiary}
          multiline
          maxLength={200}
          returnKeyType="default"
        />

        {/* ── Exercises Section ─────── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLabelRow}>
            <Dumbbell size={13} color={COLORS.accent} strokeWidth={1.5} />
            <Text style={styles.sectionLabel}>EXERCISES</Text>
          </View>
          <Text style={styles.exercisesCount}>{exercises.length}</Text>
        </View>

        {exercises.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No exercises added yet</Text>
          </View>
        ) : (
          <View style={styles.exerciseList}>
            {exercises.map((ex, i) => (
              <ExerciseCard
                key={ex.localId}
                exercise={ex}
                index={i}
                total={exercises.length}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onAdjustSets={adjustSets}
                onDelete={deleteExercise}
              />
            ))}
          </View>
        )}

        {/* ── Add Exercise CTA ──────── */}
        <TouchableOpacity onPress={handleAddExercise} activeOpacity={0.85} style={styles.addExerciseTouchable}>
          <LinearGradient
            colors={['rgba(139, 92, 246, 0.45)', 'rgba(124, 58, 237, 0.2)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.addExerciseGradient}
          >
            <View style={styles.addExerciseIconWrap}>
              <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
            </View>
            <Text style={styles.addExerciseText}>Add Exercise</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  /* ── Header ──────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.13)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
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
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  /* ── Scroll ──────────────────── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },

  /* ── Inputs ──────────────────── */
  inputLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 2,
    marginTop: 20,
    marginBottom: 8,
  },
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textInputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },

  /* ── Section Header ──────────── */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  exercisesCount: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.accent,
  },

  /* ── Empty State ─────────────── */
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },

  /* ── Exercise List ───────────── */
  exerciseList: {
    gap: 8,
  },

  /* ── Swipe-to-Delete ─────────── */
  swipeContainer: {
    height: 72,
  },
  deleteArea: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 12,
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Exercise Card ───────────── */
  exerciseCardOuter: {
    height: 72,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7C5CFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  exerciseCardGradient: {
    flex: 1,
    borderRadius: 16,
  },
  exerciseCardGlassEdge: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseAccentLine: {
    width: 3,
    height: 32,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
    marginLeft: 12,
  },
  exerciseCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  exerciseCardLeft: {
    flex: 1,
    marginRight: 12,
  },
  exerciseCardName: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  exerciseCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrowsColumn: {
    gap: 2,
  },
  setsAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  setsCount: {
    fontFamily: FONTS.display.bold,
    fontSize: 16,
    color: COLORS.text,
    minWidth: 18,
    textAlign: 'center',
  },
  setsLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginLeft: -4,
  },

  /* ── Add Exercise CTA ────────── */
  addExerciseTouchable: {
    marginTop: 16,
  },
  addExerciseGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  addExerciseIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addExerciseText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
