import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Volume2, VolumeX } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import {
  cancelSpeech,
  createVoiceSnapshot,
  prefetchSpeech,
  setActiveVoiceId,
  setActiveVoiceSettings,
  speakWithElevenLabs,
} from '../../backend/services/elevenlabsTTS';
import { cancelTrainerCuePackWarming, warmTrainerCuePack } from '../../backend/services/ttsCuePack';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

const MALE_TRAINER_IDS = new Set(['malik', 'leo', 'miles', 'theo']);
const FEMALE_TRAINER_IDS = new Set(['ava', 'isla', 'naomi', 'clara']);
const MALE_TRAINERS = TRAINERS.filter((trainer) => MALE_TRAINER_IDS.has(trainer.id));
const FEMALE_TRAINERS = TRAINERS.filter((trainer) => FEMALE_TRAINER_IDS.has(trainer.id));
const PICKER_TRAINERS = [...MALE_TRAINERS, ...FEMALE_TRAINERS];

function getTrainerPreviewGreeting(trainer: Trainer): string {
  return trainer.previewGreeting ?? trainer.greeting;
}

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

  useFocusEffect(
    useCallback(() => {
      PICKER_TRAINERS.forEach((trainer) => {
        const snapshot = createVoiceSnapshot(trainer.voiceId, trainer.voiceSettings);
        prefetchSpeech(getTrainerPreviewGreeting(trainer), snapshot, {
          purpose: 'prefetch',
          timeoutMs: 12000,
        }).catch(() => {});
      });

      return () => {
        cancelSpeech('trainer-preview').catch(() => {});
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      cancelTrainerCuePackWarming();
      const selectedTrainer = TRAINERS.find((trainer) => trainer.id === selectedTrainerId);
      if (selectedTrainer) {
        warmTrainerCuePack({
          trainer: selectedTrainer,
          reason: 'trainer-picker',
        }).catch(() => {});
      }

      return () => {
        cancelTrainerCuePackWarming();
      };
    }, [selectedTrainerId])
  );

  const handleSelectTrainer = (trainer: Trainer) => {
    if (trainer.id !== selectedTrainerId) {
      setSelectedTrainerId(trainer.id);
    }
    setActiveVoiceId(trainer.voiceId);
    setActiveVoiceSettings(trainer.voiceSettings);
    if (greetingEnabled) {
      speakWithElevenLabs(getTrainerPreviewGreeting(trainer), {
        purpose: 'trainer-preview',
        interrupt: true,
      }).catch(() => {});
    }
  };

  const handleToggleGreeting = () => {
    setGreetingEnabled((enabled) => {
      const next = !enabled;
      if (!next) {
        cancelSpeech('trainer-preview').catch(() => {});
      }
      return next;
    });
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
            </View>
            <Text style={styles.trainerDescription}>
              {trainer.description}
            </Text>
          </View>
        </TouchableOpacity>
        {!isLast && <View style={styles.rowDivider} />}
      </View>
    );
  };

  const renderTrainerSection = (title: string, trainers: Trainer[], isFirst = false) => (
    <View style={!isFirst && styles.sectionGroupSpaced}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>{title}</Text>
      </View>
      <LinearGradient
        colors={[...CARD_GRADIENT_COLORS]}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={styles.cardGradient}
      >
        <View style={styles.cardEdge}>
          {trainers.map((trainer, index) =>
            renderTrainerRow(trainer, index, trainers.length)
          )}
        </View>
      </LinearGradient>
    </View>
  );

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader
        title="TRAINER VOICE"
        onBack={() => navigation.goBack()}
        rightSlot={(
          <TouchableOpacity
            style={styles.speakerBtn}
            onPress={handleToggleGreeting}
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

          {renderTrainerSection('MALE VOICES', MALE_TRAINERS, true)}
          {renderTrainerSection('FEMALE VOICES', FEMALE_TRAINERS)}
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 7,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },
  sectionGroupSpaced: {
    marginTop: 12,
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
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.085)',
    borderTopColor: 'rgba(255, 255, 255, 0.13)',
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    marginBottom: 4,
  },
  trainerName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  trainerNameSelected: {
    fontFamily: FONTS.display.regular,
    color: COLORS.text,
  },
  trainerDescription: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 19,
  },
});
