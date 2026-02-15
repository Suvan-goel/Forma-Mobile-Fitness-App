import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING, CARD_STYLE } from '../../constants/theme';
import { LoggedSet } from '../../contexts/CurrentWorkoutContext';
import { generateSetSummary } from '../../utils/setNotesSummary';

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
          <View style={styles.header}>
            <Text style={styles.title}>
              Set {setNumber} notes — {exerciseName}
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color={COLORS.text} />
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
                  <View style={styles.repList}>
                    {Array.from({ length: repCount }, (_, idx) => {
                      const { formScore, feedback } = getRepDetails(idx);
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
                            <Text
                              style={[
                                styles.repFeedback,
                                feedback === 'Great rep!' && styles.repFeedbackGood,
                                feedback === 'Good rep.' && styles.repFeedbackGood,
                              ]}
                              numberOfLines={2}
                            >
                              {feedback}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Form summary</Text>
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
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  title: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    flex: 1,
  },
  closeButton: {
    padding: SPACING.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  repList: {
    ...CARD_STYLE,
    padding: 0,
    overflow: 'hidden',
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.15)',
  },
  repNumber: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    width: 56,
  },
  repDetails: {
    flex: 1,
  },
  repFormScore: {
    fontSize: 12,
    fontFamily: FONTS.ui.bold,
    color: COLORS.primary,
    marginBottom: 2,
  },
  repFeedback: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  repFeedbackGood: {
    color: COLORS.primary,
    fontFamily: FONTS.ui.bold,
  },
  repRowLast: {
    borderBottomWidth: 0,
  },
  summaryCard: {
    ...CARD_STYLE,
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
