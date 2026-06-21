// metro.config.js
// Blocks expo-notifications from the bundle to prevent the red screen in Expo Go.
// The package has top-level side effects that throw on Android in Expo Go
// (DevicePushTokenAutoRegistration.fx.js calls addPushTokenListener at module scope,
// which calls warnOfExpoGoPushUsage, which throws).
//
// To run in Expo Go:   EXPO_GO=1 npx expo start
// To run dev build:    npx expo start
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle .db files as assets (for USDA nutrition database)
config.resolver.assetExts.push('db');

const isExpoGo = process.env.EXPO_GO === '1';

if (isExpoGo) {
  // Block expo-notifications from being resolved at all
  const existingBlockList = config.resolver.blockList;
  const notifBlock = /node_modules\/expo-notifications\/.*/;

  if (existingBlockList instanceof RegExp) {
    config.resolver.blockList = [existingBlockList, notifBlock];
  } else if (Array.isArray(existingBlockList)) {
    config.resolver.blockList = [...existingBlockList, notifBlock];
  } else {
    config.resolver.blockList = [notifBlock];
  }

  console.log('[metro] Blocking expo-notifications (Expo Go mode)');
}

module.exports = config;
