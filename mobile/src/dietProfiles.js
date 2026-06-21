import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { invalidateAllAudits } from './auditCache';
import { getAppMode } from './config';

const PROFILES_KEY = 'cegin_dietary_profiles';
const ACTIVITY_KEY = 'cegin_activity_log';

// --- Dietary Profiles ---
// Shape: [{ id, name, needs, notes }]

let _profilesCache = null;

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getDietaryProfiles(forceRefresh = false) {
  if (forceRefresh) _profilesCache = null;
  if (_profilesCache) return _profilesCache;

  if (await isServerMode()) {
    try {
      const server = await api.getDietaryProfiles();
      if (server) {
        _profilesCache = server.map(p => ({ id: p.id, name: p.name, needs: p.needs, notes: p.notes }));
        return _profilesCache;
      }
    } catch {
      // Server offline — fall through to local
    }
  }

  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  try {
    _profilesCache = raw ? JSON.parse(raw) : [];
  } catch {
    _profilesCache = [];
  }
  return _profilesCache;
}

export async function saveDietaryProfiles(profiles) {
  _profilesCache = profiles;
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  invalidateAllAudits();

  if (await isServerMode()) {
    try {
      await api.syncDietaryProfiles(profiles);
    } catch {
      // Server offline — saved locally
    }
  }
}

export async function addDietaryProfile(profile) {
  const profiles = await getDietaryProfiles();
  const newProfile = {
    id: `p${Date.now().toString(36)}`,
    ...profile,
  };
  const updated = [...profiles, newProfile];
  await saveDietaryProfiles(updated);
  return newProfile;
}

export async function updateDietaryProfile(id, updates) {
  const profiles = await getDietaryProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = { ...profiles[idx], ...updates };
  await saveDietaryProfiles(profiles);
  return profiles[idx];
}

export async function removeDietaryProfile(id) {
  const profiles = await getDietaryProfiles();
  const filtered = profiles.filter((p) => p.id !== id);
  await saveDietaryProfiles(filtered);
  return filtered;
}

export async function clearDietaryProfiles() {
  _profilesCache = null;
  await AsyncStorage.removeItem(PROFILES_KEY);
  invalidateAllAudits();

  if (await isServerMode()) {
    try {
      await api.clearDietaryProfiles();
    } catch {}
  }
}

// --- Activity Context ---

let _activityCache = null;

export async function getActivityContext() {
  if (_activityCache) return _activityCache;

  if (await isServerMode()) {
    try {
      const server = await api.getActivityContext();
      if (server) {
        _activityCache = server;
        await AsyncStorage.setItem(ACTIVITY_KEY, JSON.stringify(server));
        return _activityCache;
      }
    } catch {
      // Fall through to local
    }
  }

  const raw = await AsyncStorage.getItem(ACTIVITY_KEY);
  try { _activityCache = raw ? JSON.parse(raw) : null; } catch { _activityCache = null; }
  return _activityCache;
}

export async function setActivityContext(context) {
  _activityCache = { ...context, date: context.date || new Date().toISOString().slice(0, 10) };
  await AsyncStorage.setItem(ACTIVITY_KEY, JSON.stringify(_activityCache));

  if (await isServerMode()) {
    try {
      await api.syncActivityContext(_activityCache);
    } catch {
      // Server offline — saved locally
    }
  }

  return _activityCache;
}

export async function clearActivityContext() {
  _activityCache = null;
  await AsyncStorage.removeItem(ACTIVITY_KEY);

  if (await isServerMode()) {
    try {
      await api.clearActivityContext();
    } catch {}
  }
}

export const ACTIVITY_LEVELS = [
  { value: 'rest', label: 'REST DAY', description: 'Minimal activity, recovery focus' },
  { value: 'light', label: 'LIGHT', description: 'Walking, stretching, easy movement' },
  { value: 'moderate', label: 'MODERATE', description: '30-60 min exercise, normal day' },
  { value: 'high', label: 'HIGH', description: 'Intense workout, long training session' },
  { value: 'extreme', label: 'EXTREME', description: 'Competition, double session, manual labor' },
];

export function clearCache() {
  _profilesCache = null;
  _activityCache = null;
}
