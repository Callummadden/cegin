import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'cegin_cookbook';

// Each entry: { id, recipeId, recipeTitle, imageUri, date, notes }
let _cache = null;

export async function getCookbook() {
  if (_cache) return _cache;
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
  const list = await getCookbook();
  const newEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    notes: '',
    ...entry,
  };
  list.unshift(newEntry); // newest first
  await save(list);
  return newEntry;
}

export async function updateCookbookEntry(id, updates) {
  const list = await getCookbook();
  const next = list.map((e) => e.id === id ? { ...e, ...updates } : e);
  await save(next);
  return next;
}

export async function deleteCookbookEntry(id) {
  const list = await getCookbook();
  const next = list.filter((e) => e.id !== id);
  await save(next);
  return next;
}

export async function clearCookbook() {
  await save([]);
  return [];
}
