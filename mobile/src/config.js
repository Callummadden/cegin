import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// ── Non-sensitive config (AsyncStorage is fine) ─────────────────────────────

const SERVER_URL_KEY = 'serverUrl';

export async function getServerUrl() {
  return (await AsyncStorage.getItem(SERVER_URL_KEY)) || '';
}

export async function setServerUrl(url) {
  url = url || '';
  await AsyncStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ''));
}

export async function getAppMode() {
  return (await AsyncStorage.getItem('app_mode')) || 'server';
}



// ── Secure storage with Expo Go fallback ────────────────────────────────────
// SecureStore requires native code (dev builds / APKs).
// In Expo Go it's unavailable, so we fall back to AsyncStorage silently.

let _secureAvailable = null;

async function isSecure() {
  if (_secureAvailable === null) {
    _secureAvailable = await SecureStore.isAvailableAsync();
  }
  return _secureAvailable;
}

// Read: try SecureStore first, migrate from AsyncStorage if found there,
// fall back to AsyncStorage entirely when SecureStore is unavailable.
async function secureGet(legacyAsyncKey) {
  if (await isSecure()) {
    let val = await SecureStore.getItemAsync(legacyAsyncKey);
    if (!val) {
      val = await AsyncStorage.getItem(legacyAsyncKey);
      if (val) {
        // Auto-migrate: move from AsyncStorage → SecureStore
        await SecureStore.setItemAsync(legacyAsyncKey, val);
        await AsyncStorage.removeItem(legacyAsyncKey);
      }
    }
    return val || '';
  }
  // Expo Go fallback
  return (await AsyncStorage.getItem(legacyAsyncKey)) || '';
}

// Write: use SecureStore when available, otherwise AsyncStorage.
async function secureSet(key, value) {
  if (await isSecure()) {
    if (value) {
      await SecureStore.setItemAsync(key, value);
    } else {
      await SecureStore.deleteItemAsync(key).catch(() => {});
    }
    // Clean up any legacy AsyncStorage copy
    await AsyncStorage.removeItem(key).catch(() => {});
  } else {
    // Expo Go fallback
    if (value) {
      await AsyncStorage.setItem(key, value);
    }
  }
}

// Delete from both stores (used on reset)
async function secureDelete(key) {
  if (await isSecure()) {
    await SecureStore.deleteItemAsync(key).catch(() => {});
  }
  await AsyncStorage.removeItem(key).catch(() => {});
}

// ── API Key getters/setters ─────────────────────────────────────────────────

export async function getDeepSeekKey() {
  return secureGet('deepseek_api_key');
}

export async function setDeepSeekKey(key) {
  return secureSet('deepseek_api_key', key);
}

export async function getGoogleKey() {
  return secureGet('google_api_key');
}

export async function setGoogleKey(key) {
  return secureSet('google_api_key', key);
}

// ── Custom AI Providers (user can choose any model they want) ───────────────

const CUSTOM_AI_TEXT_KEY = 'custom_ai_text';
const CUSTOM_AI_VISION_KEY = 'custom_ai_vision';

export async function getCustomAIConfig() {
  const [textRaw, visionRaw] = await Promise.all([
    secureGet(CUSTOM_AI_TEXT_KEY),
    secureGet(CUSTOM_AI_VISION_KEY),
  ]);

  return {
    text: textRaw ? safeJsonParse(textRaw) : null,
    vision: visionRaw ? safeJsonParse(visionRaw) : null,
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export async function setCustomAIConfig({ text, vision }) {
  const tasks = [];
  if (text) {
    tasks.push(secureSet(CUSTOM_AI_TEXT_KEY, JSON.stringify(text)));
  } else {
    tasks.push(secureDelete(CUSTOM_AI_TEXT_KEY));
  }
  if (vision) {
    tasks.push(secureSet(CUSTOM_AI_VISION_KEY, JSON.stringify(vision)));
  } else {
    tasks.push(secureDelete(CUSTOM_AI_VISION_KEY));
  }
  await Promise.all(tasks);
}

export async function hasCustomAI() {
  const cfg = await getCustomAIConfig();
  return !!(cfg.text || cfg.vision);
}

// Used by resetApp to clear all secure-stored keys
export async function clearAllSecureKeys() {
  await Promise.all([
    secureDelete('deepseek_api_key'),
    secureDelete('google_api_key'),
    secureDelete(CUSTOM_AI_TEXT_KEY),
    secureDelete(CUSTOM_AI_VISION_KEY),
  ]);
}
