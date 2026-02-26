import React, { useRef, useCallback } from 'react';
import {
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
  View,
  Text,
} from 'react-native';
import { BlurView } from 'expo-blur';
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
        {Platform.OS === 'ios' ? (
          <BlurView intensity={20} tint="dark" style={styles.blurFill}>
            <View style={styles.innerOverlay}>
              <Animated.Text style={[styles.icon, { color: animatedColor }]}>
                ?
              </Animated.Text>
            </View>
          </BlurView>
        ) : (
          <View style={[styles.blurFill, styles.androidFallback]}>
            <Animated.Text style={[styles.icon, { color: animatedColor }]}>
              ?
            </Animated.Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const SIZE = 36; // Match existing settingsButton size in CameraScreen

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  blurFill: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerOverlay: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidFallback: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  icon: {
    fontFamily: FONTS.display.bold,
    fontSize: 17,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
