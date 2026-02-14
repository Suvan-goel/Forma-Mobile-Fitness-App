import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Keyboard,
} from 'react-native';
import { X } from 'lucide-react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

interface WeightInputModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (weight: number, unit: 'kg' | 'lbs') => void;
  initialWeight?: number;
  initialUnit?: 'kg' | 'lbs';
  exerciseName?: string;
  setNumber?: number;
}

export const WeightInputModal: React.FC<WeightInputModalProps> = ({
  visible,
  onClose,
  onSubmit,
  initialWeight,
  initialUnit = 'kg',
  exerciseName,
  setNumber,
}) => {
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>(initialUnit);

  useEffect(() => {
    if (visible) {
      setWeight(initialWeight ? String(initialWeight) : '');
      setUnit(initialUnit);
    }
  }, [visible, initialWeight, initialUnit]);

  const handleSubmit = () => {
    const weightNum = parseFloat(weight);
    if (!isNaN(weightNum) && weightNum > 0) {
      onSubmit(weightNum, unit);
      setWeight('');
      onClose();
    } else if (weight === '' || weightNum === 0) {
      // Allow submitting 0 or empty to clear weight
      onSubmit(0, unit);
      setWeight('');
      onClose();
    }
  };

  const handleSkip = () => {
    setWeight('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={() => {
          Keyboard.dismiss();
          handleSkip();
        }}
      >
        <TouchableOpacity
          style={styles.modalContent}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={styles.title}>
              {initialWeight !== undefined && initialWeight > 0 ? 'Edit Weight' : 'Add Weight'}
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleSkip}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {exerciseName && setNumber && (
            <Text style={styles.subtitle}>
              {exerciseName} • Set {setNumber}
            </Text>
          )}

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textTertiary}
              autoFocus
              selectTextOnFocus
            />
            
            <View style={styles.unitToggle}>
              <TouchableOpacity
                style={[styles.unitButton, unit === 'kg' && styles.unitButtonActive]}
                onPress={() => setUnit('kg')}
                activeOpacity={0.7}
              >
                <Text style={[styles.unitText, unit === 'kg' && styles.unitTextActive]}>
                  kg
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitButton, unit === 'lbs' && styles.unitButtonActive]}
                onPress={() => setUnit('lbs')}
                activeOpacity={0.7}
              >
                <Text style={[styles.unitText, unit === 'lbs' && styles.unitTextActive]}>
                  lbs
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              activeOpacity={0.7}
            >
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSubmit}
              activeOpacity={0.7}
            >
              <Text style={styles.submitButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    paddingBottom: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: 18,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    flex: 1,
  },
  closeButton: {
    padding: SPACING.xs,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  inputContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  input: {
    fontSize: 48,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    textAlign: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
    marginBottom: SPACING.lg,
  },
  unitToggle: {
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
  },
  unitButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(128, 128, 128, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(0, 172, 124, 0.12)',
  },
  unitText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
  },
  unitTextActive: {
    color: COLORS.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  skipButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: COLORS.textSecondary,
  },
  submitButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: '#000000',
  },
});
