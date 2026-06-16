import AsyncStorage from '@react-native-async-storage/async-storage';

const STATS_KEY = 'cegin_stats';
const COOK_DATES_KEY = 'cegin_cook_dates';

// { cookCount: number, recipeCookCounts: { [recipeId]: number }, totalSteps: number }
let _cache = null;

const defaults = {
  cookCount: 0,
  recipeCookCounts: {},
  totalSteps: 0,
};

export async function getStats() {
  if (_cache) return _cache;
  const raw = await AsyncStorage.getItem(STATS_KEY);
  try {
    _cache = raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    _cache = { ...defaults };
  }
  return _cache;
}

async function save(stats) {
  _cache = stats;
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export async function recordCook(recipeId, recipeTitle, stepCount) {
  const stats = await getStats();
  stats.cookCount += 1;
  stats.totalSteps += stepCount;
  if (!stats.recipeCookCounts[recipeId]) {
    stats.recipeCookCounts[recipeId] = { title: recipeTitle, count: 0 };
  }
  stats.recipeCookCounts[recipeId].count += 1;
  stats.recipeCookCounts[recipeId].title = recipeTitle; // update title in case it changed
  await save(stats);

  // Record cook date for streak tracking
  await recordCookDate();
}

async function recordCookDate() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const raw = await AsyncStorage.getItem(COOK_DATES_KEY);
  let dates;
  try { dates = raw ? JSON.parse(raw) : []; } catch { dates = []; }
  // Add today if not already present
  if (!dates.includes(today)) {
    dates.push(today);
    // Keep only last 90 days to avoid unbounded growth
    if (dates.length > 90) dates = dates.slice(-90);
    await AsyncStorage.setItem(COOK_DATES_KEY, JSON.stringify(dates));
  }
}

export async function getCookingStreak() {
  const raw = await AsyncStorage.getItem(COOK_DATES_KEY);
  let dates;
  try { dates = raw ? JSON.parse(raw) : []; } catch { dates = []; }
  if (dates.length === 0) return 0;

  // Sort dates descending
  const sorted = [...dates].sort().reverse();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const yDate = new Date(Date.now() - 86400000);
  const yesterday = `${yDate.getFullYear()}-${String(yDate.getMonth()+1).padStart(2,'0')}-${String(yDate.getDate()).padStart(2,'0')}`;

  // Streak must include today or yesterday to be active
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((prev - curr) / 86400000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getTopRecipes(limit = 5) {
  const stats = await getStats();
  return Object.entries(stats.recipeCookCounts)
    .map(([id, { title, count }]) => ({ id, title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function clearStats() {
  _cache = { ...defaults };
  await AsyncStorage.multiRemove([STATS_KEY, COOK_DATES_KEY]);
}
