/**
 * GlassTabBar — App navigation
 *
 * Full-width bottom dock matching the refined Home reference while preserving
 * the existing tab routes and Capture-centered navigation structure.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Home, BookOpen, BarChart2, Video, Users } from 'lucide-react-native';
import { COLORS, FONTS } from '../../constants/theme';

const TAB_CONFIG: Record<string, { icon: any; label: string }> = {
  Home:      { icon: Home,       label: 'Home' },
  Logbook:   { icon: BookOpen,   label: 'Logbook' },
  Record:    { icon: Video,      label: 'Capture' },
  Analytics: { icon: BarChart2,  label: 'Progress' },
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
      activeOpacity={0.72}
    >
      <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
        <Icon
          size={19}
          color={isFocused ? COLORS.accent : COLORS.textSecondary}
          strokeWidth={isFocused ? 2.2 : 1.7}
        />
      </View>
      <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]} numberOfLines={1}>
        {config.label}
      </Text>
    </TouchableOpacity>
  );
});

export const GlassTabBar = memo(({ state, navigation, onTabChange }: any) => {
  const insets = useSafeAreaInsets();
  const currentTabRoute = state.routes[state.index];
  const focusedRouteName = getFocusedRouteNameFromRoute(currentTabRoute) ?? currentTabRoute?.name;

  const hideTabBar =
    currentTabRoute?.name === 'Record' &&
    (focusedRouteName === 'ChooseExercise' ||
     focusedRouteName === 'WorkoutTemplates' ||
     focusedRouteName === 'Camera' ||
     focusedRouteName === 'CurrentWorkout' ||
     focusedRouteName === 'SaveWorkout' ||
     focusedRouteName === 'WorkoutSettings' ||
     focusedRouteName === 'ExerciseGuide' ||
     focusedRouteName === 'CreateTemplate' ||
     focusedRouteName === 'TemplatePreview');

  React.useEffect(() => {
    if (currentTabRoute?.name && onTabChange) {
      onTabChange(currentTabRoute.name);
    }
  }, [state.index, onTabChange, currentTabRoute?.name]);

  const inner = (
    <View style={[styles.dockContent, { paddingBottom: Math.max(insets.bottom, 10) }]}>
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
    <View style={styles.outerWrap}>
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={26}
          tint="systemUltraThinMaterialDark"
          style={styles.dock}
        >
          {inner}
        </BlurView>
      ) : (
        <View style={[styles.dock, styles.dockAndroid]}>
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
  },
  dock: {
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.075)',
    backgroundColor: 'rgba(16,22,26,0.90)',
  },
  dockAndroid: {
    backgroundColor: 'rgba(15,21,25,0.97)',
  },
  dockContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  tabItem: {
    flex: 1,
    minHeight: 45,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 32,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    transform: [{ translateY: -1 }],
  },
  tabLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9,
    color: COLORS.textSecondary,
  },
  tabLabelActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
  },
});
