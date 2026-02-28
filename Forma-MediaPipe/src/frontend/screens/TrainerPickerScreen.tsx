import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, CircleUserRound, UserRound, Volume2, VolumeX } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { TRAINERS, type Trainer } from '../constants/trainers';
import { useWorkoutPreferences } from '../../backend/hooks';
import { setActiveVoiceId, setActiveVoiceSettings, speakWithElevenLabs } from '../../backend/services/elevenlabsTTS';

const MALE_TRAINERS = TRAINERS.filter((t) => t.gender === 'male');
const FEMALE_TRAINERS = TRAINERS.filter((t) => t.gender === 'female');

export const TrainerPickerScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { prefs, updatePref } = useWorkoutPreferences();
  const selectedTrainerId = prefs.selectedTrainerId;
  const [greetingEnabled, setGreetingEnabled] = useState(true);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleSelectTrainer = (trainer: Trainer) => {
    if (trainer.id === selectedTrainerId) return;
    updatePref('selectedTrainerId', trainer.id);
    // Switch the voice immediately so the greeting plays in the right voice
    setActiveVoiceId(trainer.voiceId);
    setActiveVoiceSettings(trainer.voiceSettings);
    if (greetingEnabled) {
      speakWithElevenLabs(trainer.greeting).catch(() => {});
    }
  };

  const renderTrainerRow = (trainer: Trainer, index: number, total: number) => {
    const isSelected = trainer.id === selectedTrainerId;
    const isFirst = index === 0;
    const isLast = index === total - 1;

    return (
      <View key={trainer.id}>
        <TouchableOpacity
          style={[styles.trainerRow, isFirst && styles.trainerRowFirst, isLast && styles.trainerRowLast]}
          onPress={() => handleSelectTrainer(trainer)}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, isSelected && styles.radioSelected]}>
            {isSelected && <View style={styles.radioInner} />}
          </View>

          <View style={styles.trainerInfo}>
            <View style={styles.trainerMeta}>
              <Text style={[styles.trainerName, isSelected && styles.trainerNameSelected]}>
                {trainer.name}
              </Text>
              <Text style={styles.trainerAge}>{trainer.age}</Text>
              <View style={[styles.specialtyBadge, isSelected && styles.specialtyBadgeSelected]}>
                <Text style={[styles.specialtyText, isSelected && styles.specialtyTextSelected]}>
                  {trainer.specialty}
                </Text>
              </View>
            </View>
            <Text style={styles.trainerDescription}>{trainer.description}</Text>
          </View>
        </TouchableOpacity>
        {!isLast && <View style={styles.rowSeparator} />}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── HEADER ─────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>YOUR TRAINER</Text>
        <TouchableOpacity
          style={styles.speakerButton}
          onPress={() => setGreetingEnabled((v) => !v)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {greetingEnabled
            ? <Volume2 size={20} color={COLORS.accent} strokeWidth={1.5} />
            : <VolumeX size={20} color={COLORS.textTertiary} strokeWidth={1.5} />
          }
        </TouchableOpacity>
      </View>

      <Animated.ScrollView
        style={[styles.scroll, { opacity: fadeAnim }]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SPACING.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Choose a trainer whose coaching style fits how you like to train. Your selection sets the voice used for all spoken cues.
        </Text>

        {/* ── MALE TRAINERS ─────────────────────── */}
        <View style={styles.sectionHeader}>
          <UserRound size={14} color={COLORS.accent} strokeWidth={1.5} />
          <Text style={styles.sectionTitle}>Male</Text>
        </View>
        <View style={styles.cardOuter}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardInner}>
              {MALE_TRAINERS.map((trainer, index) =>
                renderTrainerRow(trainer, index, MALE_TRAINERS.length)
              )}
            </View>
          </LinearGradient>
        </View>

        {/* ── FEMALE TRAINERS ───────────────────── */}
        <View style={styles.sectionHeader}>
          <CircleUserRound size={14} color={COLORS.accent} strokeWidth={1.5} />
          <Text style={styles.sectionTitle}>Female</Text>
        </View>
        <View style={styles.cardOuter}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardInner}>
              {FEMALE_TRAINERS.map((trainer, index) =>
                renderTrainerRow(trainer, index, FEMALE_TRAINERS.length)
              )}
            </View>
          </LinearGradient>
        </View>
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: 2,
  },
  speakerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },

  /* ── Scroll ──────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
  },
  intro: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },

  /* ── Section Headers ─────────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  /* ── Card ────────────────────────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    marginBottom: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardInner: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    overflow: 'hidden',
  },

  /* ── Trainer Rows ────────────────────────── */
  trainerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
  },
  trainerRowFirst: {
    paddingTop: SPACING.sm,
  },
  trainerRowLast: {
    paddingBottom: SPACING.sm,
  },
  rowSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginLeft: 32,
  },

  /* ── Radio ───────────────────────────────── */
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginRight: 14,
    flexShrink: 0,
  },
  radioSelected: {
    borderColor: COLORS.accent,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.accent,
  },

  /* ── Trainer Info ────────────────────────── */
  trainerInfo: {
    flex: 1,
  },
  trainerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  trainerName: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  trainerNameSelected: {
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
  },
  trainerAge: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 20,
  },
  specialtyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  specialtyBadgeSelected: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  specialtyText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  specialtyTextSelected: {
    color: '#A78BFA',
  },
  trainerDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 19,
  },
});
