/**
 * ScreenBackground — graphite vertical gradient that fills the screen.
 *
 * Wrap top-level screens with this to apply the consistent dark-graphite
 * background. Children render on top of the gradient.
 */

import React, { memo } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  COLORS,
  SCREEN_GRADIENT_COLORS,
  SCREEN_GRADIENT_START,
  SCREEN_GRADIENT_END,
} from '../../constants/theme';

interface ScreenBackgroundProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const ScreenBackground: React.FC<ScreenBackgroundProps> = memo(({ children, style }) => {
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={SCREEN_GRADIENT_COLORS}
        start={SCREEN_GRADIENT_START}
        end={SCREEN_GRADIENT_END}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
