import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CircleUserRound, UserRound, Volume2, VolumeX } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  COLORS,
  FONTS,
  SPACING,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_SHADOW
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { TRAINERS, type Trainer } from '../constants/trainers';
import { useCameraSettings } from '../contexts/CameraSettingsContext';
import { setActiveVoiceId, setActiveVoiceSettings, speakWithElevenLabs } from '../../backend/services/elevenlabsTTS';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

const MALE_TRAINERS = TRAINERS.filter((t) => t.gender === 'male');
const FEMALE_TRAINERS = TRAINERS.filter((t) => t.gender === 'female');

export const TrainerPickerScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { selectedTrainerId, setSelectedTrainerId } = useCameraSettings();
  const [greetingEnabled, setGreetingEnabled] = useState(true);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleSelectTrainer = (trainer: Trainer) => {
    if (trainer.id === selectedTrainerId) return;
    setSelectedTrainerId(trainer.id);
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
        {!isLast && <View style={styles.rowDivider} />}
      </View>
    );
  };

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader
        title="TRAINER VOICE"
        onBack={() => navigation.goBack()}
        rightSlot={(
          <TouchableOpacity
            style={styles.speakerBtn}
            onPress={() => setGreetingEnabled((v) => !v)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {greetingEnabled
              ? <Volume2 size={20} color={COLORS.accent} strokeWidth={1.5} />
              : <VolumeX size={20} color={COLORS.textTertiary} strokeWidth={1.5} />
            }
          </TouchableOpacity>
        )}
      />

      <Animated.ScrollView
        style={[styles.scroll, { opacity: fadeAnim }]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 160) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
          <Text style={styles.intro}>
            Choose a trainer whose coaching style fits how you like to train. Your selection sets the voice used for all spoken cues.
          </Text>

          {/* Male Trainers */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <UserRound size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>MALE</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              {MALE_TRAINERS.map((trainer, index) =>
                renderTrainerRow(trainer, index, MALE_TRAINERS.length)
              )}
            </View>
          </LinearGradient>

          {/* Female Trainers */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <CircleUserRound size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>FEMALE</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              {FEMALE_TRAINERS.map((trainer, index) =>
                renderTrainerRow(trainer, index, FEMALE_TRAINERS.length)
              )}
            </View>
          </LinearGradient>
        </Animated.View>
      </Animated.ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  speakerBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Scroll */
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
    marginTop: 18,
    marginBottom: 8,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 7,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },

  /* Cards (matches Home) */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    paddingVertical: 2,
  },

  /* Trainer Rows */
  trainerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  trainerRowFirst: {
    paddingTop: 4,
  },
  trainerRowLast: {
    paddingBottom: 4,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginLeft: 32,
  },

  /* Radio */
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

  /* Trainer Info */
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
    fontFamily: FONTS.display.semibold,
    fontSize: 12.5,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  trainerNameSelected: {
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
  },
  trainerAge: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 20,
  },
  specialtyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.055)',
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
