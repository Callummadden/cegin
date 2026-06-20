# Changelog

## 1.2.4 — 2026-06-20

### Timer Notifications
- Fixed notification trigger format for SDK 56 (old format silently rejected)
- Fixed duplicate timer notifications — one per timer, scheduled at start
- Timer uses `setAlarmClock()` for exact scheduling (bypasses OEM battery optimization)
- Notification channel initialized eagerly at app startup

### Timer Alarm
- Fixed timer alarm not stopping when dismissed (audio kept looping)
- Fixed `player.stop()` not being called before `player.release()` on Android

### Timer Accuracy
- Fixed timer drift — now uses wall-clock time instead of interval counting
- Timer and notification stay perfectly in sync

### Timer Bar
- Tap timer pill to jump back to the exact step in cook mode
- Finished timers stay visible in the bar with green border and "0:00"
- DISMISS button to clear a finished timer (stops alarm and vibration)
- Cook mode stays mounted in background — returning from timer bar is instant
- Keep-awake only active when cook mode is focused

## 1.2.3 — 2026-06-20

### Terry Vision
- Photos now sync to server — scans are shared across all your devices
- Server stores photos and ingredient data per scan
- Falls back to local storage when server is offline
- Deleting a scan removes it from server too

### Terry AI Assistant
- Terry can now perform actions: add to shopping list, add to meal plan, save recipes
- Action results show as confirmation messages in chat
- Updated system prompt with action capabilities

### Cook Mode
- Global timer bar visible on every screen (top in cook mode, bottom elsewhere)
- Tap a timer pill to navigate back to the correct step in cook mode
- Timer shows background notifications when app is closed
- "Something's Wrong" and "Adjust" buttons restyled as floating pill bar

### Recipes
- Delete is now instant (optimistic removal) with undo toast
- Recipe count restored in top nav bar

### WebSocket Sync
- Added ping/pong keepalive (15s interval, 10s timeout)
- Force reconnect on app foreground (drops stale connections)
- Debounced change callbacks (150ms) to prevent redundant fetches
- Server-side dead connection cleanup every 30s

### Fixes
- Fixed FAB touch area when timer bar is present
- Fixed Terry Vision camera crash on Android (ActivityResultLauncher)
- Fixed hook ordering crash in TerryVisionScreen

## 1.2.2 — 2026-06-20

### Terry Vision
- Multi-photo support: scan multiple fridges, cupboards, or freezers per section
- Photos display in a horizontal scroll with camera/gallery buttons on the left
- Auto-remove photos when AI can't identify any items (with red error toast)
- "FROM YOUR RECIPES" — matches scanned ingredients against your saved recipes (top 3, expandable)
- "TERRY SUGGESTS" — AI-generated recipe ideas with "GENERATE MORE" button for fresh suggestions
- Match scores show how many of the recipe's ingredients you have (e.g. 5/7)

### Recipes
- New "URL" vs "MANUAL" mode when adding recipes — URL import shows dedicated input first, form appears after import with "MAKE EDITS" header
- Renamed "SCAN PHOTO" to "SCAN RECIPE" in add recipe menu

### Fixes
- Fixed Terry Vision camera crash (ActivityResultLauncher error on Android)
- Fixed URL import missing from new recipe screen
- Toast component now supports custom text color and duration
- Fixed hook ordering crash in TerryVisionScreen

## 1.2.1

- Previous release
