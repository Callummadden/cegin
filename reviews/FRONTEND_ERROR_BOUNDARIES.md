# Frontend Error Boundaries

## Summary

Added React error boundaries to the Cegin mobile app to prevent single-screen crashes from killing the entire application.

## Files Created

| File | Purpose |
|------|---------|
| `mobile/src/components/ErrorBoundary.js` | Reusable error boundary component |
| `mobile/src/components/ScreenGroups.js` | Group wrappers for screen categories |
| `FRONTEND_ERROR_BOUNDARIES.md` | This document |

## File Modified

| File | Changes |
|------|---------|
| `mobile/App.js` | Wrapped root navigator + all screens with error boundaries |

## Architecture

### ErrorBoundary (`src/components/ErrorBoundary.js`)

- Class component (required by React `getDerivedStateFromError` / `componentDidCatch`)
- Wraps inner class with a functional component to access `useTheme()` for dynamic colors
- Fallback UI: 🍳 emoji, "Something went wrong" title, error message, "Try Again" button
- Logs error + component stack to console in `__DEV__` mode only
- "Try Again" resets error state to re-render children

### Screen Groups (`src/components/ScreenGroups.js`)

Four group wrappers, each wrapping its children in an `ErrorBoundary`:

| Group | Screens |
|-------|---------|
| **RecipeGroup** | RecipeList, RecipeDetail, EditRecipe, ScanRecipe, Cookbook |
| **MealPlanningGroup** | MealPlanner, ShoppingList |
| **CookingGroup** | CookMode, TerryVision |
| **SettingsGroup** | Settings, Assistant, Stats, Setup |

### App.js Changes

1. **Root-level boundary**: `<ErrorBoundary>` wraps the entire `<Stack.Navigator>` — catches any error that escapes per-screen boundaries
2. **Per-screen boundaries**: Each `Stack.Screen` component is wrapped via a `wrap(Group, Screen)` HOC, so a crash in one screen shows the fallback without killing navigation to other screens
3. Screens are organized with JSX comments (`{/* Recipes */}`, etc.) for readability

## Error Handling Flow

```
App crash → nearest screen-group ErrorBoundary catches it
           → shows fallback UI with error message
           → user taps "Try Again" → boundary resets, screen re-renders
           → if error propagates past group → root ErrorBoundary catches it
           → in __DEV__: error + component stack logged to console
```
