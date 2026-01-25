import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, BookOpen, BarChart2, Star, User } from 'lucide-react-native';
import { LogbookScreen } from '../screens/LogbookScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { RewardsScreen } from '../screens/RewardsScreen';
import { TrainerScreen } from '../screens/TrainerScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CameraScreen } from '../screens/CameraScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { WorkoutDetailsScreen } from '../screens/WorkoutDetailsScreen';
import { WorkoutExercisesScreen } from '../screens/WorkoutExercisesScreen';
import { SaveWorkoutScreen } from '../screens/SaveWorkoutScreen';
import { WorkoutInfoScreen } from '../screens/WorkoutInfoScreen';
import { AppHeader } from '../components/ui/AppHeader';
import { COLORS, FONTS } from '../constants/theme';

export type CameraParams = { category?: string } | undefined;

// Define the Root Stack Param List
export type RootStackParamList = {
  Welcome: undefined;
  MainTabs: { screen?: string } | undefined;
  Settings: undefined;
  Camera: CameraParams;
  Insights: { metric: string };
  WorkoutDetails: { workoutId: string };
  WorkoutExercises: { category: string; color: string; iconName: string };
  SaveWorkout: { workoutData: any };
  WorkoutInfo: undefined;
};

export type RootTabParamList = {
  Logbook: undefined;
  Analytics: undefined;
  Record: CameraParams;
  Trainer: undefined;
  Rewards: undefined;
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

// Custom Tab Bar
const CustomTabBar = ({ state, descriptors, navigation, onTabChange }: any) => {
  const insets = useSafeAreaInsets();
  const navBarMargin = insets.bottom > 0 ? insets.bottom - 20 : 0;
  const footerHeight = 80 + navBarMargin + 20; // tab bar height + margin + extra space
  
  const icons: { [key: string]: any } = {
    Record: Video,
    Logbook: BookOpen,
    Analytics: BarChart2,
    Rewards: Star,
    Trainer: User,
  };
  
  // Notify parent of tab changes
  React.useEffect(() => {
    const route = state.routes[state.index];
    if (route?.name && onTabChange) {
      onTabChange(route.name);
    }
  }, [state.index, onTabChange]);

  return (
    <>
      <View style={[styles.tabBar, { marginBottom: navBarMargin }]}>
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const label = route.name;
        const isFocused = state.index === index;
        const Icon = icons[route.name];

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={[styles.tabItem, isFocused && styles.tabItemActive]}
            activeOpacity={0.7}
          >
            <Icon size={22} color={isFocused ? COLORS.primary : COLORS.textSecondary} />
            {isFocused && <Text style={styles.tabLabel}>{label}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
    </>
  );
};

// Bottom Tab Navigator with static header
const AppTabs: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [currentTab, setCurrentTab] = React.useState('Logbook');
  
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, paddingTop: insets.top }}>
      {/* Static Header - Hidden for Record tab */}
      {currentTab !== 'Record' && <AppHeader />}
      
      {/* Tab Navigator */}
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} onTabChange={setCurrentTab} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen name="Logbook" component={LogbookScreen} />
        <Tab.Screen name="Analytics" component={AnalyticsScreen} />
        <Tab.Screen 
          name="Record" 
          component={CameraScreen}
          initialParams={{ category: 'Weightlifting' }}
        />
        <Tab.Screen name="Trainer" component={TrainerScreen} />
        <Tab.Screen name="Rewards" component={RewardsScreen} />
      </Tab.Navigator>
    </View>
  );
};

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
    flexDirection: 'row',
    backgroundColor: '#1E2228',
    borderRadius: 40,
    marginHorizontal: 20,
    height: 80,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 40,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 25,
  },
  tabItemActive: {
    backgroundColor: '#000000',
    paddingHorizontal: 16,
  },
  tabLabel: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    marginLeft: 8,
  },
});

// Root Stack Navigator
export const RootNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="MainTabs" component={AppTabs} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen 
        name="Camera" 
        component={CameraScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
        }}
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
        name="SaveWorkout" 
        component={SaveWorkoutScreen}
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
    </Stack.Navigator>
  );
};
