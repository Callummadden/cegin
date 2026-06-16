import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILES_KEY = 'cegin_dietary_profiles';
const ACTIVITY_KEY = 'cegin_activity_log';

// --- Dietary Profiles ---
// Shape: [{ id, name, needs, notes }]
// Example: { id: 'p1', name: 'Sarah', needs: 'gluten-free, dairy-free', notes: 'IBS triggers: garlic, onion' }

let _profilesCache = null;

export async function getDietaryProfiles() {
  if (_profilesCache) return _profilesCache;
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
}

export async function addDietaryProfile(profile) {
  const profiles = await getDietaryProfiles();
  const newProfile = {
    id: `p${Date.now().toString(36)}`,
    ...profile,
  };
  const updated = [...profiles, newProfile];
  _profilesCache = updated;
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(updated));
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
}

// --- Activity Context ---
// Shape: { date, level, description, metrics }
// Example: { date: '2026-06-13', level: 'high', description: '10k run + gym session', metrics: { steps: 15000, calories: 800 } }

let _activityCache = null;

export async function getActivityContext() {
  if (_activityCache) return _activityCache;
  const raw = await AsyncStorage.getItem(ACTIVITY_KEY);
  try { _activityCache = raw ? JSON.parse(raw) : null; } catch { _activityCache = null; }
  return _activityCache;
}

export async function setActivityContext(context) {
  _activityCache = { ...context, date: context.date || new Date().toISOString().slice(0, 10) };
  await AsyncStorage.setItem(ACTIVITY_KEY, JSON.stringify(_activityCache));
  return _activityCache;
}

export async function clearActivityContext() {
  _activityCache = null;
  await AsyncStorage.removeItem(ACTIVITY_KEY);
}

export const ACTIVITY_LEVELS = [
  { value: 'rest', label: 'REST DAY', description: 'Minimal activity, recovery focus' },
  { value: 'light', label: 'LIGHT', description: 'Walking, stretching, easy movement' },
  { value: 'moderate', label: 'MODERATE', description: '30-60 min exercise, normal day' },
  { value: 'high', label: 'HIGH', description: 'Intense workout, long training session' },
  { value: 'extreme', label: 'EXTREME', description: 'Competition, double session, manual labor' },
];
