import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'cegin_favorites';

export async function getFavorites() {
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
  return next;
}
