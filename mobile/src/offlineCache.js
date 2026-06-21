// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServerUrl } from './config';

const RECIPE_CACHE_KEY = 'cegin_recipe_cache';
const PENDING_CHANGES_KEY = 'cegin_pending_changes';

// In-memory recipe cache for instant reads (populated on first getCachedRecipes call)
let _recipesCache = null;

// ── Online detection ─────────────────────────────────────────────────────────

let _online = true;
let _lastCheck = 0;
const CHECK_COOLDOWN = 5000; // don't ping more than once per 5s

export async function isOnline() {
  const now = Date.now();
  if (now - _lastCheck < CHECK_COOLDOWN) return _online;
  _lastCheck = now;
  try {
    const base = await getServerUrl();
    if (!base) { _online = false; return false; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${base}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    _online = res.ok;
  } catch {
    _online = false;
  }
  return _online;
}

/** Force-set the cached online flag (e.g. after a successful fetch). */
export function setOnline(val) {
  _online = val;
  _lastCheck = Date.now();
}

// ── Recipe cache ─────────────────────────────────────────────────────────────

export async function cacheRecipes(recipes) {
  try {
    const map = {};
    for (const r of recipes) map[r.id] = r;
    await AsyncStorage.setItem(RECIPE_CACHE_KEY, JSON.stringify(map));
    _recipesCache = recipes;
  } catch {}
}

export async function getCachedRecipes() {
  if (_recipesCache) return _recipesCache;
  try {
    const raw = await AsyncStorage.getItem(RECIPE_CACHE_KEY);
    if (!raw) { _recipesCache = []; return []; }
    const map = JSON.parse(raw);
    _recipesCache = Object.values(map);
    return _recipesCache;
  } catch {
    return [];
  }
}

// Synchronous getter — returns cached recipes instantly (or [] if never loaded)
export function getCachedRecipesSync() {
  return _recipesCache || [];
}

export async function cacheRecipe(recipe) {
  try {
    const raw = await AsyncStorage.getItem(RECIPE_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[recipe.id] = recipe;
    await AsyncStorage.setItem(RECIPE_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export async function getCachedRecipe(id) {
  try {
    const raw = await AsyncStorage.getItem(RECIPE_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[id] || null;
  } catch {
    return null;
  }
}

// ── Pending changes queue ────────────────────────────────────────────────────

export async function addPendingChange(change) {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CHANGES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push({ ...change, timestamp: Date.now() });
    await AsyncStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(list));
  } catch {}
}

export async function getPendingChanges() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CHANGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearPendingChanges() {
  try {
    await AsyncStorage.removeItem(PENDING_CHANGES_KEY);
  } catch {}
}
