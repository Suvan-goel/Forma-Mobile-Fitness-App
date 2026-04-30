import React, { memo, useCallback, useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlassTabBar } from '../components/ui/GlassTabBar';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { HomeScreen } from '../screens/HomeScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { SocialScreen } from '../screens/SocialScreen';
import { AddFriendScreen } from '../screens/social/AddFriendScreen';
import { FriendProfileScreen } from '../screens/social/FriendProfileScreen';
import { FriendComparisonScreen } from '../screens/social/FriendComparisonScreen';
import { FollowListScreen } from '../screens/social/FollowListScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileSettingsScreen } from '../screens/ProfileSettingsScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { PrivacySettingsScreen } from '../screens/PrivacySettingsScreen';
import { HelpCenterScreen } from '../screens/HelpCenterScreen';
import { TrainerPickerScreen } from '../screens/TrainerPickerScreen';
import { MembershipScreen } from '../screens/MembershipScreen';
import { CameraScreen } from '../screens/CameraScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { WorkoutDetailsScreen } from '../screens/WorkoutDetailsScreen';
import { WorkoutExercisesScreen } from '../screens/WorkoutExercisesScreen';
import { SaveWorkoutScreen } from '../screens/SaveWorkoutScreen';
import { WorkoutInfoScreen } from '../screens/WorkoutInfoScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { UserProfileScreen } from '../screens/UserProfileScreen';
import { TutorialsScreen } from '../screens/TutorialsScreen';
import { RecordLandingScreen } from '../screens/RecordLandingScreen';
import { CurrentWorkoutScreen } from '../screens/CurrentWorkoutScreen';
import { ChooseExerciseScreen } from '../screens/ChooseExerciseScreen';
import { WorkoutTemplatesScreen } from '../screens/WorkoutTemplatesScreen';
import { CameraSettingsScreen } from '../screens/CameraSettingsScreen';
import { ExerciseGuideScreen } from '../screens/ExerciseGuideScreen';
import { VideoLibraryScreen } from '../screens/VideoLibraryScreen';
import { CreateActivityPostScreen } from '../screens/CreateActivityPostScreen';
import { CreateTemplateScreen } from '../screens/CreateTemplateScreen';
import { TemplatePreviewScreen } from '../screens/TemplatePreviewScreen';
import { OnboardingFlow, ONBOARDING_STORAGE_KEY } from '../screens/OnboardingFlow';
import { OnboardingAuth } from '../screens/OnboardingAuth';
import { CurrentWorkoutProvider, LoggedSet } from '../contexts/CurrentWorkoutContext';
import { CameraSettingsProvider } from '../contexts/CameraSettingsContext';
import { ScrollProvider } from '../contexts/ScrollContext';
import { AlertProvider } from '../contexts/AlertContext';
import { AuthProvider, useAuth } from '../../backend/contexts/AuthContext';
import { COLORS } from '../constants/theme';

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
  Membership: undefined;
  Camera: { category?: string; exerciseName?: string; exerciseId?: string; returnToCurrentWorkout?: boolean } | undefined;
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
    cameraTips: string[];
  };
  FriendProfile: { userId: string };
  FriendComparison: { friendId: string };
  AddFriend: undefined;
  FollowList: { mode: 'followers' | 'following' };
  Rewards: undefined;
  UserProfile: undefined;
  Tutorials: undefined;
  VideoLibrary: undefined;
  CreateActivityPost: undefined;
  Onboarding: undefined;
};

// Define the Record Stack Param List
export type RecordStackParamList = {
  RecordLanding: undefined;
  CurrentWorkout: {
    newSet?: LoggedSet;
    showWeightFor?: { exerciseId: string; hasRecording?: boolean };
  } | undefined;
  ChooseExercise: { mode?: 'template' } | undefined;
  WorkoutTemplates: undefined;
  CreateTemplate: undefined;
  TemplatePreview: {
    templateName: string;
    description?: string;
    exercises: { name: string; category: string; targetSets: number }[];
  };
  Camera: { exerciseName: string; category: string; exerciseId?: string; returnToCurrentWorkout?: true };
  ExerciseGuide: {
    exerciseName: string;
    category: string;
    viewType: 'SIDE' | 'FRONT' | 'ANY';
    keySetup: string;
    reasonText: string;
    cameraTips: string[];
  };
  SaveWorkout: { workoutData: { category: string; duration: string; totalSets: number; totalReps: number; avgFormScore: number } };
  WorkoutSettings: undefined;
};

export type RootTabParamList = {
  Home: undefined;
  Logbook: undefined;
  Analytics: undefined;
  Record: undefined;
  Social: undefined;
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();
const RecordStack = createNativeStackNavigator<RecordStackParamList>();

// Record Stack Navigator
const RecordStackNavigator: React.FC = memo(() => {
  return (
    <RecordStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: 'slide_from_right',
      }}
    >
      <RecordStack.Screen name="RecordLanding" component={RecordLandingScreen} />
      <RecordStack.Screen name="CurrentWorkout" component={CurrentWorkoutScreen} />
      <RecordStack.Screen name="ChooseExercise" component={ChooseExerciseScreen} />
      <RecordStack.Screen name="WorkoutTemplates" component={WorkoutTemplatesScreen} />
      <RecordStack.Screen name="CreateTemplate" component={CreateTemplateScreen} />
      <RecordStack.Screen name="TemplatePreview" component={TemplatePreviewScreen} />
      <RecordStack.Screen
        name="Camera"
        component={CameraScreen}
        options={{
          animation: 'slide_from_bottom',
        }}
      />
      <RecordStack.Screen name="ExerciseGuide" component={ExerciseGuideScreen} />
      <RecordStack.Screen
        name="SaveWorkout"
        component={SaveWorkoutScreen}
        options={{
          contentStyle: { backgroundColor: 'transparent' },
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

// Inner component — renders the tab navigator within the shared screen background
const AppTabsContent: React.FC = memo(() => {
  const insets = useSafeAreaInsets();

  return (
    <ScreenBackground style={{ paddingTop: insets.top }}>
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          tabBar={(props) => <GlassTabBar {...props} />}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Logbook" component={LogbookScreen} />
          <Tab.Screen name="Record" component={RecordTabWithProvider} />
          <Tab.Screen name="Analytics" component={AnalyticsScreen} />
          <Tab.Screen name="Social" component={SocialScreen} />
        </Tab.Navigator>
      </View>
    </ScreenBackground>
  );
});

// Bottom Tab Navigator
const AppTabs: React.FC = memo(() => (
  <ScrollProvider>
    <AppTabsContent />
  </ScrollProvider>
));

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
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  // Not logged in + never onboarded → show onboarding flow
  if (!user && !hasOnboarded) {
    return <OnboardingFlow onOnboardingComplete={handleOnboardingComplete} />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
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
            name="Membership"
            component={MembershipScreen}
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
            name="FriendProfile"
            component={FriendProfileScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="FriendComparison"
            component={FriendComparisonScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="AddFriend"
            component={AddFriendScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="FollowList"
            component={FollowListScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="Rewards"
            component={RewardsScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="UserProfile"
            component={UserProfileScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="Tutorials"
            component={TutorialsScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="VideoLibrary"
            component={VideoLibraryScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="CreateActivityPost"
            component={CreateActivityPostScreen}
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          {__DEV__ && (
            <Stack.Screen
              name="Onboarding"
              component={OnboardingDevScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
          )}
        </>
      ) : (
        <Stack.Screen name="Welcome" component={OnboardingAuth} />
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
