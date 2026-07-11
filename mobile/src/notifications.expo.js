// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
// notifications.expo.js
// This file is automatically preferred by Expo Go (SDK 53+).
// It contains NO native imports — keeps the app red-screen free.
// The real implementation lives in notifications.js (used by dev builds).


export async function requestPermissions() {
  if (__DEV__) console.log('[notifications] Skipping in Expo Go');
}

export async function getPermissionStatus() {
  return 'unavailable';
}

export async function requestPermissionAndGetStatus() {
  return 'unavailable';
}

export async function getPushToken() {
  return null;
}

export async function registerForPushNotifications(_registerFn) {
  if (__DEV__) console.log('[notifications] Push not available in Expo Go — use a dev build');
  return null;
}

export async function scheduleNotification(_seconds, _title, _body) {
  return null;
}

export async function cancelNotification(_id) {}
