// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getAppMode } from './config';

const KEY = 'cegin_shopping_list';

// Each item: { id: string, text: string, checked: boolean, category?: string, source?: string }
let _cache = null;

async function isServerMode() {
  const mode = await getAppMode();
  return mode === 'server';
}

export async function getShoppingList(forceRefresh = false) {
  if (forceRefresh) _cache = null;
  if (_cache) return _cache;

  if (await isServerMode()) {
    try {
      const server = await api.getShoppingList();
      if (server) {
        _cache = server;
        await AsyncStorage.setItem(KEY, JSON.stringify(server));
        return _cache;
      }
    } catch {
      // Fall through to local
    }
  }

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

  if (await isServerMode()) {
    try {
      await api.syncShoppingList(list);
    } catch {
      // Server offline — saved locally
    }
  }
}

function isDuplicate(newText, existingTexts) {
  const lower = newText.toLowerCase();
  if (existingTexts.has(lower)) return true;
  for (const existing of existingTexts) {
    if (lower.includes(existing) || existing.includes(lower)) return true;
  }
  return false;
}

export async function addItems(texts) {
  const list = await getShoppingList();
  const existing = new Set(list.map((i) => i.text.toLowerCase()));
  const newItems = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !isDuplicate(t, existing))
    .map((t) => {
      existing.add(t.toLowerCase());
      return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, checked: false };
    });
  if (newItems.length) {
    await save([...list, ...newItems]);
  }
  return _cache;
}

export async function addItemsGrouped(categories) {
  const list = await getShoppingList();
  const existing = new Set(list.map((i) => i.text.toLowerCase()));
  const newItems = [];
  for (const cat of categories) {
    for (const item of cat.items) {
      const text = typeof item === 'string' ? item : item.text;
      const trimmed = text.trim();
      if (trimmed && !isDuplicate(trimmed, existing)) {
        existing.add(trimmed.toLowerCase());
        const recipes = typeof item === 'string' ? [] : (item.recipes || []);
        newItems.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          text: trimmed,
          checked: false,
          category: cat.name,
          source: recipes.join(', '),
        });
      }
    }
  }
  if (newItems.length) {
    await save([...list, ...newItems]);
  }
  return _cache;
}

export async function toggleItem(id) {
  const list = await getShoppingList();
  const next = list.map((i) => i.id === id ? { ...i, checked: !i.checked } : i);
  await save(next);
  return next;
}

export async function deleteItem(id) {
  const list = await getShoppingList();
  const next = list.filter((i) => i.id !== id);
  await save(next);
  return next;
}

export async function removeChecked() {
  const list = await getShoppingList();
  const next = list.filter((i) => !i.checked);
  await save(next);
  return next;
}

export async function clearList() {
  if (await isServerMode()) {
    try {
      await api.clearShoppingList();
    } catch {}
  }
  await save([]);
  return [];
}

export function clearCache() {
  _cache = null;
}
