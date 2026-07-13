// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppMode } from './config';

const KEY = 'cegin_favorites';
let _cache = null;

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getFavorites() {
  if (_cache) return _cache;
  if (await isServerMode()) {
    try {
      const server = await api.getFavorites();
      if (server) {
        _cache = server;
        await AsyncStorage.setItem(KEY, JSON.stringify(server));
        return server;
      }
    } catch {
      // Fall through to local
    }
  }

  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cache = raw ? JSON.parse(raw) : {};
    return _cache;
  } catch {
    return {};
  }
}

export async function clearFavorites() {
  _cache = null;
  await AsyncStorage.setItem(KEY, JSON.stringify({}));
  if (await isServerMode()) {
    try {
      await api.clearFavorites();
    } catch {
      // Server offline — cleared locally
    }
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
  _cache = next;
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
