// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppMode } from './config';

const HISTORY_KEY = 'cegin_chat_history';
const MAX_HISTORY = 50;
let _cache = null;

// Each conversation: { id, title, messages, timestamp }

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getChatHistory() {
  if (_cache) return _cache;
  if (await isServerMode()) {
    try {
      const server = await api.getChatHistory();
      if (server) {
        _cache = server;
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(server));
        return server;
      }
    } catch {
      // Fall through to local
    }
  }

  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    _cache = raw ? JSON.parse(raw) : [];
    return _cache;
  } catch {
    return [];
  }
}

async function save(history) {
  _cache = history;
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));

  if (await isServerMode()) {
    try {
      await api.syncChatHistory(history);
    } catch {
      // Server offline — saved locally
    }
  }
}

// Save or update a conversation. If conversationId is provided, update it.
export async function saveConversation(messages, conversationId = null) {
  if (!messages.length) return;
  const history = await getChatHistory();
  const title = messages.find((m) => m.role === 'user')?.content?.slice(0, 60) || 'Untitled chat';

  if (conversationId) {
    const idx = history.findIndex((c) => c.id === conversationId);
    if (idx !== -1) {
      history[idx] = { ...history[idx], title, messages, timestamp: Date.now() };
      await save(history);
      return history[idx];
    }
  }

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
  _cache = null;
  if (await isServerMode()) {
    try {
      await api.clearChatHistory();
    } catch (_e) { if (__DEV__) console.warn(\'[chatHistory] Caught error:\', _e.message); }
  }
  await save([]);
}

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
