import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'cegin_audit_cache';

let _cache = null;

/**
 * Build a stable fingerprint from dietary profiles.
 * Sorts by id so order doesn't matter, includes name+needs+notes.
 */
function profilesFingerprint(profiles) {
  if (!profiles?.length) return 'none';
  return profiles
    .map(p => `${p.id}:${p.name}:${p.needs}:${p.notes}`)
    .sort()
    .join('|');
}

/**
 * Build a cache key from recipe ID + profiles fingerprint + recipe updated_at.
 */
function cacheKey(recipeId, profiles, updatedAt) {
  return `${recipeId}__${profilesFingerprint(profiles)}__${updatedAt || ''}`;
}

async function loadCache() {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

async function saveCache(cache) {
  _cache = cache;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/**
 * Get a cached audit result for a recipe + profiles combination.
 * Returns null if not cached or if the recipe/profiles have changed.
 */
export async function getCachedAudit(recipeId, profiles, updatedAt) {
  const cache = await loadCache();
  const key = cacheKey(recipeId, profiles, updatedAt);
  const entry = cache[key];
  if (entry) return entry.result;
  return null;
}

/**
 * Store an audit result in the cache.
 */
export async function setCachedAudit(recipeId, profiles, updatedAt, result) {
  const cache = await loadCache();
  const key = cacheKey(recipeId, profiles, updatedAt);
  cache[key] = { result, cachedAt: Date.now() };
  // Prune old entries — keep max 200
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    for (const k of sorted.slice(0, keys.length - 200)) {
      delete cache[k];
    }
  }
  await saveCache(cache);
}

/**
 * Invalidate all cached audits for a specific recipe.
 * Call this when a recipe is updated.
 */
export async function invalidateRecipeAudits(recipeId) {
  const cache = await loadCache();
  const prefix = `${recipeId}__`;
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) {
      delete cache[key];
      changed = true;
    }
  }
  if (changed) await saveCache(cache);
}

/**
 * Invalidate ALL cached audits.
 * Call this when dietary profiles change (new user, profile edited).
 */
export async function invalidateAllAudits() {
  _cache = {};
  await AsyncStorage.removeItem(CACHE_KEY);
}

// ─── Nutrition Cache ────────────────────────────────────────────────

const NUTRITION_KEY = 'cegin_nutrition_cache';
let _nutCache = null;

async function loadNutCache() {
  if (_nutCache) return _nutCache;
  try {
    const raw = await AsyncStorage.getItem(NUTRITION_KEY);
    _nutCache = raw ? JSON.parse(raw) : {};
  } catch {
    _nutCache = {};
  }
  return _nutCache;
}

async function saveNutCache(cache) {
  _nutCache = cache;
  await AsyncStorage.setItem(NUTRITION_KEY, JSON.stringify(cache));
}

export async function getCachedNutrition(recipeId, updatedAt) {
  const cache = await loadNutCache();
  const key = `${recipeId}__${updatedAt || ''}`;
  return cache[key]?.result || null;
}

export async function setCachedNutrition(recipeId, updatedAt, result) {
  const cache = await loadNutCache();
  const key = `${recipeId}__${updatedAt || ''}`;
  cache[key] = { result, cachedAt: Date.now() };
  // Prune old entries — keep max 200
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    for (const k of sorted.slice(0, keys.length - 200)) delete cache[k];
  }
  await saveNutCache(cache);
}

export async function invalidateRecipeNutrition(recipeId) {
  const cache = await loadNutCache();
  const prefix = `${recipeId}__`;
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) { delete cache[key]; changed = true; }
  }
  if (changed) await saveNutCache(cache);
}

// ─── Prep Steps Cache ────────────────────────────────────────────────

const PREP_KEY = 'cegin_prep_cache';
let _prepCache = null;

async function loadPrepCache() {
  if (_prepCache) return _prepCache;
  try {
    const raw = await AsyncStorage.getItem(PREP_KEY);
    _prepCache = raw ? JSON.parse(raw) : {};
  } catch {
    _prepCache = {};
  }
  return _prepCache;
}

async function savePrepCache(cache) {
  _prepCache = cache;
  await AsyncStorage.setItem(PREP_KEY, JSON.stringify(cache));
}

export async function getCachedPrep(recipeId, updatedAt) {
  const cache = await loadPrepCache();
  const key = `${recipeId}__${updatedAt || ''}`;
  return cache[key]?.result || null;
}

export async function setCachedPrep(recipeId, updatedAt, result) {
  const cache = await loadPrepCache();
  const key = `${recipeId}__${updatedAt || ''}`;
  cache[key] = { result, cachedAt: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    for (const k of sorted.slice(0, keys.length - 200)) delete cache[k];
  }
  await savePrepCache(cache);
}

export async function invalidateRecipePrep(recipeId) {
  const cache = await loadPrepCache();
  const prefix = `${recipeId}__`;
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) { delete cache[key]; changed = true; }
  }
  if (changed) await savePrepCache(cache);
}

/**
 * Clear the entire cache (used by resetApp).
 */
export async function clearAuditCache() {
  _cache = {};
  _nutCache = {};
  _prepCache = {};
  await AsyncStorage.removeItem(CACHE_KEY);
  await AsyncStorage.removeItem(NUTRITION_KEY);
  await AsyncStorage.removeItem(PREP_KEY);
}
