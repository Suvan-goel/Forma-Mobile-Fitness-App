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
import {
  Check,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Plus,
  Minus,
  X,
  Dumbbell,
  FileText,
} from 'lucide-react-native';
import {
  COLORS,
  SPACING,
  FONTS,
  PAGE_TITLE_TEXT,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_ELEVATED,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_VERTICAL_GAP,
  CARD_SHADOW,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { useCustomTemplates } from '../../backend/hooks/useCustomTemplates';
import { useAlert } from '../contexts/AlertContext';
import type { RecordStackParamList } from '../app/RootNavigator';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type CreateTemplateNavigationProp = NativeStackNavigationProp<
  RecordStackParamList,
  'CreateTemplate'
>;

interface TemplateExerciseLocal {
  localId: string;
  name: string;
  category: string;
  targetSets: number;
}

const DELETE_AREA_WIDTH = 72;
const MIN_TEMPLATE_EXERCISES = 2;

// Module-level queue: ChooseExercise pushes here, CreateTemplate consumes on focus
let _pendingTemplateExercises: { name: string; category: string }[] = [];

export function addPendingTemplateExercise(exercise: {
  name: string;
  category: string;
}) {
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
}> = ({
  exercise,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onAdjustSets,
  onDelete,
}) => {
  const { showAlert } = useAlert();
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpen = useRef(false);

  const closeSwipe = useCallback(() => {
    isSwipeOpen.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
    }).start();
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
        translateX.setValue(
          Math.min(0, Math.max(newValue, -DELETE_AREA_WIDTH)),
        );
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
    }),
  ).current;

  const handleDelete = useCallback(() => {
    closeSwipe();
    showAlert(
      'Remove Exercise?',
      `Remove ${exercise.name} from this template?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onDelete(exercise.localId),
        },
      ],
    );
  }, [closeSwipe, showAlert, exercise.name, exercise.localId, onDelete]);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View style={styles.swipeContainer}>
      {/* Delete area */}
      <View style={styles.deleteArea}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          activeOpacity={0.7}
        >
          <X size={18} color="#EF4444" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* Card */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <View style={styles.exerciseCardOuter}>
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.exerciseCardGradient}
          >
            <View style={styles.exerciseCardGlassEdge}>
              <View style={styles.exerciseCardContent}>
                <View style={styles.exerciseIndexBadge}>
                  <Text style={styles.exerciseIndexText}>{index + 1}</Text>
                </View>

                <View style={styles.exerciseCardCopy}>
                  <Text style={styles.exerciseCardName} numberOfLines={1}>
                    {exercise.name}
                  </Text>
                  <Text style={styles.exerciseCardMeta} numberOfLines={1}>
                    {exercise.category}
                  </Text>
                </View>

                <View style={styles.exerciseCardRight}>
                  <View style={styles.arrowsColumn}>
                    <TouchableOpacity
                      style={[
                        styles.orderButton,
                        isFirst && styles.orderButtonDisabled,
                      ]}
                      onPress={() => onMoveUp(index)}
                      disabled={isFirst}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 2, left: 8, right: 8 }}
                    >
                      <ChevronUp
                        size={15}
                        color={
                          isFirst ? COLORS.textTertiary : COLORS.textSecondary
                        }
                        strokeWidth={1.8}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.orderButton,
                        isLast && styles.orderButtonDisabled,
                      ]}
                      onPress={() => onMoveDown(index)}
                      disabled={isLast}
                      activeOpacity={0.7}
                      hitSlop={{ top: 2, bottom: 6, left: 8, right: 8 }}
                    >
                      <ChevronDown
                        size={15}
                        color={
                          isLast ? COLORS.textTertiary : COLORS.textSecondary
                        }
                        strokeWidth={1.8}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.setsAdjuster}>
                    <TouchableOpacity
                      style={styles.setButton}
                      onPress={() => onAdjustSets(exercise.localId, -1)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                    >
                      <Minus
                        size={13}
                        color={COLORS.textSecondary}
                        strokeWidth={2.2}
                      />
                    </TouchableOpacity>
                    <View style={styles.setsValueWrap}>
                      <Text style={styles.setsCount}>
                        {exercise.targetSets}
                      </Text>
                      <Text style={styles.setsLabel}>sets</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.setButton}
                      onPress={() => onAdjustSets(exercise.localId, 1)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    >
                      <Plus
                        size={13}
                        color={COLORS.textSecondary}
                        strokeWidth={2.2}
                      />
                    </TouchableOpacity>
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
  const totalSets = exercises.reduce(
    (sum, exercise) => sum + exercise.targetSets,
    0,
  );
  const estimatedMinutes = Math.max(0, exercises.length * 10);
  const canSave =
    name.trim().length > 0 &&
    exercises.length >= MIN_TEMPLATE_EXERCISES &&
    !isSaving;

  // Consume pending exercises pushed by ChooseExercise on every focus
  useFocusEffect(
    useCallback(() => {
      if (_pendingTemplateExercises.length === 0) return;
      const toAdd = _pendingTemplateExercises.map((ex) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: ex.name,
        category: ex.category,
        targetSets: 3,
      }));
      _pendingTemplateExercises = [];
      setExercises((prev) => [...prev, ...toAdd]);
    }, []),
  );

  const moveExercise = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const target = direction === 'up' ? index - 1 : index + 1;
      setExercises((prev) => {
        if (target < 0 || target >= prev.length) return prev;
        const arr = [...prev];
        [arr[index], arr[target]] = [arr[target], arr[index]];
        return arr;
      });
    },
    [],
  );

  const adjustSets = useCallback((localId: string, delta: number) => {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.localId === localId
          ? {
              ...ex,
              targetSets: Math.max(1, Math.min(10, ex.targetSets + delta)),
            }
          : ex,
      ),
    );
  }, []);

  const deleteExercise = useCallback((localId: string) => {
    setExercises((prev) => prev.filter((ex) => ex.localId !== localId));
  }, []);

  const handleMoveUp = useCallback(
    (index: number) => moveExercise(index, 'up'),
    [moveExercise],
  );
  const handleMoveDown = useCallback(
    (index: number) => moveExercise(index, 'down'),
    [moveExercise],
  );

  const handleAddExercise = useCallback(() => {
    navigation.navigate('ChooseExercise', { mode: 'template' });
  }, [navigation]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert('Name Required', 'Please enter a template name.');
      return;
    }
    if (exercises.length < MIN_TEMPLATE_EXERCISES) {
      showAlert(
        'More Exercises Required',
        'Add at least 2 exercises to create a template.',
      );
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
    <ScreenBackground style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerTitleRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleGoBack}
              activeOpacity={0.72}
            >
              <ChevronLeft
                size={24}
                color={COLORS.textSecondary}
                strokeWidth={1.7}
              />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>NEW TEMPLATE</Text>
          </View>
          <TouchableOpacity
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            onPress={handleSave}
            activeOpacity={0.75}
            disabled={!canSave}
          >
            <Check
              size={16}
              color={canSave ? COLORS.text : COLORS.textTertiary}
              strokeWidth={2.3}
            />
            <Text
              style={[
                styles.saveButtonText,
                !canSave && styles.saveButtonTextDisabled,
              ]}
            >
              {isSaving ? 'Saving' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, 32) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <LinearGradient
            colors={[...CARD_GRADIENT_ELEVATED]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.formCard}
          >
            <View style={styles.formCardEdge}>
              <View style={styles.cardLabelRow}>
                <FileText size={15} color={COLORS.accent} strokeWidth={1.8} />
                <Text style={styles.cardLabel}>DETAILS</Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.inputLabel}>TEMPLATE NAME</Text>
                <TextInput
                  style={styles.textInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="Upper Body Power"
                  placeholderTextColor={COLORS.textTertiary}
                  maxLength={50}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.inputLabel}>DESCRIPTION</Text>
                <TextInput
                  style={[styles.textInput, styles.textInputMultiline]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Optional notes for this session"
                  placeholderTextColor={COLORS.textTertiary}
                  multiline
                  maxLength={200}
                  returnKeyType="default"
                />
              </View>
            </View>
          </LinearGradient>

          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.summaryCard}
          >
            <View style={styles.summaryCardEdge}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{exercises.length}</Text>
                <Text style={styles.summaryLabel}>Exercises</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{totalSets}</Text>
                <Text style={styles.summaryLabel}>Sets</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {estimatedMinutes > 0 ? `~${estimatedMinutes}` : '—'}
                </Text>
                <Text style={styles.summaryLabel}>Minutes</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.7} />
              <Text style={styles.sectionLabel}>EXERCISES</Text>
            </View>
            <Text style={styles.exercisesCount}>{exercises.length}</Text>
          </View>

          {exercises.length === 0 ? (
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.emptyState}
            >
              <View style={styles.emptyStateEdge}>
                <View style={styles.emptyIconWrap}>
                  <Dumbbell size={22} color={COLORS.accent} strokeWidth={1.8} />
                </View>
                <Text style={styles.emptyStateTitle}>No exercises yet</Text>
                <Text style={styles.emptyStateText}>
                  Add at least 2 exercises to start shaping this template.
                </Text>
              </View>
            </LinearGradient>
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
              {exercises.length < MIN_TEMPLATE_EXERCISES && (
                <Text style={styles.minimumHint}>
                  Add 1 more exercise to save this template.
                </Text>
              )}
            </View>
          )}

          <TouchableOpacity
            onPress={handleAddExercise}
            activeOpacity={0.85}
            style={styles.addExerciseTouchable}
          >
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.addExerciseGradient}
            >
              <View style={styles.addExerciseIconWrap}>
                <Plus size={15} color="#FFFFFF" strokeWidth={2.6} />
              </View>
              <Text style={styles.addExerciseText}>Add Exercise</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
};

/* ── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 14,
  },
  headerTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButton: {
    width: 34,
    height: 34,
    marginLeft: -9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...PAGE_TITLE_TEXT,
  },
  saveButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 9,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 11,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.115)',
  },
  saveButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  saveButtonText: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0,
  },
  saveButtonTextDisabled: {
    color: COLORS.textTertiary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    gap: CARD_VERTICAL_GAP,
  },
  formCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  formCardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderTopColor: 'rgba(255, 255, 255, 0.14)',
    padding: 15,
    gap: 14,
  },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 1.8,
  },
  fieldGroup: {
    gap: 7,
  },
  inputLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 1.6,
  },
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 46,
    backgroundColor: 'rgba(6, 9, 12, 0.34)',
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    letterSpacing: 0,
  },
  textInputMultiline: {
    minHeight: 78,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  summaryCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  summaryCardEdge: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 6,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  summaryValue: {
    fontFamily: FONTS.display.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  summaryLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  summaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.065)',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 1.8,
  },
  exercisesCount: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.accent,
  },
  emptyState: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  emptyStateEdge: {
    minHeight: 156,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 20,
    gap: 8,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.24)',
    marginBottom: 2,
  },
  emptyStateTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: 0,
  },
  emptyStateText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    letterSpacing: 0,
  },
  exerciseList: {
    gap: 8,
  },
  minimumHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: 2,
  },
  swipeContainer: {
    height: 76,
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
    borderRadius: 12,
    backgroundColor: 'rgba(240, 82, 82, 0.11)',
    borderWidth: 0.5,
    borderColor: 'rgba(240, 82, 82, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseCardOuter: {
    height: 76,
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
  },
  exerciseCardGradient: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  exerciseCardGlassEdge: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 10,
  },
  exerciseIndexBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122, 85, 255, 0.14)',
    borderWidth: 0.5,
    borderColor: 'rgba(122, 85, 255, 0.24)',
  },
  exerciseIndexText: {
    fontFamily: FONTS.display.bold,
    fontSize: 14,
    color: COLORS.accent,
    letterSpacing: 0,
  },
  exerciseCardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  exerciseCardName: {
    fontFamily: FONTS.display.regular,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 0,
  },
  exerciseCardMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  exerciseCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowsColumn: {
    gap: 2,
  },
  orderButton: {
    width: 24,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  orderButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.018)',
  },
  setsAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    backgroundColor: 'rgba(5, 8, 12, 0.32)',
    borderRadius: 12,
    paddingHorizontal: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.065)',
  },
  setButton: {
    width: 26,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  setsValueWrap: {
    alignItems: 'center',
    minWidth: 34,
    gap: 0,
  },
  setsCount: {
    fontFamily: FONTS.display.regular,
    fontSize: 17,
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 18,
  },
  setsLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  addExerciseTouchable: {
    marginTop: 2,
    borderRadius: 12,
    ...CARD_SHADOW,
  },
  addExerciseGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  addExerciseIconWrap: {
    width: 23,
    height: 23,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addExerciseText: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
