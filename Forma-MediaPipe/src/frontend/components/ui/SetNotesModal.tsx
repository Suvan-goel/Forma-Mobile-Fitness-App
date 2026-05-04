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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ChevronDown, ChevronUp, Clock, TrendingUp, Target, FileText } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_RADIUS_LG, getScoreColor } from '../../constants/theme';
import { LoggedSet } from '../../contexts/CurrentWorkoutContext';
import { MonoText } from '../typography/MonoText';
import { generateSetSummary } from '../../../utils/setNotesSummary';
import { getBottomSafePadding } from '../../utils/safeAreaSpacing';

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
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const repFeedback = set.repFeedback ?? [];
  const repFormScores = set.repFormScores ?? [];
  const summary = generateSetSummary(repFeedback, set.formScore, exerciseName);

  const repCount = Math.max(repFeedback.length, repFormScores.length, set.reps);
  const hasNotes = repCount > 0;
  const scoreColor = getScoreColor(set.formScore);

  const [expandedReps, setExpandedReps] = useState<Set<number>>(new Set());
  const [overflowedReps, setOverflowedReps] = useState<Set<number>>(new Set());
  const [headerHeight, setHeaderHeight] = useState(0);

  const maxModalHeight = windowHeight * 0.82;
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
    feedback: repFeedback[idx] ?? '-',
  });

  const durationLabel = set.durationSeconds != null && set.durationSeconds > 0
    ? `${Math.floor(set.durationSeconds / 60)}:${(set.durationSeconds % 60).toString().padStart(2, '0')}`
    : null;

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
          style={[styles.sheetOuter, { maxHeight: maxModalHeight }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={[styles.sheetSurface, { paddingBottom: getBottomSafePadding(insets.bottom) }]}>
            <View
              style={styles.header}
              onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            >
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>

              <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title}>Set {setNumber}</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{exerciseName}</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close set notes"
                >
                  <X size={18} color={COLORS.textSecondary} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <View style={styles.metricsGrid}>
                <View style={styles.metricTile}>
                  <View style={styles.metricLabelRow}>
                    <Target size={13} color={COLORS.accent} strokeWidth={1.6} />
                    <Text style={styles.metricLabel}>Form Score</Text>
                  </View>
                  <View style={styles.metricValueRow}>
                    <MonoText bold style={[styles.scoreValue, { color: scoreColor }]}>
                      {set.formScore}
                    </MonoText>
                    <Text style={styles.scoreUnit}>/100</Text>
                  </View>
                </View>

                <View style={styles.metricTile}>
                  <View style={styles.metricLabelRow}>
                    <TrendingUp size={13} color={COLORS.textTertiary} strokeWidth={1.6} />
                    <Text style={styles.metricLabel}>Reps</Text>
                  </View>
                  <MonoText bold style={styles.metricValue}>
                    {repCount}
                  </MonoText>
                </View>

                {durationLabel && (
                  <View style={styles.metricTile}>
                    <View style={styles.metricLabelRow}>
                      <Clock size={13} color={COLORS.textTertiary} strokeWidth={1.6} />
                      <Text style={styles.metricLabel}>Duration</Text>
                    </View>
                    <MonoText bold style={styles.metricValue}>
                      {durationLabel}
                    </MonoText>
                  </View>
                )}
              </View>
            </View>

            <ScrollView
              style={[styles.scrollView, scrollMaxHeight != null && { maxHeight: scrollMaxHeight }]}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces
            >
              {hasNotes ? (
                <>
                  <View style={styles.section}>
                    <View style={styles.sectionLabelRow}>
                      <FileText size={12} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.sectionTitle}>REP BREAKDOWN</Text>
                    </View>

                    <View style={styles.repList}>
                      {Array.from({ length: repCount }, (_, idx) => {
                        const { formScore, feedback } = getRepDetails(idx);
                        const isExpanded = expandedReps.has(idx);
                        const showExpand = overflowedReps.has(idx) || isExpanded;
                        const isGoodRep = feedback === 'Great rep!' || feedback === 'Good rep.';
                        const repScoreColor = getScoreColor(formScore);

                        return (
                          <View
                            key={idx}
                            style={[
                              styles.repRow,
                              idx === repCount - 1 && styles.repRowLast,
                            ]}
                          >
                            <View style={styles.repIndexBadge}>
                              <MonoText bold style={styles.repIndexText}>{idx + 1}</MonoText>
                            </View>

                            <View style={styles.repContent}>
                              <View style={styles.repHeader}>
                                <Text style={styles.repTitle}>Rep {idx + 1}</Text>
                                <View style={[styles.scoreBadge, { borderColor: `${repScoreColor}55` }]}>
                                  <MonoText bold style={[styles.scoreBadgeText, { color: repScoreColor }]}>
                                    {formScore}
                                  </MonoText>
                                </View>
                              </View>

                              <View style={styles.repFeedbackContainer}>
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

                            {showExpand && (
                              <TouchableOpacity
                                style={styles.repExpandButton}
                                onPress={() => toggleRepExpanded(idx)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                accessibilityRole="button"
                                accessibilityLabel={isExpanded ? 'Collapse feedback' : 'Expand feedback'}
                              >
                                {isExpanded ? (
                                  <ChevronUp size={14} color={COLORS.textTertiary} strokeWidth={2} />
                                ) : (
                                  <ChevronDown size={14} color={COLORS.textTertiary} strokeWidth={2} />
                                )}
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.section}>
                    <View style={styles.sectionLabelRow}>
                      <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.sectionTitle}>SUMMARY</Text>
                    </View>

                    <View style={styles.summaryCard}>
                      <Text style={styles.summaryText}>{summary}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIconWrap}>
                    <FileText size={24} color={COLORS.textTertiary} strokeWidth={1} />
                  </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheetOuter: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.35,
        shadowRadius: 18,
      },
      android: { elevation: 10 },
    }),
  },
  sheetSurface: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: COLORS.borderStrong,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  title: {
    fontSize: 21,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  metricTile: {
    flex: 1,
    minHeight: 72,
    borderRadius: CARD_RADIUS_LG,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    paddingHorizontal: 11,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  scoreValue: {
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -1,
  },
  scoreUnit: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  metricValue: {
    fontSize: 21,
    lineHeight: 26,
    color: COLORS.text,
  },
  scrollView: {
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: FONTS.display.semibold,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },
  repList: {
    borderRadius: CARD_RADIUS_LG,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBackground,
    overflow: 'hidden',
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  repRowLast: {
    borderBottomWidth: 0,
  },
  repIndexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  repIndexText: {
    fontSize: 12,
    color: COLORS.accent,
    lineHeight: 16,
  },
  repContent: {
    flex: 1,
    minWidth: 0,
  },
  repHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: 5,
  },
  repTitle: {
    fontSize: 13,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  scoreBadge: {
    minWidth: 36,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
  },
  scoreBadgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  repFeedbackContainer: {
    position: 'relative',
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
    left: 0,
    right: 0,
  },
  repFeedbackGood: {
    color: COLORS.green,
  },
  repExpandButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
  },
  summaryCard: {
    borderRadius: CARD_RADIUS_LG,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBackground,
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
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
  },
});
