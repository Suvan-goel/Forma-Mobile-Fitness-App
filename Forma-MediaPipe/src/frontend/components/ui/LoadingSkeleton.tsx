/**
 * LoadingSkeleton - Animated placeholder for loading states
 * Uses React Native's built-in Animated API (not Reanimated per CLAUDE.md)
 */

import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Animated, View, ViewStyle, DimensionValue } from 'react-native';
import { COLORS, CARD_RADIUS } from '../../constants/theme';

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
          width: width ?? '100%',
          height: height ?? 100,
          borderRadius: CARD_RADIUS,
        };
      case 'text':
        return {
          width: width ?? '80%',
          height: height ?? 16,
          borderRadius: 4,
        };
      case 'circle':
        const size = height ?? 48;
        return {
          width: size,
          height: size,
          borderRadius: size / 2,
        };
      case 'button':
        return {
          width: width ?? '100%',
          height: height ?? 56,
          borderRadius: 28,
        };
      default:
        return {};
    }
  };

  return (
    <View
      style={[
        styles.base,
        getVariantStyles(),
        style,
      ]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.fill,
          { opacity },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.cardBackground,
  },
});
