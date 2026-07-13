// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { clearAllSecureKeys } from './config';
import { api } from './api';
import { getAppMode } from './config';

// Static imports only — Metro requires this for bundling
import { clearList } from './shoppingList';
import { clearHistory } from './chatHistory';
import { clearMealPlan } from './mealPlan';
import { clearStats } from './stats';
import { clearCookbook } from './cookbook';
import { clearDietaryProfiles } from './dietProfiles';
import { clearFavorites } from './favorites';
import { clearActivityContext } from './dietProfiles';
import { clearAuditCache } from './auditCache';

const LOCAL_DB_NAME = 'cegin.db';

/**
 * Full reset — clears all local data and server data (if in server mode).
 */
export async function resetApp() {
  if (__DEV__) console.log('[ResetApp] Starting full app reset...');

  // Check if we're in server mode
  const mode = await getAppMode();
  const isServer = mode === 'server';

  try {
    // Clear all the feature-specific stores (each handles server sync)
    await Promise.allSettled([
      clearList(),
      clearHistory(),
      clearMealPlan(),
      clearStats(),
      clearCookbook(),
      clearDietaryProfiles(),
      clearFavorites(),
      clearActivityContext(),
      clearAuditCache(),
    ]);

    // If in server mode, also explicitly clear server-side data
    // (in case individual clears failed or were skipped)
    if (isServer) {
      if (__DEV__) console.log('[ResetApp] Clearing server data...');
      await Promise.allSettled([
        api.clearShoppingList(),
        api.clearChatHistory(),
        api.clearStats(),
        api.clearCookbook(),
        api.clearDietaryProfiles(),
        api.clearFavorites(),
        api.clearActivityContext(),
      ]);
    }

    // Delete the local SQLite database used in "local" mode
    const dbPath = `${FileSystem.documentDirectory}SQLite/${LOCAL_DB_NAME}`;
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (dbInfo.exists) {
      await FileSystem.deleteAsync(dbPath, { idempotent: true });
      if (__DEV__) console.log('[ResetApp] Deleted local SQLite database');
    }

    // Some older versions stored the DB at the root of the documents directory
    const legacyDbPath = `${FileSystem.documentDirectory}${LOCAL_DB_NAME}`;
    const legacyInfo = await FileSystem.getInfoAsync(legacyDbPath);
    if (legacyInfo.exists) {
      await FileSystem.deleteAsync(legacyDbPath, { idempotent: true });
    }

    // Clear secure-stored API keys (Keychain / Android Keystore)
    await clearAllSecureKeys();
    if (__DEV__) console.log('[ResetApp] Cleared all SecureStore keys');

    // Nuclear option: clear every key in AsyncStorage
    await AsyncStorage.clear();
    if (__DEV__) console.log('[ResetApp] Cleared ALL AsyncStorage keys');

    if (__DEV__) console.log('[ResetApp] ✅ Full reset complete.');
    if (__DEV__) {
      console.log(
        '[ResetApp] Please fully close the app and reopen it (or shake device → Reload) ' +
          'to see the fresh startup screen.'
      );
    }

    return true;
  } catch (error) {
    if (__DEV__) console.error('[ResetApp] Error during reset:', error);
    throw error;
  }
}
