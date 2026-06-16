import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'cegin_chat_history';
const MAX_HISTORY = 50;

// Each conversation: { id, title, messages, timestamp }

export async function getChatHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function save(history) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Save or update a conversation. If conversationId is provided, update it.
export async function saveConversation(messages, conversationId = null) {
  if (!messages.length) return;
  const history = await getChatHistory();
  const title = messages.find((m) => m.role === 'user')?.content?.slice(0, 60) || 'Untitled chat';

  if (conversationId) {
    // Update existing conversation
    const idx = history.findIndex((c) => c.id === conversationId);
    if (idx !== -1) {
      history[idx] = { ...history[idx], title, messages, timestamp: Date.now() };
      await save(history);
      return history[idx];
    }
  }

  // Create new conversation
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    messages,
    timestamp: Date.now(),
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await save(history);
  return entry;
}

export async function deleteConversation(id) {
  const history = await getChatHistory();
  const next = history.filter((c) => c.id !== id);
  await save(next);
  return next;
}

export async function clearHistory() {
  await save([]);
}

// Format a relative time label
export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString();
}
