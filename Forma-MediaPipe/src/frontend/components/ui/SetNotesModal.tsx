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
import { X, ChevronDown, ChevronUp, Clock, TrendingUp } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../../constants/theme';
import { LoggedSet } from '../../contexts/CurrentWorkoutContext';
import { generateSetSummary } from '../../../utils/setNotesSummary';
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
  const [headerHeight, setHeaderHeight] = useState(0);

  const maxModalHeight = windowHeight * 0.75;
  const scrollMaxHeight = headerHeight > 0 ? maxModalHeight - headerHeight : undefined;

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
          style={[styles.modalContent, { maxHeight: windowHeight * 0.75 }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.glassEdge}>
            <LinearGradient
              colors={['#1C1C1E', '#141414', '#0E0E0E']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.modalGradient}
              onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            >
              {/* Drag handle */}
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title}>Set {setNumber}</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{exerciseName}</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Stats bar */}
              {(set.durationSeconds != null && set.durationSeconds > 0 || hasNotes) && (
                <View style={styles.statsBar}>
                  {set.durationSeconds != null && set.durationSeconds > 0 && (
                    <View style={styles.statItem}>
                      <Clock size={13} color={COLORS.textTertiary} strokeWidth={2} />
                      <Text style={styles.statValue}>
                        {Math.floor(set.durationSeconds / 60)}:{(set.durationSeconds % 60).toString().padStart(2, '0')}
                      </Text>
                    </View>
                  )}
                  {hasNotes && (
                    <View style={styles.statItem}>
                      <TrendingUp size={13} color={COLORS.textTertiary} strokeWidth={2} />
                      <Text style={styles.statValue}>
                        {repCount} rep{repCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                  {hasNotes && (
                    <View style={styles.statItem}>
                      <View style={[styles.scoreDot, { backgroundColor: getScoreColor(set.formScore) }]} />
                      <Text style={[styles.statValue, { color: getScoreColor(set.formScore) }]}>
                        {set.formScore}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </LinearGradient>

            <ScrollView
              style={[styles.scrollView, scrollMaxHeight != null && { maxHeight: scrollMaxHeight }]}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces
            >
                {hasNotes ? (
                  <>
                    {/* Rep breakdown */}
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Rep breakdown</Text>
                      <View style={styles.repList}>
                        {Array.from({ length: repCount }, (_, idx) => {
                          const { formScore, feedback } = getRepDetails(idx);
                          const isExpanded = expandedReps.has(idx);
                          const showExpand = overflowedReps.has(idx) || isExpanded;
                          const isGoodRep = feedback === 'Great rep!' || feedback === 'Good rep.';
                          const scoreColor = getScoreColor(formScore);

                          return (
                            <View
                              key={idx}
                              style={[
                                styles.repRow,
                                idx === repCount - 1 && styles.repRowLast,
                              ]}
                            >
                              <View style={styles.repHeader}>
                                <View style={styles.repLabelRow}>
                                  <Text style={styles.repNumber}>{idx + 1}</Text>
                                  <View style={[styles.scoreBadge, { backgroundColor: `${scoreColor}15` }]}>
                                    <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>
                                      {formScore}
                                    </Text>
                                  </View>
                                </View>
                                {showExpand && (
                                  <TouchableOpacity
                                    style={styles.repExpandButton}
                                    onPress={() => toggleRepExpanded(idx)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={isExpanded ? 'Collapse feedback' : 'Expand feedback'}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp size={16} color={COLORS.textTertiary} strokeWidth={2} />
                                    ) : (
                                      <ChevronDown size={16} color={COLORS.textTertiary} strokeWidth={2} />
                                    )}
                                  </TouchableOpacity>
                                )}
                              </View>
                              <View style={styles.repFeedbackContainer}>
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
                                    isGoodRep && styles.repFeedbackGood,
                                  ]}
                                  numberOfLines={isExpanded ? undefined : MAX_FEEDBACK_LINES}
                                >
                                  {feedback}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    {/* Form summary */}
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Summary</Text>
                      <View style={styles.summaryCard}>
                        <Text style={styles.summaryText}>{summary}</Text>
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
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
      android: { elevation: 10 },
    }),
  },
  modalGradient: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  glassEdge: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    backgroundColor: '#0E0E0E',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },
  headerLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  title: {
    fontSize: 22,
    fontFamily: FONTS.display.bold,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
    gap: SPACING.lg,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statValue: {
    fontSize: 12,
    fontFamily: FONTS.mono.regular,
    color: COLORS.textSecondary,
  },
  scoreDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  scrollView: {},
  scrollContent: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  repList: {
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  repRow: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  repRowLast: {
    borderBottomWidth: 0,
  },
  repHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  repLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  repNumber: {
    fontSize: 13,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
    width: 20,
  },
  scoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scoreBadgeText: {
    fontSize: 11,
    fontFamily: FONTS.mono.bold,
  },
  repFeedbackContainer: {
    paddingLeft: 28,
    position: 'relative',
  },
  repExpandButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  repFeedback: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  repFeedbackMeasure: {
    position: 'absolute',
    opacity: 0,
    left: 28,
    right: 0,
  },
  repFeedbackGood: {
    color: '#34D399',
  },
  summaryCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: SPACING.md,
  },
  summaryText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
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
