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
import { BookOpen, BarChart2, Video, Star } from 'lucide-react-native';
import { COLORS, FONTS } from '../../constants/theme';

// Icon + label config for each tab
const TAB_CONFIG: Record<string, { icon: any; label: string }> = {
  Logbook:   { icon: BookOpen,  label: 'Logbook' },
  Analytics: { icon: BarChart2,  label: 'Analytics' },
  Record:    { icon: Video,      label: 'Record' },
  Rewards:   { icon: Star,       label: 'Rewards' },
};

/** Single tab item */
const GlassTabItem = memo(({ routeName, isFocused, onPress }: {
  routeName: string;
  isFocused: boolean;
  onPress: () => void;
}) => {
  const config = TAB_CONFIG[routeName] || { icon: Star, label: routeName };
  const Icon = config.icon;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tabItem}
      activeOpacity={0.7}
    >
      <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
        <Icon
          size={20}
          color={isFocused ? COLORS.background : COLORS.textSecondary}
        />
      </View>
      <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
        {config.label}
      </Text>
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
    currentTabRoute?.name === 'Record' &&
    (focusedRouteName === 'ChooseExercise' ||
     focusedRouteName === 'Camera' ||
     focusedRouteName === 'CurrentWorkout' ||
     focusedRouteName === 'SaveWorkout');

  // Notify parent of tab changes
  React.useEffect(() => {
    if (currentTabRoute?.name && onTabChange) {
      onTabChange(currentTabRoute.name);
    }
  }, [state.index, onTabChange, currentTabRoute?.name]);

  const bottomOffset = Math.max(insets.bottom, 12) + 8;

  // Build inner BEFORE any early return so hooks inside .map() always run
  const inner = (
    <View style={styles.pillContent}>
      {state.routes.map((route: any, index: number) => {
        const isFocused = state.index === index;

        const onPress = useCallback(() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }, [isFocused, route.key, route.name]);

        return (
          <GlassTabItem
            key={route.key}
            routeName={route.name}
            isFocused={isFocused}
            onPress={onPress}
          />
        );
      })}
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
    // Subtle shadow beneath the pill
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  pill: {
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  pillAndroid: {
    backgroundColor: 'rgba(28, 28, 30, 0.92)',
  },
  pillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    minWidth: 40,
    minHeight: 40,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: COLORS.accent,
    // Neon glow behind active icon
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  },
  tabLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
  },
  tabLabelActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
});
