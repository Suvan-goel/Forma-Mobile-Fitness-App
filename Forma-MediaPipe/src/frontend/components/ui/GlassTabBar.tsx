/**
 * GlassTabBar — opaque graphite bottom navigation
 *
 * - 5 routes: Home, Logbook, Capture (center), Progress (Analytics), Social
 * - Active tab highlights the icon and label.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Home, BookOpen, BarChart2, Video, Users } from 'lucide-react-native';
import { COLORS, FONTS } from '../../constants/theme';
import { getBottomSafePadding } from '../../utils/safeAreaSpacing';

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

  const onPress = useCallback(() => {
    const event = navigation.emit({
      type: 'tabPress',
      target: routeKey,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      if (routeName === 'Record') {
        navigation.navigate('Record', { screen: 'RecordLanding' });
        return;
      }
      navigation.navigate(routeName);
    }
  }, [isFocused, routeKey, routeName, navigation]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tabItem}
      activeOpacity={0.7}
    >
      <Icon
        size={18}
        color={isFocused ? COLORS.accent : COLORS.textTertiary}
        strokeWidth={isFocused ? 2.25 : 1.65}
      />
      <Text style={[styles.label, isFocused && styles.labelActive]}>{config.label}</Text>
    </TouchableOpacity>
  );
});

export const GlassTabBar = memo(({ state, navigation }: any) => {
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
    <View style={[styles.outerWrap, { paddingBottom: getBottomSafePadding(insets.bottom) }]}>
      <View style={styles.bar}>
        {inner}
      </View>
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
    backgroundColor: COLORS.cardBackground,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.075)',
  },
  bar: {
    backgroundColor: COLORS.cardBackground,
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 66,
    paddingTop: 9,
    paddingBottom: 7,
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    paddingVertical: 4,
  },
  label: {
    fontFamily: FONTS.ui.regular,
    fontSize: 9.5,
    color: COLORS.textTertiary,
    letterSpacing: 0,
  },
  labelActive: {
    fontFamily: FONTS.ui.bold,
    color: COLORS.accent,
  },
});
