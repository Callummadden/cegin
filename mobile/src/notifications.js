// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
// notifications.js — Safe for Expo Go and dev builds
// Uses dynamic require() so expo-notifications is never loaded in Expo Go
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Lazy-load expo-notifications — only resolved on first call, never at import time
let _Notifications = null;
let _loaded = false;
let _channelReady = false;

function N() {
  if (_loaded) return _Notifications;
  _loaded = true;
  if (IS_EXPO_GO) return (_Notifications = null);
  try {
    _Notifications = require('expo-notifications');
    _Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    // Create Android notification channels immediately
    if (Platform.OS === 'android') {
      const imp = _Notifications.AndroidImportance?.MAX ?? 4;
      _Notifications.setNotificationChannelAsync('timers', {
        name: 'Cooking Timers',
        importance: imp,
        sound: 'default',
        vibrationPattern: [0, 500, 500, 500, 500, 500, 500, 500],
        lightColor: '#FF5A26',
      }).then(() => { _channelReady = true; }).catch(() => {});
    } else {
      _channelReady = true;
    }
  } catch {
    _Notifications = null;
  }
  return _Notifications;
}

// Ensure channel + handler are ready — call this at app startup
export async function initNotifications() {
  const n = N();
  if (!n) return;
  // Wait for channel creation on Android
  if (Platform.OS === 'android' && !_channelReady) {
    try {
      const imp = n.AndroidImportance?.MAX ?? 4;
      await n.setNotificationChannelAsync('timers', {
        name: 'Cooking Timers',
        importance: imp,
        sound: 'default',
        vibrationPattern: [0, 500, 500, 500, 500, 500, 500, 500],
        lightColor: '#FF5A26',
      });
      _channelReady = true;
    } catch (e) {
      console.warn('[notifications] Channel creation failed:', e);
    }
  }
  // Check exact alarm permission on Android 12+
  try {
    const { NativeModules } = require('react-native');
    if (NativeModules.ExactAlarm) {
      const canSchedule = await NativeModules.ExactAlarm.canSchedule();
      if (!canSchedule) {
        console.warn('[notifications] Exact alarms not allowed — opening settings');
        NativeModules.ExactAlarm.openSettings();
      }
    }
  } catch (e) {
    // Module not available (Expo Go, older Android)
  }
}

export async function requestPermissions() {
  const n = N();
  if (n) {
    try { await n.requestPermissionsAsync(); } catch {}
  }
}

export async function getPermissionStatus() {
  const n = N();
  if (!n) return 'unavailable';
  try {
    const { status } = await n.getPermissionsAsync();
    return status;
  } catch {
    return 'unavailable';
  }
}

export async function requestPermissionAndGetStatus() {
  const n = N();
  if (!n) return 'unavailable';
  try {
    const { status } = await n.requestPermissionsAsync();
    return status;
  } catch {
    return 'unavailable';
  }
}

export async function getPushToken() {
  const n = N();
  if (!n) return null;

  try {
    const { status } = await n.getPermissionsAsync();
    let finalStatus = status;

    if (status !== 'granted') {
      const { status: newStatus } = await n.requestPermissionsAsync();
      finalStatus = newStatus;
    }

    if (finalStatus !== 'granted') return null;

    const tokenData = await n.getExpoPushTokenAsync();
    return tokenData?.data || null;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(registerFn) {
  const token = await getPushToken();
  if (!token) return null;

  try {
    const deviceName = `${Platform.OS} ${Constants.deviceName || 'unknown'}`;
    await registerFn(token, deviceName);
  } catch {
    // Server offline — token will be registered next time
  }

  return token;
}

export async function scheduleNotification(seconds, title, body) {
  const n = N();
  if (!n) {
    console.warn('[notifications] Module not available');
    return null;
  }
  try {
    const fireAt = new Date(Date.now() + seconds * 1000);
    const id = await n.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        channelId: 'timers',
      },
      trigger: {
        type: n.SchedulableTriggerInputTypes?.DATE ?? 'date',
        date: fireAt,
        channelId: 'timers',
      },
    });
    console.log(`[notifications] Scheduled "${title}" in ${seconds}s → ${id}`);
    return id;
  } catch (e) {
    console.warn('[notifications] scheduleNotification failed:', e?.message || e);
    return null;
  }
}

export async function cancelNotification(id) {
  const n = N();
  if (n && id) {
    try {
      await n.cancelScheduledNotificationAsync(id);
      await n.dismissNotificationAsync(id);
    } catch {}
  }
}

export async function cancelAllNotifications() {
  const n = N();
  if (n) {
    try {
      await n.cancelAllScheduledNotificationsAsync();
      await n.dismissAllNotificationsAsync();
    } catch {}
  }
}
