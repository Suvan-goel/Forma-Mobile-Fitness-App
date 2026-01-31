import React, { memo } from 'react';
import { View, ViewProps, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';

interface GlassCardProps extends ViewProps {
  children?: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = memo(({
  children,
  style,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  accessibilityHint,
  accessibilityValue,
  ...restProps
}) => {
  // Only pass through explicitly allowed ViewProps
  // This prevents any boolean props from being passed as strings
  const safeProps: Partial<ViewProps> = {};
  if (testID !== undefined) safeProps.testID = testID;
  if (accessibilityLabel !== undefined) safeProps.accessibilityLabel = accessibilityLabel;
  if (accessibilityRole !== undefined) safeProps.accessibilityRole = accessibilityRole;
  if (accessibilityState !== undefined) safeProps.accessibilityState = accessibilityState;
  if (accessibilityHint !== undefined) safeProps.accessibilityHint = accessibilityHint;
  if (accessibilityValue !== undefined) safeProps.accessibilityValue = accessibilityValue;
  
  // Use BlurView on iOS, fallback to styled View on Android
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={20}
        tint="dark"
        style={[styles.card, style]}
        {...safeProps}
      >
        {children}
      </BlurView>
    );
  }

  // Fallback for Android and other platforms
  return (
    <View style={[styles.card, styles.fallback, style]} {...safeProps}>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  fallback: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
});

