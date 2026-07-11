// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';
import { getAppMode, getServerUrl } from './config';

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
    // Check file exists first
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      if (__DEV__) console.log('[Cookbook] Image file does not exist:', uri);
      return null;
    }
    // Resize to max 1000px wide and compress to keep payload small
    const manipulated = await manipulateAsync(
      uri,
      [{ resize: { width: 1000 } }],
      { compress: 0.7, format: SaveFormat.JPEG }
    );
    const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (__DEV__) console.log('[Cookbook] Compressed image base64 length:', base64.length);
    return base64;
  } catch (e) {
    if (__DEV__) console.error('[Cookbook] Failed to convert image to base64:', e.message);
    return null;
  }
}

// Resolve all entries' image URIs
async function resolveEntries(entries) {
  const base = await getServerUrl();
  return entries.map(e => ({
    ...e,
    imageUri: e.imageUri && !e.imageUri.startsWith('http') && !e.imageUri.startsWith('file://') && !e.imageUri.startsWith('content://')
      ? `${base}${e.imageUri}`
      : e.imageUri,
  }));
}

export async function getCookbook(forceRefresh = false) {
  if (forceRefresh) _cache = null;
  if (_cache) return _cache;

  if (await isServerMode()) {
    try {
      const server = await api.getCookbook();
      if (server) {
        _cache = await resolveEntries(server);
        await AsyncStorage.setItem(KEY, JSON.stringify(_cache));
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
        if (__DEV__) console.log('[Cookbook] Converting image to base64:', newEntry.imageUri);
        imageBase64 = await imageToBase64(newEntry.imageUri);
        if (__DEV__) console.log('[Cookbook] Base64 result:', imageBase64 ? `${imageBase64.length} chars` : 'null');
      }

      if (__DEV__) console.log('[Cookbook] Sending to server...');
      const server = await api.addCookbookEntry({
        id: newEntry.id,
        recipeId: newEntry.recipeId,
        recipeTitle: newEntry.recipeTitle,
        imageBase64,
        date: newEntry.date,
        notes: newEntry.notes,
      });
      if (__DEV__) console.log('[Cookbook] Server response:', server);
      if (server) {
        // Don't add to local cache here — the WebSocket broadcast will trigger
        // getCookbook() which fetches from server and replaces the cache.
        // Adding here causes duplicates when the WebSocket event fires.
        return (await resolveEntries([server]))[0];
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
        // WebSocket broadcast will trigger getCookbook() to refresh the cache
        return (await resolveEntries([server]))[0];
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
      // WebSocket broadcast will trigger getCookbook() to refresh the cache
      return;
    } catch (_e) { if (__DEV__) console.warn('[cookbook] Caught error:', _e.message); }
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
    } catch (_e) { if (__DEV__) console.warn('[cookbook] Caught error:', _e.message); }
  }

  await save([]);
  return [];
}

export function clearCache() {
  _cache = null;
}
