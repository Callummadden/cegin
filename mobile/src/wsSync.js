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
let pingInterval = null;
let pongTimeout = null;
let lastPong = 0;

// Subscribers: Map<type, Set<callback>>
const subscribers = new Map();

// ── Cache clearing map ─────────────────────────────────────────────────────

const cacheClearers = {
  recipes: null,
  shopping_list: clearShoppingCache,
  meal_plan: clearMealPlanCache,
  cookbook: clearCookbookCache,
  stats: clearStatsCache,
  dietary_profiles: clearDietCache,
  favorites: null,
  chat_history: null,
  collections: null,
  activity_context: clearDietCache,
  scanned_items: null,
  terry_vision: null,
};

// ── Debounce helper ────────────────────────────────────────────────────────

const pendingCallbacks = new Map(); // type -> timer

function debouncedNotify(type, action) {
  // Clear existing timer for this type
  const existing = pendingCallbacks.get(type);
  if (existing) clearTimeout(existing);

  // Schedule callback after 150ms of quiet
  pendingCallbacks.set(type, setTimeout(() => {
    pendingCallbacks.delete(type);

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

    // Also notify wildcard subscribers
    const wildcardSubs = subscribers.get('*');
    if (wildcardSubs) {
      for (const cb of wildcardSubs) {
        try { cb(type, action); } catch (e) { console.error('[WS] Wildcard subscriber error:', e); }
      }
    }
  }, 150));
}

// ── Connect / disconnect ───────────────────────────────────────────────────

export async function connect() {
  const mode = await getAppMode();
  if (mode !== 'server') return;

  const baseUrl = await getServerUrl();
  if (!baseUrl) return;

  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

  // Already connected and alive — skip
  if (ws && ws.readyState === 1 && (Date.now() - lastPong) < 30000) {
    return;
  }

  // Force close any existing stale connection
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  stopPing();

  intentionalClose = false;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to', wsUrl);
      reconnectDelay = 1000;
      lastPong = Date.now();
      startPing();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Pong response from server
        if (msg.type === 'pong') {
          lastPong = Date.now();
          if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
          return;
        }

        const { type, action } = msg;
        console.log('[WS] Received:', type, action);
        debouncedNotify(type, action);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log('[WS] Disconnected', event.code, event.reason);
      ws = null;
      stopPing();
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose fires after this with the real error info
    };
  } catch (e) {
    console.error('[WS] Connection failed:', e.message);
    scheduleReconnect();
  }
}

export function disconnect() {
  intentionalClose = true;
  stopPing();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

// ── Ping/pong keepalive ────────────────────────────────────────────────────

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    if (!ws || ws.readyState !== 1) {
      stopPing();
      return;
    }

    // Send ping
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch {
      // Connection is dead
      console.log('[WS] Ping send failed — reconnecting');
      stopPing();
      try { ws.close(); } catch {}
      ws = null;
      scheduleReconnect();
      return;
    }

    // If no pong within 10s, connection is dead
    pongTimeout = setTimeout(() => {
      const timeSinceLastPong = Date.now() - lastPong;
      if (timeSinceLastPong > 15000) {
        console.log('[WS] No pong for ' + Math.round(timeSinceLastPong / 1000) + 's — reconnecting');
        stopPing();
        if (ws) { try { ws.close(); } catch {} ws = null; }
        scheduleReconnect();
      }
    }, 10000);
  }, 15000); // Ping every 15s
}

function stopPing() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
}

// ── Reconnect with backoff ─────────────────────────────────────────────────

function scheduleReconnect() {
  if (intentionalClose) return;
  if (reconnectTimer) return;

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
      // App came to foreground — force reconnect (drop stale connection)
      console.log('[WS] App foregrounded — forcing reconnect');
      if (ws) { try { ws.close(); } catch {} ws = null; }
      stopPing();
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
