import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';

type ButtonVariant = 'primary' | 'ghost';

interface NeonButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  title: string;
  variant?: ButtonVariant;
  style?: ViewStyle;
}

export const NeonButton: React.FC<NeonButtonProps> = ({
  title,
  variant = 'primary',
  style,
  onPress,
  disabled,
  testID,
  accessibilityLabel,
  ...props
}) => {
  // Only pass through explicitly allowed TouchableOpacity props
  // This prevents variant and title from leaking through
  const safeProps: Partial<TouchableOpacityProps> = {};
  if (onPress !== undefined) safeProps.onPress = onPress;
  if (disabled !== undefined) safeProps.disabled = Boolean(disabled);
  if (testID !== undefined) safeProps.testID = testID;
  if (accessibilityLabel !== undefined) safeProps.accessibilityLabel = accessibilityLabel;
  
  return (
    <TouchableOpacity
      style={[styles.button, styles[variant], style]}
      activeOpacity={0.8}
      {...safeProps}
    >
      <Text style={[styles.text, styles[`${variant}Text` as keyof typeof styles] as TextStyle]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  primary: {
    backgroundColor: COLORS.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333',
  },
  text: {
    fontFamily: FONTS.ui.bold,
    fontSize: 16,
  },
  primaryText: {
    color: '#000000',
  },
  ghostText: {
    color: COLORS.text,
  },
});

