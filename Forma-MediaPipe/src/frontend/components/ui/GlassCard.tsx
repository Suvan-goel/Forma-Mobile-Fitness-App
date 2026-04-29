/**
 * GlassCard — graphite glass surface used across the app.
 *
 * Renders a subtle vertical gradient with a thin light border and a
 * compact rounded corner. Use as a drop-in container for stat cards,
 * list items, and feature blocks.
 */

import React, { memo } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
} from '../../constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  radius?: number;
  borderColor?: string;
}

export const GlassCard: React.FC<GlassCardProps> = memo(({
  children,
  style,
  innerStyle,
  radius = CARD_RADIUS,
  borderColor = 'rgba(255, 255, 255, 0.09)',
}) => {
  return (
    <View style={[styles.outer, { borderRadius: radius }, style]}>
      <LinearGradient
        colors={CARD_GRADIENT_COLORS}
        start={CARD_GRADIENT_START}
        end={CARD_GRADIENT_END}
        style={[styles.gradient, { borderRadius: radius }]}
      >
        <View style={[styles.edge, { borderRadius: radius, borderColor }, innerStyle]}>
          {children}
        </View>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
  },
  edge: {
    flex: 1,
    borderWidth: 1,
  },
});
