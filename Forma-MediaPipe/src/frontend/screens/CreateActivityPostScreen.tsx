/**
 * CreateActivityPostScreen — Compose an activity post for the social feed.
 * User can write text and optionally tag a workout, badge, or stat.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  X,
  ChevronRight,
  Activity,
  Award,
  Flame,
  TrendingUp,
  Dumbbell,
  Target,
  Check,
} from 'lucide-react-native';
import {
  COLORS,
  FONTS,
  PAGE_TITLE_TEXT,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_START,
  SCREEN_GRADIENT_END,
  getScoreColor,
} from '../constants/theme';
import { useAnalytics } from '../../backend/hooks/useAnalytics';
import { useCreateActivityPost } from '../../backend/hooks/useCreateActivityPost';
import { useRewards } from '../../backend/hooks/useRewards';
import { useWorkouts } from '../../backend/hooks/useWorkouts';
import { useAlert } from '../contexts/AlertContext';
import type { RootStackParamList } from '../app/RootNavigator';
import type { WorkoutSession, Reward, ActivityEventType } from '../../backend/services/api/types';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

// ── Attachment types ────────────────────────────────────────

interface WorkoutAttachment {
  type: 'workout';
  workout: WorkoutSession;
}

interface BadgeAttachment {
  type: 'badge';
  badge: Reward;
}

interface StatAttachment {
  type: 'stat';
  label: string;
  value: string;
  icon: 'streak' | 'reps' | 'score';
}

type Attachment = WorkoutAttachment | BadgeAttachment | StatAttachment;

// ── Picker section names ────────────────────────────────────

type PickerSection = 'workout' | 'badge' | 'stat' | null;

// ── Main component ──────────────────────────────────────────

export const CreateActivityPostScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();

  const [caption, setCaption] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [activePicker, setActivePicker] = useState<PickerSection>(null);

  const { workouts, isLoading: workoutsLoading } = useWorkouts();
  const { rewards, userStats, isLoading: rewardsLoading } = useRewards();
  const { analytics } = useAnalytics();
  const { createPost, isPosting } = useCreateActivityPost();

  const earnedBadges = useMemo(() => {
    if (!rewards || !userStats) return [];
    const earned = new Set(userStats.earnedBadgeIds);
    return rewards.filter(r => earned.has(r.id));
  }, [rewards, userStats]);

  const statOptions = useMemo(() => {
    const opts: StatAttachment[] = [];
    if (analytics?.summary) {
      const s = analytics.summary;
      if (s.streakDays > 0) {
        opts.push({ type: 'stat', label: 'Current Streak', value: `${s.streakDays} days`, icon: 'streak' });
      }
      if (s.totalReps > 0) {
        opts.push({ type: 'stat', label: 'Total Reps', value: `${s.totalReps.toLocaleString()}`, icon: 'reps' });
      }
      if (s.workoutCount > 0) {
        const formValues = analytics.formData.values;
        const avgFormScore = formValues.length > 0
          ? Math.round(formValues.reduce((total, value) => total + value, 0) / formValues.length)
          : 0;
        if (avgFormScore > 0) {
          opts.push({ type: 'stat', label: 'Avg Form Score', value: `${avgFormScore}/100`, icon: 'score' });
        }
      }
      if (s.personalBest) {
        opts.push({ type: 'stat', label: `PR — ${s.personalBest.exercise}`, value: `${s.personalBest.weight} lbs`, icon: 'score' });
      }
    }
    return opts;
  }, [analytics]);

  const togglePicker = useCallback((section: PickerSection) => {
    setActivePicker(prev => prev === section ? null : section);
  }, []);

  const handleSelectWorkout = useCallback((w: WorkoutSession) => {
    setAttachment({ type: 'workout', workout: w });
    setActivePicker(null);
  }, []);

  const handleSelectBadge = useCallback((b: Reward) => {
    setAttachment({ type: 'badge', badge: b });
    setActivePicker(null);
  }, []);

  const handleSelectStat = useCallback((s: StatAttachment) => {
    setAttachment(s);
    setActivePicker(null);
  }, []);

  const clearAttachment = useCallback(() => {
    setAttachment(null);
  }, []);

  const canPost = caption.trim().length > 0 || attachment !== null;

  const handlePost = useCallback(async () => {
    if (!canPost || isPosting) return;

    let eventType: ActivityEventType = 'workout_completed';
    let payload: Record<string, unknown> = {};
    let sourceId: string | undefined;

    if (attachment?.type === 'workout') {
      eventType = 'workout_completed';
      payload = {
        form_score: attachment.workout.formScore,
        duration: attachment.workout.duration,
        exercise_count: attachment.workout.totalSets,
        caption: caption.trim() || undefined,
        workout_name: attachment.workout.name,
      };
      sourceId = attachment.workout.id;
    } else if (attachment?.type === 'badge') {
      eventType = 'badge_earned';
      payload = {
        badge_id: attachment.badge.id,
        badge_name: attachment.badge.title,
        caption: caption.trim() || undefined,
      };
      sourceId = attachment.badge.id;
    } else if (attachment?.type === 'stat') {
      eventType = 'personal_record';
      payload = {
        stat_label: attachment.label,
        stat_value: attachment.value,
        caption: caption.trim() || undefined,
      };
    } else {
      // Text-only post — treat as workout_completed with just caption
      eventType = 'workout_completed';
      payload = { caption: caption.trim() };
    }

    const success = await createPost({ eventType, payload, sourceId });
    if (success) {
      navigation.goBack();
    } else {
      showAlert('Post Failed', 'Could not create your post. Please try again.');
    }
  }, [canPost, isPosting, attachment, caption, createPost, navigation, showAlert]);

  const StatIcon = useCallback(({ icon }: { icon: string }) => {
    switch (icon) {
      case 'streak': return <Flame size={14} color="#E07856" strokeWidth={1.5} />;
      case 'reps': return <Dumbbell size={14} color={COLORS.accent} strokeWidth={1.5} />;
      case 'score': return <Target size={14} color="#34E0A6" strokeWidth={1.5} />;
      default: return <Activity size={14} color={COLORS.accent} strokeWidth={1.5} />;
    }
  }, []);

  return (
    <LinearGradient
      colors={[...SCREEN_GRADIENT_COLORS]}
      start={SCREEN_GRADIENT_START}
      end={SCREEN_GRADIENT_END}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={20} color={COLORS.textSecondary} strokeWidth={1.5} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>NEW POST</Text>
            <Text style={styles.headerSubtitle}>Share a workout update</Text>
          </View>
          <TouchableOpacity
            style={styles.postBtnShell}
            onPress={handlePost}
            disabled={!canPost || isPosting}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={canPost ? [COLORS.primary, COLORS.primaryDark] : ['rgba(122, 85, 255, 0.22)', 'rgba(122, 85, 255, 0.12)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.postBtn}
            >
              {isPosting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={[styles.postBtnText, !canPost && styles.postBtnTextDisabled]}>Post</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: getBottomOverlayPadding(insets.bottom, SPACING.xl) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Caption input ── */}
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.composerCard}
          >
            <View style={styles.composerEdge}>
              <View style={styles.composerHeader}>
                <Text style={styles.composerLabel}>Caption</Text>
                <Text style={styles.composerMeta}>{caption.trim().length} chars</Text>
              </View>
              <TextInput
                style={styles.captionInput}
                placeholder="Share how the session went..."
                placeholderTextColor={COLORS.textTertiary}
                value={caption}
                onChangeText={setCaption}
                multiline
                textAlignVertical="top"
                autoFocus
              />
            </View>
          </LinearGradient>

          {/* ── Selected attachment preview ── */}
          {attachment && (
            <View style={styles.attachmentPreview}>
              <LinearGradient
                colors={[...CARD_GRADIENT_COLORS]}
                start={CARD_GRADIENT_START}
                end={CARD_GRADIENT_END}
                style={styles.attachmentGradient}
              >
                <View style={styles.attachmentEdge}>
                  {attachment.type === 'workout' && (
                    <View style={styles.attachmentRow}>
                      <View style={[styles.attachmentIconWrap, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                        <Activity size={16} color={COLORS.accent} strokeWidth={1.5} />
                      </View>
                      <View style={styles.attachmentTextWrap}>
                        <Text style={styles.attachmentTitle} numberOfLines={1}>{attachment.workout.name}</Text>
                        <Text style={styles.attachmentSub}>
                          {attachment.workout.duration} · {attachment.workout.totalReps} reps · Score {attachment.workout.formScore}
                        </Text>
                      </View>
                      <View style={[styles.attachmentScoreBadge, { borderColor: `${getScoreColor(attachment.workout.formScore)}25` }]}>
                        <Text style={[styles.attachmentScoreText, { color: getScoreColor(attachment.workout.formScore) }]}>
                          {attachment.workout.formScore}
                        </Text>
                      </View>
                    </View>
                  )}
                  {attachment.type === 'badge' && (
                    <View style={styles.attachmentRow}>
                      <View style={[styles.attachmentIconWrap, { backgroundColor: `${attachment.badge.color}18` }]}>
                        <Award size={16} color={attachment.badge.color} strokeWidth={1.5} />
                      </View>
                      <View style={styles.attachmentTextWrap}>
                        <Text style={styles.attachmentTitle} numberOfLines={1}>{attachment.badge.title}</Text>
                        <Text style={styles.attachmentSub}>{attachment.badge.description}</Text>
                      </View>
                    </View>
                  )}
                  {attachment.type === 'stat' && (
                    <View style={styles.attachmentRow}>
                      <View style={[styles.attachmentIconWrap, { backgroundColor: 'rgba(52, 211, 153, 0.10)' }]}>
                        <StatIcon icon={attachment.icon} />
                      </View>
                      <View style={styles.attachmentTextWrap}>
                        <Text style={styles.attachmentTitle}>{attachment.label}</Text>
                        <Text style={styles.attachmentSub}>{attachment.value}</Text>
                      </View>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.attachmentRemove}
                    onPress={clearAttachment}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={14} color={COLORS.textTertiary} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          )}

          {/* ── Attach section label ── */}
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>Add to post</Text>
            <Text style={styles.sectionHint}>Optional</Text>
          </View>

          {/* ── Picker buttons ── */}
          <View style={styles.pickerButtons}>
            <PickerButton
              label="Workout"
              icon={<Activity size={15} color={COLORS.accent} strokeWidth={1.5} />}
              active={activePicker === 'workout'}
              onPress={() => togglePicker('workout')}
            />
            <PickerButton
              label="Badge"
              icon={<Award size={15} color="#F5A623" strokeWidth={1.5} />}
              active={activePicker === 'badge'}
              onPress={() => togglePicker('badge')}
            />
            <PickerButton
              label="Stat"
              icon={<TrendingUp size={15} color="#34E0A6" strokeWidth={1.5} />}
              active={activePicker === 'stat'}
              onPress={() => togglePicker('stat')}
            />
          </View>

          {/* ── Workout picker ── */}
          {activePicker === 'workout' && (
            <View style={styles.pickerList}>
              {workoutsLoading ? (
                <ActivityIndicator color={COLORS.primary} style={styles.pickerLoading} />
              ) : workouts.length === 0 ? (
                <Text style={styles.pickerEmpty}>No workouts yet</Text>
              ) : (
                workouts.slice(0, 10).map(w => (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.pickerItem, attachment?.type === 'workout' && (attachment as WorkoutAttachment).workout.id === w.id && styles.pickerItemSelected]}
                    onPress={() => handleSelectWorkout(w)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.pickerItemIcon, { backgroundColor: 'rgba(139, 92, 246, 0.10)' }]}>
                      <Activity size={14} color={COLORS.accent} strokeWidth={1.5} />
                    </View>
                    <View style={styles.pickerItemText}>
                      <Text style={styles.pickerItemTitle} numberOfLines={1}>{w.name}</Text>
                      <Text style={styles.pickerItemSub}>{w.date} · {w.duration}</Text>
                    </View>
                    <View style={[styles.pickerScoreBadge, { borderColor: `${getScoreColor(w.formScore)}25` }]}>
                      <Text style={[styles.pickerScoreText, { color: getScoreColor(w.formScore) }]}>{w.formScore}</Text>
                    </View>
                    {attachment?.type === 'workout' && (attachment as WorkoutAttachment).workout.id === w.id && (
                      <View style={styles.pickerCheck}>
                        <Check size={12} color="#FFFFFF" strokeWidth={3} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* ── Badge picker ── */}
          {activePicker === 'badge' && (
            <View style={styles.pickerList}>
              {rewardsLoading ? (
                <ActivityIndicator color={COLORS.primary} style={styles.pickerLoading} />
              ) : earnedBadges.length === 0 ? (
                <Text style={styles.pickerEmpty}>No badges earned yet</Text>
              ) : (
                earnedBadges.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.pickerItem, attachment?.type === 'badge' && (attachment as BadgeAttachment).badge.id === b.id && styles.pickerItemSelected]}
                    onPress={() => handleSelectBadge(b)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.pickerItemIcon, { backgroundColor: `${b.color}18` }]}>
                      <Award size={14} color={b.color} strokeWidth={1.5} />
                    </View>
                    <View style={styles.pickerItemText}>
                      <Text style={styles.pickerItemTitle} numberOfLines={1}>{b.title}</Text>
                      <Text style={styles.pickerItemSub}>{b.description}</Text>
                    </View>
                    {attachment?.type === 'badge' && (attachment as BadgeAttachment).badge.id === b.id && (
                      <View style={styles.pickerCheck}>
                        <Check size={12} color="#FFFFFF" strokeWidth={3} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* ── Stat picker ── */}
          {activePicker === 'stat' && (
            <View style={styles.pickerList}>
              {statOptions.length === 0 ? (
                <Text style={styles.pickerEmpty}>No stats available yet</Text>
              ) : (
                statOptions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.pickerItem, attachment?.type === 'stat' && attachment.label === s.label && styles.pickerItemSelected]}
                    onPress={() => handleSelectStat(s)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.pickerItemIcon, { backgroundColor: 'rgba(52, 211, 153, 0.10)' }]}>
                      <StatIcon icon={s.icon} />
                    </View>
                    <View style={styles.pickerItemText}>
                      <Text style={styles.pickerItemTitle}>{s.label}</Text>
                      <Text style={styles.pickerItemSub}>{s.value}</Text>
                    </View>
                    {attachment?.type === 'stat' && attachment.label === s.label && (
                      <View style={styles.pickerCheck}>
                        <Check size={12} color="#FFFFFF" strokeWidth={3} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

// ── Picker button sub-component ─────────────────────────────

const PickerButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}> = ({ label, icon, active, onPress }) => (
  <TouchableOpacity
    style={[styles.pickerBtn, active && styles.pickerBtnActive]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    {icon}
    <Text style={[styles.pickerBtnText, active && styles.pickerBtnTextActive]}>{label}</Text>
    <ChevronRight
      size={12}
      color={active ? COLORS.accent : COLORS.textTertiary}
      strokeWidth={1.5}
      style={{ transform: [{ rotate: active ? '90deg' : '0deg' }] }}
    />
  </TouchableOpacity>
);

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    ...PAGE_TITLE_TEXT,
  },
  headerSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  postBtnShell: {
    minWidth: 68,
    borderRadius: 10,
    overflow: 'hidden',
  },
  postBtn: {
    minHeight: 38,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  postBtnText: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0,
  },
  postBtnTextDisabled: {
    color: 'rgba(255, 255, 255, 0.42)',
  },

  /* ── Content ── */
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
  },
  composerCard: {
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 2,
    marginBottom: 14,
    ...CARD_SHADOW,
  },
  composerEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 10,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  composerLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0,
  },
  composerMeta: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  captionInput: {
    fontSize: 15,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    minHeight: 128,
    lineHeight: 21,
    paddingTop: 0,
    paddingBottom: 4,
  },

  /* ── Attachment preview ── */
  attachmentPreview: {
    marginBottom: 14,
    borderRadius: 8,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  attachmentGradient: {
    borderRadius: 8,
  },
  attachmentEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    padding: 14,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachmentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  attachmentTextWrap: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  attachmentTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  attachmentSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  attachmentScoreBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachmentScoreText: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 14,
  },
  attachmentRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Section label ── */
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 2,
    paddingBottom: 9,
  },
  sectionLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0,
  },
  sectionHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },

  /* ── Picker buttons row ── */
  pickerButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
  },
  pickerBtnActive: {
    borderColor: 'rgba(122, 85, 255, 0.46)',
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
  },
  pickerBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  pickerBtnTextActive: {
    color: COLORS.accent,
  },

  /* ── Picker list ── */
  pickerList: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.065)',
    backgroundColor: 'rgba(31, 39, 45, 0.72)',
    overflow: 'hidden',
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  pickerLoading: {
    paddingVertical: SPACING.xl,
  },
  pickerEmpty: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: SPACING.xl,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.045)',
  },
  pickerItemSelected: {
    backgroundColor: 'rgba(122, 85, 255, 0.10)',
  },
  pickerItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  pickerItemText: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  pickerItemTitle: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0,
  },
  pickerItemSub: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  pickerScoreBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    marginRight: SPACING.sm,
  },
  pickerScoreText: {
    fontFamily: FONTS.mono.bold,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
  },
  pickerCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
