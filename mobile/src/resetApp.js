import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { clearAllSecureKeys } from './config';

// Static imports only — Metro requires this for bundling
import { clearList } from './shoppingList';
import { clearHistory } from './chatHistory';
import { clearMealPlan } from './mealPlan';
import { clearStats } from './stats';
import { clearCookbook } from './cookbook';
import { clearDietaryProfiles } from './dietProfiles';

const LOCAL_DB_NAME = 'cegin.db';

/**
 * Full reset for development / testing the startup flow (especially the new
 * custom text + vision model configuration on first launch).
 *
 * This function only uses static imports so Metro can bundle it correctly.
 */
export async function resetApp() {
  console.log('[ResetApp] Starting full app reset...');

  try {
    // Clear all the feature-specific stores
    await Promise.allSettled([
      clearList(),
      clearHistory(),
      clearMealPlan(),
      clearStats(),
      clearCookbook(),
      clearDietaryProfiles(),
    ]);

    // Delete the local SQLite database used in "local" mode
    const dbPath = `${FileSystem.documentDirectory}SQLite/${LOCAL_DB_NAME}`;
    const dbInfo = await FileSystem.getInfoAsync(dbPath);
    if (dbInfo.exists) {
      await FileSystem.deleteAsync(dbPath, { idempotent: true });
      console.log('[ResetApp] Deleted local SQLite database');
    }

    // Some older versions stored the DB at the root of the documents directory
    const legacyDbPath = `${FileSystem.documentDirectory}${LOCAL_DB_NAME}`;
    const legacyInfo = await FileSystem.getInfoAsync(legacyDbPath);
    if (legacyInfo.exists) {
      await FileSystem.deleteAsync(legacyDbPath, { idempotent: true });
    }

    // Clear secure-stored API keys (Keychain / Android Keystore)
    await clearAllSecureKeys();
    console.log('[ResetApp] Cleared all SecureStore keys');

    // Nuclear option: clear every key in AsyncStorage
    // This removes setup_complete, app_mode, serverUrl, custom AI config,
    // themes, auth tokens, and everything else.
    await AsyncStorage.clear();
    console.log('[ResetApp] Cleared ALL AsyncStorage keys');

    console.log('[ResetApp] ✅ Full reset complete.');
    console.log(
      '[ResetApp] Please fully close the app and reopen it (or shake device → Reload) ' +
        'to see the fresh startup screen with the text + vision model picker.'
    );

    return true;
  } catch (error) {
    console.error('[ResetApp] Error during reset:', error);
    throw error;
  }
}
