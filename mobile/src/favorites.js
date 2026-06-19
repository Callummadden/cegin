import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppMode } from './config';

const KEY = 'cegin_favorites';

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getFavorites() {
  if (await isServerMode()) {
    try {
      const server = await api.getFavorites();
      if (server) {
        await AsyncStorage.setItem(KEY, JSON.stringify(server));
        return server;
      }
    } catch {
      // Fall through to local
    }
  }

  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function toggleFavorite(id) {
  const favs = await getFavorites();
  const next = { ...favs };
  if (next[id]) {
    delete next[id];
  } else {
    next[id] = true;
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(next));

  if (await isServerMode()) {
    try {
      await api.syncFavorites(next);
    } catch {
      // Server offline — saved locally
    }
  }

  return next;
}
