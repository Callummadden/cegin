import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const KEY = 'cegin_meal_plan';

// { "2026-06-13": { breakfast: recipeId, lunch: recipeId, dinner: recipeId }, ... }
let _cache = null;

export async function getMealPlan() {
  if (_cache) return _cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

// Synchronous getter — returns cached plan instantly (or {} if never loaded)
export function getCachedPlan() {
  return _cache || {};
}

async function save(plan) {
  _cache = plan;
  await AsyncStorage.setItem(KEY, JSON.stringify(plan));
  // Sync to server so Chef Terry's cron can send morning digests
  try {
    await api.syncMealPlan(plan);
  } catch {
    // Server offline — plan is still saved locally, will sync next time
  }
}

export async function clearMealPlan() {
  _cache = {};
  await AsyncStorage.removeItem(KEY);
  try { await api.syncMealPlan({}); } catch {}
  return {};
}

export async function setMeal(date, meal, recipeId) {
  const plan = JSON.parse(JSON.stringify(await getMealPlan()));
  if (!plan[date]) plan[date] = {};
  plan[date][meal] = recipeId;
  await save(plan);
  return plan;
}

export async function clearMeal(date, meal) {
  const plan = JSON.parse(JSON.stringify(await getMealPlan()));
  if (plan[date]) {
    delete plan[date][meal];
    if (!Object.keys(plan[date]).length) delete plan[date];
  }
  await save(plan);
  return { ...plan };
}

// Format date as YYYY-MM-DD using LOCAL time (not UTC)
export function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get the Monday of the current week
export function getWeekStart(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export const MEALS = ['breakfast', 'lunch', 'snack', 'dinner', 'dessert'];

export const MEAL_META = {
  breakfast: { icon: '🥞', label: 'Breakfast', color: '#FFB74D' },
  lunch:     { icon: '🥗', label: 'Lunch',     color: '#4FC3F7' },
  snack:     { icon: '🍿', label: 'Snack',     color: '#AED581' },
  dinner:    { icon: '🍝', label: 'Dinner',    color: '#CE93D8' },
  dessert:   { icon: '🍰', label: 'Dessert',   color: '#F48FB1' },
};
