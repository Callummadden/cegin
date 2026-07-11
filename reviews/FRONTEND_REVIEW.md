# Cegin Mobile — Frontend Review

**Reviewed:** 2026-07-11 (v1.3.1, Expo SDK 56)
**Scope:** `mobile/src/` — 13 screens, 10 components, 8 utils, 15 data/service modules

---

## Summary

The codebase is well-structured with consistent patterns, good theming, and thoughtful UX (optimistic deletes, progressive disclosure, cache-first loading). The main areas for improvement are: missing error boundaries, zero accessibility labels, duplicated utility code, and oversized screen components.

---

## 1. Component Architecture

### ✅ Strengths

- **Consistent screen pattern:** Every screen follows `useTheme() → useResponsive() → useMemo(makeStyles)` — easy to reason about.
- **Good shared components:** `BottomNav`, `Toast`, `SwipeableRow`, `AppModal`, `Skeleton`, `TutorialOverlay`, `GlobalTimerBar`, `AiDisclaimer`, `VersionBanner` — well-factored.
- **Context providers:** Theme, Timer, Toast, Ai — clean separation, proper `useMemo` on context values.

### ❌ Issues

#### 1.1 No Error Boundaries

There are zero `ErrorBoundary` components in the app. A crash in any screen (e.g., malformed recipe data, null image URL) will crash the entire app with no recovery.

**Recommendation:** Add an `ErrorBoundary` component wrapping the `Stack.Navigator`:

```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return <FallbackUI error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
```

Wrap in `App.js` around `<AppNavigator />`. Also consider per-screen boundaries for heavy screens (RecipeDetail, CookMode).

#### 1.2 Screens Are Too Large

| Screen | Lines | State vars |
|--------|-------|------------|
| RecipeListScreen | 1,423 | ~20 |
| SettingsScreen | 1,394 | ~20 |
| RecipeDetailScreen | 1,374 | ~20 |
| AssistantScreen | 1,098 | ~15 |
| SetupScreen | 1,010 | ~20 |
| TerryVisionScreen | 977 | ~10 |
| ShoppingListScreen | 945 | ~20 |
| CookModeScreen | 847 | ~15 |

**Recommendation:** Extract sub-components:
- `RecipeListScreen` → `RecipeCard`, `RecipeListHeader`, `SearchBar`, `FilterTabs`, `CollectionPicker`
- `RecipeDetailScreen` → `IngredientList`, `StepList`, `NutritionCard`, `DietaryAuditCard`, `SubstitutionPicker`
- `SettingsScreen` → `ThemeSection`, `AIServerSection`, `DietProfilesSection`, `DataSection`
- `ShoppingListScreen` → `QuickAddPanel`, `ShoppingItem`, `RecipePicker`

#### 1.3 Only 1 `memo()` Usage

`MessageBubble` in `AssistantScreen` is the only `React.memo`-wrapped component. Other frequently re-rendered list items (recipe cards, shopping items, cookbook entries, meal plan slots) are not memoized.

**Recommendation:** Wrap these in `React.memo`:
- Recipe card/list/grid renderers in `RecipeListScreen`
- Shopping list item rows
- Cookbook entry cards
- Meal plan day cells

---

## 2. State Management

### ✅ Strengths

- **Cache-first pattern:** All data modules (`shoppingList`, `mealPlan`, `cookbook`, `stats`, `dietProfiles`, `favorites`, `chatHistory`) follow `_cache` + `forceRefresh` + AsyncStorage fallback.
- **Context values memoized:** `TimerProvider`, `ThemeProvider`, `AiProvider` all use `useMemo` on their context values.
- **WebSocket sync:** Clean pub/sub pattern with `subscribe()` and debounced cache clearing.

### ❌ Issues

#### 2.1 Silent Error Swallowing

57 instances of empty `catch {}` blocks across the codebase. Most are in data modules and API calls. While some are intentional (offline fallback), many hide real errors that should at least be logged.

**Files with most empty catches:**
- `api.js` — 15 instances
- `wsSync.js` — 7 instances
- `offlineCache.js` — 4 instances
- `CookModeScreen.js` — 4 instances

**Recommendation:** Replace with `catch (e) { console.warn('[Module] operation failed:', e.message); }` for non-critical paths, or `catch { /* intentional: offline fallback */ }` with a comment for truly intentional ones.

#### 2.2 `load()` Functions Not Guarded Against Race Conditions

Multiple screens define `load()` via `useCallback` and call it from `useFocusEffect` + WebSocket subscription + pull-to-refresh. If two calls overlap (e.g., focus + WS event), the second may overwrite the first with stale data.

**Affected screens:** RecipeListScreen, ShoppingListScreen, MealPlannerScreen, CookbookScreen

**Recommendation:** Add an abort/cancellation pattern:

```jsx
const load = useCallback(async (forceRefresh = false) => {
  const id = ++loadIdRef.current;
  const data = await fetchData(forceRefresh);
  if (id === loadIdRef.current) setData(data);
}, []);
```

---

## 3. Code Duplication

### 3.1 `splitLines` — Utility Exists But Unused

`src/utils/splitLines.js` defines `splitLines()` but **no file imports it**. Two screens define it inline instead:

- `EditRecipeScreen.js:120` — `const splitLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);`
- `ScanRecipeScreen.js:159` — identical

**Fix:** Import from `../utils/splitLines` and remove inline definitions.

### 3.2 `parseTimerMins` — Utility Exists But Duplicated

`src/utils/timerUtils.js` defines `parseTimerMins()` but two screens have their own local versions:

- `RecipeDetailScreen.js:49` — local `parseTimerMins()` (single match)
- `CookModeScreen.js:75` — local `parseTimerMins()` wrapping `findAllTimers()`

Both screens already import `fmtClock` from `timerUtils` but use their own timer parsing.

**Fix:** Consolidate into `timerUtils.js` (the `findAllTimers` variant from CookModeScreen is more capable) and import everywhere.

### 3.3 `formatDate` — Defined in 2 Places

- `mealPlan.js:95` — `formatDate(d)` for date objects → `YYYY-MM-DD`
- `CookbookScreen.js:32` — `formatDate(iso)` for ISO strings → `3 Jan 2026`

Different functions, same name. The CookbookScreen version should be renamed (e.g., `formatDisplayDate`) or moved to a shared utility.

### 3.4 `buildRecipe` — Pattern Duplicated

Both `EditRecipeScreen.js:122` and `ScanRecipeScreen.js:161` have nearly identical `buildRecipe()` and `splitLines()` logic.

**Fix:** Extract to `src/utils/recipeBuilder.js`.

### 3.5 `ALL_BUILT_IN` Shopping Items

`ShoppingListScreen.js:135` has a 100+ item inline array. This should be in a separate data file.

---

## 4. Accessibility

### ❌ Critical: Zero Accessibility Labels

There are **0 instances** of `accessibilityLabel`, `accessible`, `accessibilityRole`, or `accessibilityHint` in the entire codebase.

**Impact:** The app is completely unusable with screen readers (TalkBack/VoiceOver).

**Priority fixes:**
1. All `Pressable` buttons need `accessibilityLabel` (navigation tabs, FAB, swipe actions, timer controls)
2. Images need `accessibilityLabel` (recipe photos, Terry avatars)
3. `accessibilityRole="button"` on all interactive elements
4. `accessibilityRole="header"` on section titles
5. Timer state changes need `accessibilityLiveRegion="polite"`
6. Toast messages need `accessibilityLiveRegion="assertive"`

**Quick wins:**
- `BottomNav.js` — add `accessibilityLabel={t.label}` and `accessibilityRole="tab"` to each tab
- `Toast.js` — add `accessibilityLiveRegion="assertive"` to the toast container
- `GlobalTimerBar.js` — add `accessibilityLabel` to pause/resume/cancel buttons
- `AppModal.js` — add `accessibilityRole="alert"` to the modal card

---

## 5. Performance

### ✅ Strengths

- **Image cache management:** `Image.clearMemoryCache()` called on screen unmount (RecipeList, RecipeDetail, MealPlanner, Cookbook) and app backgrounding.
- **`unmountOnBlur: true`** on Stack.Navigator — prevents memory buildup from inactive screens.
- **Wall-clock timers:** `timerContext.js` uses `endTime` + 500ms polling (not 1s interval) — accurate after backgrounding.
- **Memoized styles:** All screens use `useMemo(() => makeStyles(...), [colors, s, fs])`.

### ❌ Issues

#### 5.1 `Dimensions.get('window')` at Module Level

Three files capture screen dimensions at import time, which won't update on rotation or split-screen:

- `TutorialOverlay.js:18` — `const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');`
- `RecipeListScreen.js:232` — `Dimensions.get('window').width` inside a callback
- `SetupScreen.js:28` — `const { width: SCREEN_W } = Dimensions.get('window');`

**Fix:** Use `useWindowDimensions()` hook (already used in `responsive.js`) or call `Dimensions.get()` inside the component/callback.

#### 5.2 FlatList Missing Optimizations

| Screen | FlatList | keyExtractor | getItemLayout |
|--------|----------|-------------|---------------|
| RecipeListScreen | ✅ | ✅ | ❌ |
| ShoppingListScreen | ✅ | ✅ | ❌ |
| AssistantScreen | ✅ | ✅ | ❌ |
| CookbookScreen | ✅ | ✅ | ❌ |
| MealPlannerScreen | ✅ | ❌ | ❌ |

No screens provide `getItemLayout`, which prevents scroll-to-index optimizations and causes layout recalculation.

**Recommendation:** Add `getItemLayout` for fixed-height lists (shopping items, cookbook entries). Use `estimatedItemSize` for variable-height lists (recipe cards).

#### 5.3 `activeTimerCount` Recalculated Every Render

In `RecipeListScreen.js:107`:
```jsx
const activeTimerCount = Object.keys(timers).filter((id) => !timers[id]).length;
```

This runs on every render. Should be wrapped in `useMemo`.

#### 5.4 RecipeDetailScreen Runs USDA + AI Audit on Every Focus

`useFocusEffect` in RecipeDetailScreen runs USDA nutrition estimation and dietary audit every time the screen is focused (lines 116-176). The audit has cache, but the USDA `estimateNutrition` call is uncached and runs every time.

**Fix:** Cache the USDA result alongside the audit cache, or skip if recipe hasn't changed.

---

## 6. Theme Consistency

### ✅ Strengths

- **7 theme palettes + Material You + OLED accent presets** — comprehensive theming.
- **Consistent color tokens:** `background`, `surface`, `surface2`, `card`, `border`, `text`, `text2`, `textMuted`, `primary`, `primaryDark`, `onPrimary`, `danger`, `success`.
- **`MONO` font constant** exported from theme for monospace usage.

### ❌ Issues

#### 6.1 Hardcoded Colors in Components

Several components use hardcoded colors instead of theme tokens:

- **Markdown.js:** `rgba(255,255,255,0.08)`, `rgba(255,255,255,0.06)`, `#F6F1EA`, `#E2D9CF`, `#FF5A26`, `#2E2724`
- **SwipeableRow.js:** `#E5645B` (delete background), `#131010` (fallback background)
- **VersionBanner.js:** `#D32F2F`, `rgba(255,255,255,0.1)`, `rgba(255,255,255,0.7)`

**Fix:** Pass `colors` as a prop or use `useTheme()` in these components.

#### 6.2 `colors` Export Shadows Context

`theme.js:283` exports `const colors = darkColors;` — a static reference to the dark palette. This is used by some non-component code but could confuse developers into using the static export instead of `useTheme()`.

**Recommendation:** Rename to `defaultDarkColors` or remove if unused.

#### 6.3 SettingsScreen Has 10 Hardcoded Hex Colors

`SettingsScreen.js` has 10 hardcoded hex colors in `THEME_PREVIEWS` and other inline styles. Some are intentional (preview swatches) but others should use theme tokens.

---

## 7. React Native Anti-Patterns

### 7.1 `Image` from react-native in AssistantScreen and SettingsScreen

`AssistantScreen.js:9` imports `Image` from `react-native` (not `expo-image`), and `SettingsScreen.js:6` does the same. Every other screen uses `expo-image` which has better caching and performance.

**Fix:** Replace with `import { Image } from 'expo-image'` and update `source` prop format if needed.

### 7.2 `TouchableOpacity` in SwipeableRow

`SwipeableRow.js:5` uses `TouchableOpacity` from react-native. Modern RN best practice is `Pressable` (used everywhere else in the app).

**Fix:** Replace `TouchableOpacity` with `Pressable` and use `style` callback for opacity.

### 7.3 Inline `splitLines` in Components

Two screens define `splitLines` as an inline arrow function inside the component, creating a new function reference every render. The utility exists in `src/utils/splitLines.js`.

### 7.4 `PanResponder` Created Inside Render Path

`MealPlannerScreen.js:185` creates `PanResponder` via `useRef(PanResponder.create(...))` — this is correct (stable ref). But `SwipeableRow.js:34` also uses `useRef(PanResponder.create(...))` which is fine.

However, `RecipeListScreen.js` creates a PanResponder that's not wrapped in useRef (need to verify).

---

## 8. Missing Patterns

### 8.1 No Loading State Abstraction

Every screen independently manages `loading`, `error`, `data` states. This leads to 3-5 state variables per screen just for data fetching.

**Recommendation:** Consider a lightweight custom hook:

```jsx
function useAsyncData(fetcher, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // ... 
  return { data, loading, error, refetch };
}
```

### 8.2 No Consistent Pull-to-Refresh

Only 4 screens have pull-to-refresh: RecipeListScreen, ShoppingListScreen, MealPlannerScreen, CookbookScreen. Others (StatsScreen, SettingsScreen) don't, which is reasonable, but the pattern varies (some use `handleRefresh`, some inline).

### 8.3 No Skeleton Loading for Detail Screens

`RecipeDetailScreen` shows nothing while loading (just a null recipe). Should show skeleton placeholders.

---

## 9. Minor Issues

### 9.1 Console Logging in Production

72 `console.log/warn/error` calls across the codebase. Most are debug logging that should be stripped or gated behind `__DEV__`.

**Heaviest offenders:** `usdaNutrition.js` (22), `wsSync.js` (11), `RecipeDetailScreen.js` (8), `cookbook.js` (7)

### 9.2 `import * as ImagePicker` Unused ScanRecipeScreen

`ScanRecipeScreen.js:16` imports `ImagePicker` but only uses it inside `takePhoto` and `pickFromGallery`. This is fine but the `* as` import pulls in the entire module eagerly.

### 9.3 `AsyncStorage.getItem` Without Try-Catch

`RecipeListScreen.js:161` and `RecipeListScreen.js:168` call `AsyncStorage.getItem().then().catch()` — this is fine, but some other places don't have `.catch()`.

---

## 10. Recommended Priority Order

### High Priority (user-facing bugs/accessibility)
1. Add `ErrorBoundary` component (1-2 hours)
2. Add accessibility labels to all interactive elements (2-3 hours)
3. Replace hardcoded colors in Markdown/SwipeableRow/VersionBanner (30 min)

### Medium Priority (code quality/performance)
4. Deduplicate `splitLines`, `parseTimerMins`, `buildRecipe` (1 hour)
5. Wrap list item renderers in `React.memo` (1 hour)
6. Fix `Dimensions.get('window')` at module level (15 min)
7. Replace `Image` from react-native with `expo-image` in AssistantScreen/SettingsScreen (15 min)
8. Replace `TouchableOpacity` with `Pressable` in SwipeableRow (5 min)

### Low Priority (technical debt)
9. Extract sub-components from oversized screens (ongoing)
10. Add `getItemLayout` to FlatLists (30 min)
11. Gate console.log behind `__DEV__` (30 min)
12. Add comment annotations to intentional empty catches (30 min)
13. Create `useAsyncData` hook for loading states (1-2 hours)

---

## File Statistics

| Category | Files | Lines |
|----------|-------|-------|
| Screens | 13 | 11,318 |
| Components | 10 | 1,222 |
| Utils | 6 | 687 |
| Data/Service | 15 | 3,610 |
| **Total** | **44** | **~16,837** |
