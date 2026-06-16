import { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RecipeListScreen from './src/screens/RecipeListScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import EditRecipeScreen from './src/screens/EditRecipeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import CookModeScreen from './src/screens/CookModeScreen';
import ShoppingListScreen from './src/screens/ShoppingListScreen';
import MealPlannerScreen from './src/screens/MealPlannerScreen';
import StatsScreen from './src/screens/StatsScreen';
import CookbookScreen from './src/screens/CookbookScreen';
import TerryVisionScreen from './src/screens/TerryVisionScreen';
import SetupScreen from './src/screens/SetupScreen';

import { ThemeProvider, useTheme } from './src/theme';
import { ToastProvider } from './src/components/Toast';
import { AiProvider } from './src/aiContext';
import { registerForPushNotifications } from './src/notifications';
import { api } from './src/api';

const Stack = createNativeStackNavigator();

function AppNavigator({ initialRoute }) {
  const { colors, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack.Navigator screenOptions={{
        headerShown: false,
        animation: 'fade',
        cardStyle: { backgroundColor: colors.background },
      }}
        initialRouteName={initialRoute}
      >
        <Stack.Screen name="RecipeList" component={RecipeListScreen} />
        <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
        <Stack.Screen name="EditRecipe" component={EditRecipeScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Assistant" component={AssistantScreen} />
        <Stack.Screen name="CookMode" component={CookModeScreen} />
        <Stack.Screen name="ShoppingList" component={ShoppingListScreen} />
        <Stack.Screen name="MealPlanner" component={MealPlannerScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="Cookbook" component={CookbookScreen} />
        <Stack.Screen name="TerryVision" component={TerryVisionScreen} />
        <Stack.Screen name="Setup" component={SetupScreen} />

      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem('setup_complete').then((val) => {
      if (val) {
        setInitialRoute('RecipeList');
        // Register for push notifications (native Android/iOS only, no-op in Expo Go)
        registerForPushNotifications(api.registerPushToken).catch(() => {});
      } else {
        setInitialRoute('Setup');
      }
    }).catch(() => {
      setInitialRoute('Setup');
    });
  }, []);

  if (!initialRoute) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#0E0E0E', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#FF5A26" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AiProvider>
          <ToastProvider>
          <View style={{ flex: 1, backgroundColor: '#0E0E0E' }}>
            <AppNavigator initialRoute={initialRoute} />
          </View>
          </ToastProvider>
        </AiProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
