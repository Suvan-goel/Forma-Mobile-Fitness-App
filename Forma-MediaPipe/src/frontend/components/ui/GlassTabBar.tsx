/**
 * GlassTabBar — graphite glass bottom navigation
 *
 * - 5 routes: Home, Logbook, Capture (center), Progress (Analytics), Social
 * - Active tab highlights the icon and shows the label below.
 * - Center "Capture" route gets a slightly brighter treatment to match the
 *   design reference (where Capture is the primary action).
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Home, BookOpen, BarChart2, Video, Users } from 'lucide-react-native';
import { COLORS, FONTS } from '../../constants/theme';

const TAB_CONFIG: Record<string, { icon: any; label: string }> = {
  Home:      { icon: Home,       label: 'Today' },
  Logbook:   { icon: BookOpen,   label: 'Logbook' },
  Analytics: { icon: BarChart2,  label: 'Progress' },
  Record:    { icon: Video,      label: 'Capture' },
  Social:    { icon: Users,      label: 'Social' },
};

const GlassTabItem = memo(({ routeName, routeKey, isFocused, navigation }: {
  routeName: string;
  routeKey: string;
  isFocused: boolean;
  navigation: any;
}) => {
  const config = TAB_CONFIG[routeName] || { icon: Users, label: routeName };
  const Icon = config.icon;
  const isCapture = routeName === 'Record';

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

  // Center Capture button — purple pill regardless of state
  if (isCapture) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={styles.captureWrap}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={['#7C5CFF', '#6746E8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.captureBubble}
        >
          <Icon size={22} color="#FFFFFF" strokeWidth={2} />
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tabItem}
      activeOpacity={0.7}
    >
      <Icon
        size={20}
        color={isFocused ? COLORS.accent : COLORS.textTertiary}
        strokeWidth={isFocused ? 2.2 : 1.8}
      />
      <Text style={[styles.label, isFocused && styles.labelActive]}>{config.label}</Text>
    </TouchableOpacity>
  );
});

export const GlassTabBar = memo(({ state, navigation, onTabChange }: any) => {
  const insets = useSafeAreaInsets();
  const currentTabRoute = state.routes[state.index];
  const focusedRouteName = getFocusedRouteNameFromRoute(currentTabRoute) ?? currentTabRoute?.name;

  const hideTabBar =
    currentTabRoute?.name === 'Social' ||
    (currentTabRoute?.name === 'Record' &&
    (focusedRouteName === 'ChooseExercise' ||
     focusedRouteName === 'WorkoutTemplates' ||
     focusedRouteName === 'Camera' ||
     focusedRouteName === 'CurrentWorkout' ||
     focusedRouteName === 'SaveWorkout' ||
     focusedRouteName === 'WorkoutSettings' ||
     focusedRouteName === 'ExerciseGuide' ||
     focusedRouteName === 'CreateTemplate' ||
     focusedRouteName === 'TemplatePreview'));

  React.useEffect(() => {
    if (currentTabRoute?.name && onTabChange) {
      onTabChange(currentTabRoute.name);
    }
  }, [state.index, onTabChange, currentTabRoute?.name]);

  const inner = (
    <View style={styles.barContent}>
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
    <View style={[styles.outerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={60}
          tint="systemUltraThinMaterialDark"
          style={styles.bar}
        >
          {inner}
        </BlurView>
      ) : (
        <View style={[styles.bar, styles.barAndroid]}>
          {inner}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  outerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: 'rgba(15, 20, 25, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  bar: {
    overflow: 'hidden',
  },
  barAndroid: {
    backgroundColor: 'rgba(20, 26, 32, 0.96)',
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 3,
  },
  captureWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  label: {
    fontFamily: FONTS.ui.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.2,
  },
  labelActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
  },
});
