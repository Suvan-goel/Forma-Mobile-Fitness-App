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
import { X, ChevronDown, ChevronUp, Clock, TrendingUp, Target, FileText } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, SCREEN_GRADIENT_COLORS, CARD_GRADIENT_COLORS, CARD_GRADIENT_START, CARD_GRADIENT_END, getScoreColor } from '../../constants/theme';
import { LoggedSet } from '../../contexts/CurrentWorkoutContext';
import { MonoText } from '../typography/MonoText';
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
  const scoreColor = getScoreColor(set.formScore);

  const [expandedReps, setExpandedReps] = useState<Set<number>>(new Set());
  const [overflowedReps, setOverflowedReps] = useState<Set<number>>(new Set());
  const [headerHeight, setHeaderHeight] = useState(0);

  const maxModalHeight = windowHeight * 0.8;
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
          style={[styles.sheetOuter, { maxHeight: maxModalHeight }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.sheetGlassEdge}>
            {/* Hero header with purple gradient */}
            <LinearGradient
              colors={SCREEN_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerGradient}
              onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            >
              {/* Drag handle */}
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>

              {/* Title row */}
              <View style={styles.headerRow}>
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

              {/* Hero score + stats */}
              {hasNotes && (
                <View style={styles.heroStats}>
                  {/* Score hero */}
                  <View style={styles.scoreHero}>
                    <View style={styles.scoreLabelRow}>
                      <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
                      <Text style={styles.scoreLabel}>FORM SCORE</Text>
                    </View>
                    <View style={styles.scoreValueRow}>
                      <MonoText bold style={[styles.scoreValue, { color: scoreColor }]}>
                        {set.formScore}
                      </MonoText>
                      <Text style={styles.scoreUnit}>/100</Text>
                    </View>
                  </View>

                  {/* Stat chips */}
                  <View style={styles.statChips}>
                    {set.durationSeconds != null && set.durationSeconds > 0 && (
                      <View style={styles.statChip}>
                        <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
                        <MonoText style={styles.statChipText}>
                          {Math.floor(set.durationSeconds / 60)}:{(set.durationSeconds % 60).toString().padStart(2, '0')}
                        </MonoText>
                      </View>
                    )}
                    <View style={styles.statChip}>
                      <TrendingUp size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
                      <MonoText style={styles.statChipText}>
                        {repCount} rep{repCount !== 1 ? 's' : ''}
                      </MonoText>
                    </View>
                  </View>
                </View>
              )}

              {/* Minimal stats for no-notes case */}
              {!hasNotes && (set.durationSeconds != null && set.durationSeconds > 0) && (
                <View style={styles.heroStatsMinimal}>
                  <View style={styles.statChip}>
                    <Clock size={12} color={COLORS.textTertiary} strokeWidth={1.5} />
                    <MonoText style={styles.statChipText}>
                      {Math.floor(set.durationSeconds / 60)}:{(set.durationSeconds % 60).toString().padStart(2, '0')}
                    </MonoText>
                  </View>
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
                      <View style={styles.sectionLabelRow}>
                        <FileText size={12} color={COLORS.accent} strokeWidth={1.5} />
                        <Text style={styles.sectionTitle}>REP BREAKDOWN</Text>
                      </View>

                      <View style={styles.repListOuter}>
                        <LinearGradient
                          colors={[...CARD_GRADIENT_COLORS]}
                          start={CARD_GRADIENT_START}
                          end={CARD_GRADIENT_END}
                          style={styles.repListGradient}
                        >
                          <View style={styles.repListEdge}>
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
                                  <View style={styles.repHeader}>
                                    <View style={styles.repLabelRow}>
                                      <View style={styles.repIndexBadge}>
                                        <MonoText bold style={styles.repIndexText}>{idx + 1}</MonoText>
                                      </View>
                                      <View style={[styles.scoreBadge, { backgroundColor: `${repScoreColor}15` }]}>
                                        <MonoText bold style={[styles.scoreBadgeText, { color: repScoreColor }]}>
                                          {formScore}
                                        </MonoText>
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
                        </LinearGradient>
                      </View>
                    </View>

                    {/* Form summary */}
                    <View style={styles.section}>
                      <View style={styles.sectionLabelRow}>
                        <Target size={12} color={COLORS.accent} strokeWidth={1.5} />
                        <Text style={styles.sectionTitle}>SUMMARY</Text>
                      </View>

                      <View style={styles.summaryOuter}>
                        <LinearGradient
                          colors={[...CARD_GRADIENT_COLORS]}
                          start={CARD_GRADIENT_START}
                          end={CARD_GRADIENT_END}
                          style={styles.summaryGradient}
                        >
                          <View style={styles.summaryEdge}>
                            <Text style={styles.summaryText}>{summary}</Text>
                          </View>
                        </LinearGradient>
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  sheetOuter: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#7A55FF',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
    }),
  },
  sheetGlassEdge: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(139, 92, 246, 0.15)',
    overflow: 'hidden',
    backgroundColor: '#0C0A14',
  },

  /* ── Header ──────────────────────────────── */
  headerGradient: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Hero Stats ──────────────────────────── */
  heroStats: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  heroStatsMinimal: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  scoreHero: {
    gap: 4,
  },
  scoreLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  scoreLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 10,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },
  scoreValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  scoreValue: {
    fontSize: 40,
    letterSpacing: -1.5,
    lineHeight: 44,
  },
  scoreUnit: {
    fontFamily: FONTS.mono.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
  },
  statChips: {
    gap: 8,
    alignItems: 'flex-end',
    paddingBottom: 6,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  statChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  /* ── Scroll ──────────────────────────────── */
  scrollView: {},
  scrollContent: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  /* ── Sections ─────────────────────────────── */
  section: {
    marginBottom: SPACING.xl,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONTS.display.bold,
    color: COLORS.textSecondary,
    letterSpacing: 2,
  },

  /* ── Rep List ─────────────────────────────── */
  repListOuter: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  repListGradient: {
    borderRadius: 18,
  },
  repListEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
  },
  repRow: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
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
  repIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repIndexText: {
    fontSize: 11,
    color: COLORS.accent,
    lineHeight: 14,
  },
  scoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  scoreBadgeText: {
    fontSize: 11,
  },
  repFeedbackContainer: {
    paddingLeft: 32,
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
    left: 32,
    right: 0,
  },
  repFeedbackGood: {
    color: '#34E0A6',
  },

  /* ── Summary ──────────────────────────────── */
  summaryOuter: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  summaryGradient: {
    borderRadius: 18,
  },
  summaryEdge: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: SPACING.md,
  },
  summaryText: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  /* ── Empty State ──────────────────────────── */
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.022)',
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
