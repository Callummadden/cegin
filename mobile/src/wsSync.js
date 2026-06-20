import { AppState } from 'react-native';
import { getServerUrl, getAppMode } from './config';
import { clearCache as clearShoppingCache } from './shoppingList';
import { clearCache as clearMealPlanCache } from './mealPlan';
import { clearCache as clearCookbookCache } from './cookbook';
import { clearCache as clearStatsCache } from './stats';
import { clearCache as clearDietCache } from './dietProfiles';

// ── State ──────────────────────────────────────────────────────────────────

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000; // starts at 1s, doubles up to 30s
let intentionalClose = false;
let appStateSub = null;

// Subscribers: Map<type, Set<callback>>
const subscribers = new Map();

// ── Cache clearing map ─────────────────────────────────────────────────────

const cacheClearers = {
  recipes: null, // handled by offlineCache._recipesCache — cleared via api.listRecipes forceRefresh
  shopping_list: clearShoppingCache,
  meal_plan: clearMealPlanCache,
  cookbook: clearCookbookCache,
  stats: clearStatsCache,
  dietary_profiles: clearDietCache,
  favorites: null,   // no in-memory cache
  chat_history: null, // no in-memory cache
  collections: null,  // part of recipes
  activity_context: clearDietCache, // activity context is in dietProfiles module
  scanned_items: null, // no client cache
};

// ── Connect / disconnect ───────────────────────────────────────────────────

export async function connect() {
  const mode = await getAppMode();
  if (mode !== 'server') return;

  const baseUrl = await getServerUrl();
  if (!baseUrl) return;

  // Convert http:// or https:// to ws:// or wss://
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

  if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
    return; // Already connected or connecting
  }

  intentionalClose = false;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to', wsUrl);
      reconnectDelay = 1000; // Reset backoff on successful connection
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, action } = msg;
        console.log('[WS] Received:', type, action);

        // Clear the relevant in-memory cache
        const clearer = cacheClearers[type];
        if (clearer) clearer();

        // Notify subscribers for this type
        const subs = subscribers.get(type);
        if (subs) {
          for (const cb of subs) {
            try { cb(action); } catch (e) { console.error('[WS] Subscriber error:', e); }
          }
        }

        // Also notify wildcard subscribers (listen to all events)
        const wildcardSubs = subscribers.get('*');
        if (wildcardSubs) {
          for (const cb of wildcardSubs) {
            try { cb(type, action); } catch (e) { console.error('[WS] Wildcard subscriber error:', e); }
          }
        }
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      ws = null;
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose fires after this with the real error info — handled there
    };
  } catch (e) {
    console.error('[WS] Connection failed:', e.message);
    scheduleReconnect();
  }
}

export function disconnect() {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

function scheduleReconnect() {
  if (intentionalClose) return;
  if (reconnectTimer) return; // Already scheduled

  console.log(`[WS] Reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);

  // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

// ── App state management ───────────────────────────────────────────────────

export function initAppStateListener() {
  if (appStateSub) return;

  let currentState = AppState.currentState;

  appStateSub = AppState.addEventListener('change', (nextState) => {
    const wasBackground = currentState?.match(/background/);
    const isNowActive = nextState === 'active';

    if (wasBackground && isNowActive) {
      // App came to foreground — reconnect if needed
      connect();
    }

    currentState = nextState;
  });
}

export function removeAppStateListener() {
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
}

// ── Subscribe to change events ─────────────────────────────────────────────

/**
 * Subscribe to a specific data type change.
 * @param {string} type - e.g. 'recipes', 'shopping_list', 'meal_plan', etc. Use '*' for all events.
 * @param {function} callback - Called with (action) for specific types, or (type, action) for wildcard.
 * @returns {function} Unsubscribe function.
 */
export function subscribe(type, callback) {
  if (!subscribers.has(type)) {
    subscribers.set(type, new Set());
  }
  subscribers.get(type).add(callback);

  return () => {
    const subs = subscribers.get(type);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(type);
    }
  };
}
