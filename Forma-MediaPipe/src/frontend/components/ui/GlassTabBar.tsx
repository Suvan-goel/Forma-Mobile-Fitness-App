/**
 * GlassTabBar — Floating glass-morphism pill navigation
 *
 * Absolute-positioned at the bottom of the screen. Uses expo-blur
 * on iOS for the frosted glass effect, with a dark fallback on Android.
 * Active tab gets an acid-lime glow circle behind its icon.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Home, BookOpen, BarChart2, Video, Users } from 'lucide-react-native';
import { COLORS, FONTS } from '../../constants/theme';

// Icon + label config for each tab
const TAB_CONFIG: Record<string, { icon: any; label: string }> = {
  Home:      { icon: Home,       label: 'Home' },
  Logbook:   { icon: BookOpen,   label: 'Logbook' },
  Analytics: { icon: BarChart2,  label: 'Analytics' },
  Record:    { icon: Video,      label: 'Capture' },
  Social:    { icon: Users,      label: 'Social' },
};

/** Single tab item */
const GlassTabItem = memo(({ routeName, routeKey, isFocused, navigation }: {
  routeName: string;
  routeKey: string;
  isFocused: boolean;
  navigation: any;
}) => {
  const config = TAB_CONFIG[routeName] || { icon: Users, label: routeName };
  const Icon = config.icon;

  const onPress = useCallback(() => {
    const event = navigation.emit({
      type: 'tabPress',
      target: routeKey,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(routeName);
    }
  }, [isFocused, routeKey, routeName, navigation]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tabItem}
      activeOpacity={0.7}
    >
      <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
        <Icon
          size={20}
          color={isFocused ? '#FFFFFF' : COLORS.textSecondary}
        />
        {isFocused && (
          <Text style={styles.activeLabel}>{config.label}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

/** The full floating tab bar */
export const GlassTabBar = memo(({ state, navigation, onTabChange }: any) => {
  const insets = useSafeAreaInsets();
  const currentTabRoute = state.routes[state.index];
  const focusedRouteName = getFocusedRouteNameFromRoute(currentTabRoute) ?? currentTabRoute?.name;

  // Hide on certain Record sub-screens
  const hideTabBar =
    (currentTabRoute?.name === 'Record' &&
    (focusedRouteName === 'ChooseExercise' ||
     focusedRouteName === 'WorkoutTemplates' ||
     focusedRouteName === 'Camera' ||
     focusedRouteName === 'CurrentWorkout' ||
     focusedRouteName === 'SaveWorkout' ||
     focusedRouteName === 'WorkoutSettings' ||
     focusedRouteName === 'ExerciseGuide'));

  // Notify parent of tab changes
  React.useEffect(() => {
    if (currentTabRoute?.name && onTabChange) {
      onTabChange(currentTabRoute.name);
    }
  }, [state.index, onTabChange, currentTabRoute?.name]);

  const bottomOffset = Math.max(insets.bottom, 12) + 8;

  const inner = (
    <View style={styles.pillContent}>
      {state.routes.map((route: any, index: number) => (
        <GlassTabItem
          key={route.key}
          routeName={route.name}
          routeKey={route.key}
          isFocused={state.index === index}
          navigation={navigation}
        />
      ))}
    </View>
  );

  if (hideTabBar) return null;

  return (
    <View style={[styles.outerWrap, { bottom: bottomOffset }]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={40}
          tint="systemUltraThinMaterialDark"
          style={styles.pill}
        >
          {inner}
        </BlurView>
      ) : (
        <View style={[styles.pill, styles.pillAndroid]}>
          {inner}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  outerWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  pill: {
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  pillAndroid: {
    backgroundColor: 'rgba(28, 28, 30, 0.92)',
  },
  pillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 15,
    paddingHorizontal: 8,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    height: 36,
    minHeight: 36,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingHorizontal: 14,
  },
  activeLabel: {
    fontFamily: FONTS.ui.bold,
    fontSize: 11,
    color: COLORS.text,
    marginLeft: 6,
    letterSpacing: 0.3,
  },
});
