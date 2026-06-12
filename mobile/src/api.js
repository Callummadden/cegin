import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_URL_KEY = 'serverUrl';

export async function getServerUrl() {
  return (await AsyncStorage.getItem(SERVER_URL_KEY)) || '';
}

export async function setServerUrl(url) {
  await AsyncStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ''));
}

async function request(path, options = {}) {
  const base = await getServerUrl();
  if (!base) {
    throw new Error('No server configured. Set the server URL in Settings.');
  }
  const res = await fetch(`${base}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => request('/health'),
  listRecipes: (search) =>
    request(`/recipes${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getRecipe: (id) => request(`/recipes/${id}`),
  createRecipe: (recipe) =>
    request('/recipes', { method: 'POST', body: JSON.stringify(recipe) }),
  updateRecipe: (id, recipe) =>
    request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) }),
  deleteRecipe: (id) => request(`/recipes/${id}`, { method: 'DELETE' }),
};
