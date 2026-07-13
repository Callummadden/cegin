// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';

// Eager imports — React.lazy + Metro HMR is unreliable on native
// (HMR tries window.location.reload when chunks load → crash)
import RecipeListScreen from './src/screens/RecipeListScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import EditRecipeScreen from './src/screens/EditRecipeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CookModeScreen from './src/screens/CookModeScreen';
import ShoppingListScreen from './src/screens/ShoppingListScreen';
import SetupScreen from './src/screens/SetupScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import MealPlannerScreen from './src/screens/MealPlannerScreen';
import StatsScreen from './src/screens/StatsScreen';
import CookbookScreen from './src/screens/CookbookScreen';
import TerryVisionScreen from './src/screens/TerryVisionScreen';
import ScanRecipeScreen from './src/screens/ScanRecipeScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { RecipeGroup, MealPlanningGroup, CookingGroup, SettingsGroup } from './src/components/ScreenGroups';

// Wrapped screen components — each screen gets its own group-level ErrorBoundary
const wrap = (Group, Screen) => (props) => <Group><Screen {...props} /></Group>;
const WrappedRecipeList    = wrap(RecipeGroup, RecipeListScreen);
const WrappedRecipeDetail  = wrap(RecipeGroup, RecipeDetailScreen);
const WrappedEditRecipe    = wrap(RecipeGroup, EditRecipeScreen);
const WrappedScanRecipe    = wrap(RecipeGroup, ScanRecipeScreen);
const WrappedCookbook      = wrap(RecipeGroup, CookbookScreen);
const WrappedMealPlanner   = wrap(MealPlanningGroup, MealPlannerScreen);
const WrappedShoppingList  = wrap(MealPlanningGroup, ShoppingListScreen);
const WrappedCookMode      = wrap(CookingGroup, CookModeScreen);
const WrappedTerryVision   = wrap(CookingGroup, TerryVisionScreen);
const WrappedSettings      = wrap(SettingsGroup, SettingsScreen);
const WrappedAssistant     = wrap(SettingsGroup, AssistantScreen);
const WrappedStats         = wrap(SettingsGroup, StatsScreen);
const WrappedSetup         = wrap(SettingsGroup, SetupScreen);

import { ThemeProvider, useTheme } from './src/theme';
import { ToastProvider } from './src/components/Toast';
import { AiProvider } from './src/aiContext';
import { TimerProvider } from './src/timerContext';
import GlobalTimerBar from './src/components/GlobalTimerBar';
import { registerForPushNotifications, initNotifications } from './src/notifications';
import { api } from './src/api';
import { connect as wsConnect, disconnect as wsDisconnect, initAppStateListener, removeAppStateListener } from './src/wsSync';

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
      <View style={{ flex: 1 }}>
        <ErrorBoundary>
        <Stack.Navigator screenOptions={{
          headerShown: false,
          animation: 'fade',
          cardStyle: { backgroundColor: colors.background },
          unmountOnBlur: true,
        }}
          initialRouteName={initialRoute}
        >
          {/* Recipes */}
          <Stack.Screen name="RecipeList" component={WrappedRecipeList} />
          <Stack.Screen name="RecipeDetail" component={WrappedRecipeDetail} />
          <Stack.Screen name="EditRecipe" component={WrappedEditRecipe} />
          <Stack.Screen name="ScanRecipe" component={WrappedScanRecipe} />
          <Stack.Screen name="Cookbook" component={WrappedCookbook} />
          {/* Meal Planning */}
          <Stack.Screen name="MealPlanner" component={WrappedMealPlanner} />
          <Stack.Screen name="ShoppingList" component={WrappedShoppingList} />
          {/* Cooking */}
          <Stack.Screen name="CookMode" component={WrappedCookMode} options={{ unmountOnBlur: false }} />
          <Stack.Screen name="TerryVision" component={WrappedTerryVision} />
          {/* Settings & Utilities */}
          <Stack.Screen name="Settings" component={WrappedSettings} />
          <Stack.Screen name="Assistant" component={WrappedAssistant} />
          <Stack.Screen name="Stats" component={WrappedStats} />
          <Stack.Screen name="Setup" component={WrappedSetup} />

        </Stack.Navigator>
        </ErrorBoundary>
        <GlobalTimerBar />
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Initialize notification handler + channel immediately (before any timer starts)
    initNotifications().catch(() => {});

    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/active/) && next.match(/inactive|background/)) {
        // Free image memory cache when app backgrounds
        Image.clearMemoryCache().catch(() => {});
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('setup_complete').then((val) => {
      if (val) {
        setInitialRoute('RecipeList');
        // Register for push notifications (native Android/iOS only, no-op in Expo Go)
        registerForPushNotifications(api.registerPushToken).catch(() => {});
        // Connect WebSocket for real-time sync between devices
        wsConnect();
        initAppStateListener();
      } else {
        setInitialRoute('Setup');
      }
    }).catch(() => {
      setInitialRoute('Setup');
    });

    return () => {
      wsDisconnect();
      removeAppStateListener();
    };
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
          <TimerProvider>
          <ToastProvider>
          <View style={{ flex: 1, backgroundColor: '#0E0E0E' }}>
            <AppNavigator initialRoute={initialRoute} />
          </View>
          </ToastProvider>
          </TimerProvider>
        </AiProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
