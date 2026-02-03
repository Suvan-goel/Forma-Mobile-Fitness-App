/**
 * LoadingSkeleton - Animated placeholder for loading states
 * Uses React Native's built-in Animated API (not Reanimated per CLAUDE.md)
 */

import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Animated, ViewStyle, DimensionValue } from 'react-native';
import { COLORS, CARD_STYLE } from '../../constants/theme';

type SkeletonVariant = 'card' | 'text' | 'circle' | 'button';

interface LoadingSkeletonProps {
  variant?: SkeletonVariant;
  width?: DimensionValue;
  height?: number;
  style?: ViewStyle;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = memo(({
  variant = 'card',
  width,
  height,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();

    return () => animation.stop();
  }, [opacity]);

  const getVariantStyles = (): ViewStyle => {
    switch (variant) {
      case 'card':
        return {
          ...CARD_STYLE,
          width: width ?? '100%',
          height: height ?? 100,
        };
      case 'text':
        return {
          width: width ?? '80%',
          height: height ?? 16,
          borderRadius: 4,
          backgroundColor: COLORS.cardBackground,
        };
      case 'circle':
        const size = height ?? 48;
        return {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: COLORS.cardBackground,
        };
      case 'button':
        return {
          width: width ?? '100%',
          height: height ?? 56,
          borderRadius: 28,
          backgroundColor: COLORS.cardBackground,
        };
      default:
        return {};
    }
  };

  return (
    <Animated.View
      style={[
        styles.base,
        getVariantStyles(),
        { opacity },
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.cardBackground,
  },
});
