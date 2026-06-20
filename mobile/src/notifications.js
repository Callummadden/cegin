// notifications.js — Safe for Expo Go and dev builds
// Uses dynamic require() so expo-notifications is never loaded in Expo Go
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Lazy-load expo-notifications — only resolved on first call, never at import time
let _Notifications = null;
let _loaded = false;

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
  } catch {
    _Notifications = null;
  }
  return _Notifications;
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
  if (!n) return null;
  try {
    return await n.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { seconds },
    });
  } catch {
    return null;
  }
}

export async function cancelNotification(id) {
  const n = N();
  if (n && id) {
    try { await n.cancelScheduledNotificationAsync(id); } catch {}
  }
}
