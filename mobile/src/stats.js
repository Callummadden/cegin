// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppMode } from './config';

const STATS_KEY = 'cegin_stats';
const COOK_DATES_KEY = 'cegin_cook_dates';

// { cookCount: number, recipeCookCounts: { [recipeId]: number }, totalSteps: number }
let _cache = null;

const defaults = {
  cookCount: 0,
  recipeCookCounts: {},
  totalSteps: 0,
};

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getStats(forceRefresh = false) {
  if (forceRefresh) _cache = null;
  if (_cache) return _cache;

  // Try local cache first (instant)
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (raw) {
      _cache = { ...defaults, ...JSON.parse(raw) };
      // Refresh from server in background (don't await)
      if (await isServerMode()) {
        api.getStats().then(server => {
          if (server) {
            _cache = {
              cookCount: server.cookCount || 0,
              totalSteps: server.totalSteps || 0,
              recipeCookCounts: server.recipeCookCounts || {},
              streak: server.streak || 0,
              topRecipes: server.topRecipes || [],
            };
            AsyncStorage.setItem(STATS_KEY, JSON.stringify(_cache)).catch(() => {});
          }
        }).catch(() => {});
      }
      return _cache;
    }
  } catch (_e) { if (__DEV__) console.warn(\'[stats] Caught error:\', _e.message); }

  // No local cache — must fetch from server
  if (await isServerMode()) {
    try {
      const server = await api.getStats();
      if (server) {
        _cache = {
          cookCount: server.cookCount || 0,
          totalSteps: server.totalSteps || 0,
          recipeCookCounts: server.recipeCookCounts || {},
          streak: server.streak || 0,
          topRecipes: server.topRecipes || [],
        };
        await AsyncStorage.setItem(STATS_KEY, JSON.stringify(_cache));
        return _cache;
      }
    } catch {
      // Server offline — fall through to defaults
    }
  }

  _cache = { ...defaults };
  return _cache;
}

async function save(stats) {
  _cache = stats;
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export async function recordCook(recipeId, recipeTitle, stepCount) {
  // Record on server if in server mode
  if (await isServerMode()) {
    try {
      const server = await api.recordCook(recipeId, recipeTitle, stepCount);
      if (server) {
        _cache = {
          cookCount: server.cookCount || 0,
          totalSteps: server.totalSteps || 0,
          recipeCookCounts: server.recipeCookCounts || {},
          streak: server.streak || 0,
        };
        return;
      }
    } catch {
      // Server offline — fall through to local
    }
  }

  // Local mode or server offline
  const stats = await getStats();
  stats.cookCount += 1;
  stats.totalSteps += stepCount;
  if (!stats.recipeCookCounts[recipeId]) {
    stats.recipeCookCounts[recipeId] = { title: recipeTitle, count: 0 };
  }
  stats.recipeCookCounts[recipeId].count += 1;
  stats.recipeCookCounts[recipeId].title = recipeTitle;
  await save(stats);

  // Record cook date for streak tracking
  await recordCookDate();
}

async function recordCookDate() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const raw = await AsyncStorage.getItem(COOK_DATES_KEY);
  let dates;
  try { dates = raw ? JSON.parse(raw) : []; } catch { dates = []; }
  if (!dates.includes(today)) {
    dates.push(today);
    if (dates.length > 90) dates = dates.slice(-90);
    await AsyncStorage.setItem(COOK_DATES_KEY, JSON.stringify(dates));
  }
}

export async function getCookingStreak() {
  // Server mode — streak comes from getStats()
  if (await isServerMode()) {
    try {
      const stats = await getStats();
      return stats.streak || 0;
    } catch {
      // Fall through to local
    }
  }

  const raw = await AsyncStorage.getItem(COOK_DATES_KEY);
  let dates;
  try { dates = raw ? JSON.parse(raw) : []; } catch { dates = []; }
  if (dates.length === 0) return 0;

  const sorted = [...dates].sort().reverse();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const yDate = new Date(Date.now() - 86400000);
  const yesterday = `${yDate.getFullYear()}-${String(yDate.getMonth()+1).padStart(2,'0')}-${String(yDate.getDate()).padStart(2,'0')}`;

  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((prev - curr) / 86400000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getTopRecipes(limit = 5) {
  // Server mode — top recipes come from getStats()
  if (await isServerMode()) {
    try {
      const stats = await getStats();
      return (stats.topRecipes || []).slice(0, limit);
    } catch {
      // Fall through to local
    }
  }

  const stats = await getStats();
  return Object.entries(stats.recipeCookCounts)
    .map(([id, { title, count }]) => ({ id, title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function clearStats() {
  _cache = { ...defaults };

  if (await isServerMode()) {
    try {
      await api.clearStats();
    } catch (_e) { if (__DEV__) console.warn(\'[stats] Caught error:\', _e.message); }
  }

  await AsyncStorage.multiRemove([STATS_KEY, COOK_DATES_KEY]);
}

export function clearCache() {
  _cache = null;
}
