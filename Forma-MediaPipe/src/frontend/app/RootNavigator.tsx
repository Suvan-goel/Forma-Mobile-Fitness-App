import React, { memo, useCallback, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, BookOpen, BarChart2, Star } from 'lucide-react-native';
import { GlassTabBar } from '../components/ui/GlassTabBar';
import { LogbookScreen } from '../screens/LogbookScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileSettingsScreen } from '../screens/ProfileSettingsScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { PrivacySettingsScreen } from '../screens/PrivacySettingsScreen';
import { HelpCenterScreen } from '../screens/HelpCenterScreen';
import { TrainerPickerScreen } from '../screens/TrainerPickerScreen';
import { CameraScreen } from '../screens/CameraScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { WorkoutDetailsScreen } from '../screens/WorkoutDetailsScreen';
import { WorkoutExercisesScreen } from '../screens/WorkoutExercisesScreen';
import { SaveWorkoutScreen } from '../screens/SaveWorkoutScreen';
import { WorkoutInfoScreen } from '../screens/WorkoutInfoScreen';
import { RecordLandingScreen } from '../screens/RecordLandingScreen';
import { CurrentWorkoutScreen } from '../screens/CurrentWorkoutScreen';
import { ChooseExerciseScreen } from '../screens/ChooseExerciseScreen';
import { WorkoutTemplatesScreen } from '../screens/WorkoutTemplatesScreen';
import { CameraSettingsScreen } from '../screens/CameraSettingsScreen';
import { ExerciseGuideScreen } from '../screens/ExerciseGuideScreen';
import { OnboardingFlow, ONBOARDING_STORAGE_KEY } from '../screens/OnboardingFlow';
import { CurrentWorkoutProvider, LoggedSet } from '../contexts/CurrentWorkoutContext';
import { CameraSettingsProvider } from '../contexts/CameraSettingsContext';
import { ScrollProvider } from '../contexts/ScrollContext';
import { AlertProvider } from '../contexts/AlertContext';
import { AppHeader } from '../components/ui/AppHeader';
import { AuthProvider, useAuth } from '../../backend/contexts/AuthContext';
import { COLORS, FONTS } from '../constants/theme';

export type CameraParams = { 
  category?: string;
  exerciseName?: string;
  exerciseId?: string;
  returnToCurrentWorkout?: boolean;
} | undefined;

// Define the Root Stack Param List
export type RootStackParamList = {
  Welcome: undefined;
  MainTabs: { screen?: string } | undefined;
  Settings: undefined;
  ProfileSettings: undefined;
  NotificationSettings: undefined;
  PrivacySettings: undefined;
  HelpCenter: undefined;
  TrainerPicker: undefined;
  Camera: CameraParams;
  Insights: { metric: string };
  WorkoutDetails: { workoutId: string };
  WorkoutExercises: { category: string; color: string; iconName: string };
  WorkoutInfo: undefined;
  ExerciseGuide: {
    exerciseName: string;
    category: string;
    viewType: 'SIDE' | 'FRONT' | 'ANY';
    keySetup: string;
    reasonText: string;
  };
  Onboarding: undefined;
};

// Define the Record Stack Param List
export type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: { newSet?: LoggedSet; showWeightFor?: { exerciseId: string } } | undefined;
  ChooseExercise: undefined;
  WorkoutTemplates: undefined;
  Camera: { exerciseName: string; category: string; exerciseId?: string; returnToCurrentWorkout?: true };
  ExerciseGuide: {
    exerciseName: string;
    category: string;
    viewType: 'SIDE' | 'FRONT' | 'ANY';
    keySetup: string;
    reasonText: string;
  };
  SaveWorkout: { workoutData: { category: string; duration: string; totalSets: number; totalReps: number; avgFormScore: number } };
  WorkoutSettings: undefined;
};

export type RootTabParamList = {
  Logbook: undefined;
  Analytics: undefined;
  Record: undefined;
  Rewards: undefined;
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();
const RecordStack = createNativeStackNavigator<RecordStackParamList>();

// Icon mapping - memoized to prevent recreation
const TAB_ICONS: { [key: string]: any } = {
  Record: Video,
  Logbook: BookOpen,
  Analytics: BarChart2,
  Rewards: Star,
};

// Custom Tab Bar Item - memoized for performance
const TabBarItem = memo(({ 
  route, 
  isFocused, 
  onPress 
}: { 
  route: any; 
  isFocused: boolean; 
  onPress: () => void;
}) => {
  const Icon = TAB_ICONS[route.name];
  const label = route.name;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabItem, isFocused ? styles.tabItemActive : styles.tabItemInactive]}
      activeOpacity={0.7}
    >
      <Icon size={22} color={isFocused ? COLORS.primary : COLORS.textSecondary} style={styles.tabIcon} />
      {isFocused && (
        <Text style={styles.tabLabel} numberOfLines={1}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
});

// Record Stack Navigator
const RecordStackNavigator: React.FC = memo(() => {
  return (
    <RecordStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      <RecordStack.Screen name="RecordLanding" component={RecordLandingScreen} />
      <RecordStack.Screen name="CurrentWorkout" component={CurrentWorkoutScreen} />
      <RecordStack.Screen name="ChooseExercise" component={ChooseExerciseScreen} />
      <RecordStack.Screen name="WorkoutTemplates" component={WorkoutTemplatesScreen} />
      <RecordStack.Screen name="Camera" component={CameraScreen} />
      <RecordStack.Screen name="ExerciseGuide" component={ExerciseGuideScreen} />
      <RecordStack.Screen
        name="SaveWorkout"
        component={SaveWorkoutScreen}
        options={{
          contentStyle: { backgroundColor: COLORS.background },
          // No navigator option to disable bottom safe area; strip is filled by contentStyle background.
        }}
      />
      <RecordStack.Screen name="WorkoutSettings" component={CameraSettingsScreen} options={{ headerShown: false }} />
    </RecordStack.Navigator>
  );
});

// Record tab wrapper: current-workout state + shared camera/workout settings
const RecordTabWithProvider: React.FC = memo(() => (
  <CurrentWorkoutProvider>
    <CameraSettingsProvider>
      <RecordStackNavigator />
    </CameraSettingsProvider>
  </CurrentWorkoutProvider>
));

// Custom Tab Bar
const CustomTabBar = memo(({ state, descriptors, navigation, onTabChange }: any) => {
  const insets = useSafeAreaInsets();
  const currentTabRoute = state.routes[state.index];
  const focusedRouteName = getFocusedRouteNameFromRoute(currentTabRoute) ?? currentTabRoute?.name;
  const hideTabBar = currentTabRoute?.name === 'Record' && (focusedRouteName === 'ChooseExercise' || focusedRouteName === 'WorkoutTemplates' || focusedRouteName === 'Camera' || focusedRouteName === 'CurrentWorkout' || focusedRouteName === 'SaveWorkout' || focusedRouteName === 'WorkoutSettings' || focusedRouteName === 'ExerciseGuide');

  // Notify parent of tab changes
  React.useEffect(() => {
    if (currentTabRoute?.name && onTabChange) {
      onTabChange(currentTabRoute.name);
    }
  }, [state.index, onTabChange, currentTabRoute?.name]);

  return (
    <View
      style={[
        styles.tabBar,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          minHeight: 60 + Math.max(insets.bottom, 8),
          display: hideTabBar ? 'none' : 'flex',
        },
      ]}
    >
      <LinearGradient
        colors={['rgba(0, 0, 0, 0)', '#000000']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tabBarContent}>
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
          <TabBarItem
            key={route.key}
            route={route}
            isFocused={isFocused}
            onPress={onPress}
          />
        );
      })}
      </View>
    </View>
  );
});

// Inner component — header is non-collapsible and scrolls with page content
const AppTabsContent: React.FC<{ currentTab: string; onTabChange: (tabName: string) => void }> = memo(({ currentTab, onTabChange }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: currentTab === 'Record' ? 0 : insets.top }}>
      {/* Header - Hidden for Record tab; no collapse/sticky logic */}
      {currentTab !== 'Record' && currentTab !== 'Analytics' && currentTab !== 'Logbook' && currentTab !== 'Rewards' && <AppHeader />}

      <View style={{ flex: 1 }}>
        <Tab.Navigator
          tabBar={(props) => <GlassTabBar {...props} onTabChange={onTabChange} />}
          screenOptions={{
            headerShown: false,
          }}
        >
          <Tab.Screen name="Logbook" component={LogbookScreen} />
          <Tab.Screen name="Analytics" component={AnalyticsScreen} />
          <Tab.Screen name="Record" component={RecordTabWithProvider} />
          <Tab.Screen name="Rewards" component={RewardsScreen} />
        </Tab.Navigator>
      </View>
    </View>
  );
});

// Bottom Tab Navigator with static header
const AppTabs: React.FC = memo(() => {
  const [currentTab, setCurrentTab] = useState('Logbook');
  
  // Memoize tab change handler
  const handleTabChange = useCallback((tabName: string) => {
    setCurrentTab(tabName);
  }, []);
  
  return (
    <ScrollProvider>
      <AppTabsContent currentTab={currentTab} onTabChange={handleTabChange} />
    </ScrollProvider>
  );
});

const styles = StyleSheet.create({
  footerMask: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.background,
    zIndex: 5,
  },
  tabBar: {
    zIndex: 10,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 48,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 40,
    overflow: 'hidden',
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 8,
  },
  tabItem: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 16,
    borderRadius: 25,
  },
  tabItemActive: {
    flex: 2,
    paddingHorizontal: 6,
  },
  tabItemInactive: {
    flex: 0.75,
    paddingHorizontal: 4,
  },
  tabIcon: {
    flexShrink: 0,
  },
  tabLabel: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    marginLeft: 8,
    flexShrink: 1,
  },
});

// Dev-only: wrapper so OnboardingFlow can be pushed onto the stack while logged in
const OnboardingDevScreen: React.FC<{ navigation: any }> = ({ navigation }) => (
  <OnboardingFlow onOnboardingComplete={() => navigation.goBack()} />
);

// Inner navigator — conditionally renders screens based on auth + onboarding state.
// React Navigation automatically navigates to the first available screen
// when the screen list changes (e.g. user signs in → Welcome disappears → MainTabs shown).
const RootStackNavigator: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY).then((value) => {
      setHasOnboarded(value === 'true');
    }).catch(() => {
      setHasOnboarded(false);
    });
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setHasOnboarded(true);
  }, []);

  if (isLoading || hasOnboarded === null) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  // Not logged in + never onboarded → show onboarding flow
  if (!user && !hasOnboarded) {
    return <OnboardingFlow onOnboardingComplete={handleOnboardingComplete} />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="MainTabs" component={AppTabs} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen
            name="ProfileSettings"
            component={ProfileSettingsScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="NotificationSettings"
            component={NotificationSettingsScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="PrivacySettings"
            component={PrivacySettingsScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="HelpCenter"
            component={HelpCenterScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="TrainerPicker"
            component={TrainerPickerScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="Camera"
            component={CameraScreen}
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="ExerciseGuide"
            component={ExerciseGuideScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="Insights"
            component={InsightsScreen}
            options={{
              presentation: 'modal',
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="WorkoutDetails"
            component={WorkoutDetailsScreen}
            options={{
              presentation: 'card',
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="WorkoutExercises"
            component={WorkoutExercisesScreen}
            options={{
              presentation: 'card',
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="WorkoutInfo"
            component={WorkoutInfoScreen}
            options={{
              presentation: 'transparentModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="Onboarding"
            component={OnboardingDevScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
        </>
      ) : (
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
      )}
    </Stack.Navigator>
  );
};

// Root Stack Navigator — wraps everything with AuthProvider
export const RootNavigator: React.FC = () => {
  return (
    <AuthProvider>
      <AlertProvider>
        <RootStackNavigator />
      </AlertProvider>
    </AuthProvider>
  );
};
