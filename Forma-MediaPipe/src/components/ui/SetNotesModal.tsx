import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Platform,
  NativeSyntheticEvent,
  TextLayoutEventData,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import { LoggedSet } from '../../contexts/CurrentWorkoutContext';
import { generateSetSummary } from '../../utils/setNotesSummary';

const CARD_GRADIENT_COLORS: [string, string, string] = ['#1A1A1A', '#0F0F0F', '#0A0A0A'];
const MAX_FEEDBACK_LINES = 2;

interface SetNotesModalProps {
  visible: boolean;
  onClose: () => void;
  set: LoggedSet;
  setNumber: number;
  exerciseName: string;
}

export const SetNotesModal: React.FC<SetNotesModalProps> = ({
  visible,
  onClose,
  set,
  setNumber,
  exerciseName,
}) => {
  const { height: windowHeight } = useWindowDimensions();
  const repFeedback = set.repFeedback ?? [];
  const repFormScores = set.repFormScores ?? [];
  const summary = generateSetSummary(repFeedback, set.formScore, exerciseName);

  const repCount = Math.max(repFeedback.length, repFormScores.length, set.reps);
  const hasNotes = repCount > 0;

  const [expandedReps, setExpandedReps] = useState<Set<number>>(new Set());
  const [overflowedReps, setOverflowedReps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (visible) {
      setExpandedReps(new Set());
      setOverflowedReps(new Set());
    }
  }, [visible]);

  const toggleRepExpanded = useCallback((idx: number) => {
    setExpandedReps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleFeedbackLayout = useCallback((idx: number, e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lineCount = e.nativeEvent?.lines?.length ?? 0;
    if (lineCount > MAX_FEEDBACK_LINES) {
      setOverflowedReps((prev) => new Set(prev).add(idx));
    }
  }, []);

  const getRepDetails = (idx: number) => ({
    formScore: repFormScores[idx] ?? set.formScore,
    feedback: repFeedback[idx] ?? '—',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={[styles.modalContent, { maxHeight: windowHeight * 0.7 }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <LinearGradient
            colors={CARD_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.modalGradient}
          >
            <View style={styles.glassEdge}>
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={2}>
                  Set {setNumber} notes — {exerciseName}
                </Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={24} color={COLORS.text} strokeWidth={1.5} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {hasNotes ? (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Rep breakdown</Text>
                      <View style={styles.repCardOuter}>
                        <LinearGradient
                          colors={CARD_GRADIENT_COLORS}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.repCardGradient}
                        >
                          <View style={styles.repCardGlass}>
                            {Array.from({ length: repCount }, (_, idx) => {
                              const { formScore, feedback } = getRepDetails(idx);
                              const isExpanded = expandedReps.has(idx);
                              const showExpand = overflowedReps.has(idx) || isExpanded;
                              return (
                                <View
                                  key={idx}
                                  style={[
                                    styles.repRow,
                                    idx === repCount - 1 && styles.repRowLast,
                                  ]}
                                >
                                  <Text style={styles.repNumber}>Rep {idx + 1}</Text>
                                  <View style={styles.repDetails}>
                                    <Text style={styles.repFormScore}>
                                      Form: {formScore}
                                    </Text>
                                    {/* Hidden text to measure real line count for overflow */}
                                    <Text
                                      style={[styles.repFeedback, styles.repFeedbackMeasure]}
                                      onTextLayout={(e) => handleFeedbackLayout(idx, e)}
                                      pointerEvents="none"
                                    >
                                      {feedback}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.repFeedback,
                                        (feedback === 'Great rep!' || feedback === 'Good rep.') && styles.repFeedbackGood,
                                      ]}
                                      numberOfLines={isExpanded ? undefined : MAX_FEEDBACK_LINES}
                                    >
                                      {feedback}
                                    </Text>
                                  </View>
                                  {showExpand ? (
                                    <TouchableOpacity
                                      style={styles.repExpandButton}
                                      onPress={() => toggleRepExpanded(idx)}
                                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                      accessibilityRole="button"
                                      accessibilityLabel={isExpanded ? 'Collapse feedback' : 'Expand feedback'}
                                    >
                                      {isExpanded ? (
                                        <ChevronUp size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
                                      ) : (
                                        <ChevronDown size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
                                      )}
                                    </TouchableOpacity>
                                  ) : (
                                    <View style={styles.repExpandButton} />
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        </LinearGradient>
                      </View>
                    </View>

                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Form summary</Text>
                      <View style={styles.summaryCardOuter}>
                        <LinearGradient
                          colors={CARD_GRADIENT_COLORS}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.summaryCardGradient}
                        >
                          <View style={styles.summaryCardGlass}>
                            <Text style={styles.summaryText}>{summary}</Text>
                          </View>
                        </LinearGradient>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                      No rep-by-rep feedback for this set.
                    </Text>
                    <Text style={styles.emptySubtext}>
                      Feedback is captured for exercises with form analysis. Form score: {set.formScore}/100
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  modalGradient: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: SPACING.xl,
    maxHeight: '100%',
  },
  glassEdge: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  title: {
    fontSize: 17,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    flex: 1,
    letterSpacing: -0.3,
    marginRight: SPACING.sm,
  },
  closeButton: {
    padding: SPACING.xs,
  },
  scrollView: {},
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  repCardOuter: {
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
  repCardGradient: {
    borderRadius: 22,
  },
  repCardGlass: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  repNumber: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    width: 52,
    letterSpacing: 0.5,
  },
  repDetails: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  repExpandButton: {
    width: 32,
    padding: SPACING.xs,
    marginLeft: SPACING.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  repFormScore: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
    marginBottom: 2,
  },
  repFeedback: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    lineHeight: 20,
  },
  repFeedbackMeasure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
  },
  repFeedbackGood: {
    color: COLORS.accent,
    fontFamily: FONTS.ui.bold,
  },
  repRowLast: {
    borderBottomWidth: 0,
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
  summaryText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    lineHeight: 22,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
});
