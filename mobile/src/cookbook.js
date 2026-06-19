import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { api } from './api';
import { getAppMode } from './config';

const KEY = 'cegin_cookbook';

// Each entry: { id, recipeId, recipeTitle, imageUri, date, notes }
let _cache = null;

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

async function imageToBase64(uri) {
  if (!uri) return null;
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch {
    return null;
  }
}

export async function getCookbook() {
  if (_cache) return _cache;

  if (await isServerMode()) {
    try {
      const server = await api.getCookbook();
      if (server) {
        _cache = server;
        // Also cache locally
        await AsyncStorage.setItem(KEY, JSON.stringify(server));
        return _cache;
      }
    } catch {
      // Server offline — fall through to local
    }
  }

  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cache = raw ? JSON.parse(raw) : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

async function save(list) {
  _cache = list;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function addCookbookEntry(entry) {
  const newEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    notes: '',
    ...entry,
  };

  if (await isServerMode()) {
    try {
      // Convert image to base64 for upload
      let imageBase64 = null;
      if (newEntry.imageUri) {
        imageBase64 = await imageToBase64(newEntry.imageUri);
      }

      const server = await api.addCookbookEntry({
        id: newEntry.id,
        recipeId: newEntry.recipeId,
        recipeTitle: newEntry.recipeTitle,
        imageBase64,
        date: newEntry.date,
        notes: newEntry.notes,
      });
      if (server) {
        // Use server response (has server-side imageUri)
        const list = await getCookbook();
        list.unshift(server);
        _cache = list;
        await AsyncStorage.setItem(KEY, JSON.stringify(list));
        return server;
      }
    } catch {
      // Server offline — fall through to local
    }
  }

  // Local mode or server offline
  const list = await getCookbook();
  list.unshift(newEntry);
  await save(list);
  return newEntry;
}

export async function updateCookbookEntry(id, updates) {
  if (await isServerMode()) {
    try {
      let imageBase64 = null;
      if (updates.imageUri) {
        imageBase64 = await imageToBase64(updates.imageUri);
      }

      const server = await api.updateCookbookEntry(id, {
        recipeTitle: updates.recipeTitle,
        imageBase64,
        notes: updates.notes,
        date: updates.date,
      });
      if (server) {
        const list = await getCookbook();
        const next = list.map((e) => e.id === id ? { ...e, ...server } : e);
        _cache = next;
        await AsyncStorage.setItem(KEY, JSON.stringify(next));
        return next;
      }
    } catch {
      // Fall through to local
    }
  }

  const list = await getCookbook();
  const next = list.map((e) => e.id === id ? { ...e, ...updates } : e);
  await save(next);
  return next;
}

export async function deleteCookbookEntry(id) {
  if (await isServerMode()) {
    try {
      await api.deleteCookbookEntry(id);
    } catch {}
  }

  const list = await getCookbook();
  const next = list.filter((e) => e.id !== id);
  await save(next);
  return next;
}

export async function clearCookbook() {
  if (await isServerMode()) {
    try {
      await api.clearCookbook();
    } catch {}
  }

  await save([]);
  return [];
}
