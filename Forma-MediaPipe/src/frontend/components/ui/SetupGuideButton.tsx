import React, { useRef, useCallback } from 'react';
import {
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS } from '../../constants/theme';

interface SetupGuideButtonProps {
  onPress: () => void;
}

export const SetupGuideButton: React.FC<SetupGuideButtonProps> = ({ onPress }) => {
  const iconColor = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  // Interpolate icon color: 0 → white, 1 → violet
  const animatedColor = iconColor.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.text, COLORS.primary],
  });

  const handlePressIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(iconColor, {
        toValue: 1,
        duration: 80,
        useNativeDriver: false,
      }),
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [iconColor, scale]);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(iconColor, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [iconColor, scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Animated.View style={[styles.container, { transform: [{ scale }] }]}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel="Exercise setup guide"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Animated.Text style={[styles.icon, { color: animatedColor }]}>
          ?
        </Animated.Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
