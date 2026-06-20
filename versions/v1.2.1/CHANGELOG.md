# v1.2.1

Released: June 20, 2026

## Real-Time Sync
- Added WebSocket-based real-time sync between devices sharing the same server
- Changes made on one device (add, edit, delete) appear instantly on all other connected devices
- Pull-to-refresh now fetches fresh data from the server instead of returning cached data
- No configuration needed — connects automatically using the existing server URL

## Server
- WebSocket server on same port as HTTP (no extra setup or port forwarding)
- All mutating endpoints broadcast change events to connected clients
- Supported: recipes, collections, meal plans, shopping lists, favorites, cookbook, stats, dietary profiles, activity context, chat history, scanned items

## Responsive Layout
- All 12 screens now scale dynamically to any device size (phones, tablets, foldables)
- Added responsive scaling utility (`useResponsive` hook) — `s()` for spatial values, `fs()` for fonts
- Base reference updated to 412px wide (Pixel 7 / typical modern Android)
- Scale capped at 1.0 — elements never get bigger than the base size, only smaller on compact phones
- Applied to: padding, margins, gaps, font sizes, icon sizes, border radius, component dimensions

## Material You
- Implemented native Android module to read wallpaper accent color for Material You theming
- Reads accent from Android system settings first, falls back to WallpaperManager
- Falls back to default purple seed if device doesn't expose wallpaper colors

## Scan Recipe (New)
- Take a photo or pick from gallery — on-device OCR reads the text (no internet needed)
- Automatically extracts title, ingredients, instructions, time, and servings
- Preview and edit results before saving
- Uses Google ML Kit for fast, private text recognition

## UI Polish
- Floating pill-shaped nav bars on Recipe List, Shopping List, and Pick Recipes screens
- Nav bars contain title, search, action buttons — matching the bottom nav aesthetic
- Recipe list: CEGIN wordmark, search bar, sort, view mode, settings in top nav
- Shopping list: title, add input, AUTO and ⚡ buttons in top nav
- Category tabs (ALL, FAVES, QUICK, etc.) float below the nav bar with surface backgrounds
- Top navs float transparently over content — recipes/items visible when scrolling
- All rounded corners across 12 screens softened to match pill aesthetic (buttons, cards, inputs, badges, segments)
- Search bar and sort button in pill shape matching bottom nav
- Added CLEAR button to search history chips
- Search now filters locally — no server fetch per keystroke, no more flashing
- History only saves on submit (Enter), not on every keystroke
- Recipe images fade in smoothly over 600ms instead of popping in abruptly
- Default view mode changed to grid (two columns)
- FAB button shows menu with URL, Manual, and Scan Photo options
- Help buttons (?) on Manual and Scan screens explain how each section works
- "Clean up with AI" renamed to "Clean up with Terry"
- HISTORY button moved to far right in Terry chat header
- Image URL input replaced with Camera/Gallery buttons on manual recipe page

## Fixes
- Fixed Terry Vision screen layout on smaller devices — capture buttons and photos no longer get cut off
- Reduced section card padding, photo height, and button sizes for better small-screen fit
- Fixed noisy `[WS] Error: unknown` console spam in React Native
- Fixed crash on Settings screen — `styles` was never assigned, causing `Property 's' doesn't exist` error
- Fixed crash on Cookbook and Shopping List — `swipeStyles` was calling `s()/fs()` at module level before the hook existed
- Fixed standalone components (`TerryAvatar`, `HistoryModal`, `MessageBubble`, `TypingDots`, `ToggleRow`) referencing `styles` from parent scope — now passed as prop
- Fixed search saving partial words while typing — now only saves on submit
- Removed import URL section from manual recipe edit page
- Fixed cookbook entries duplicating in server mode — was double-writing to local cache and WebSocket refresh
- Fixed delete/update cookbook entries also double-writing
- Fixed scan recipe crashing app on startup by lazy-loading ML Kit native module
- Added vision-based recipe scanning (Clean & Fix with Terry) — sends photo to configured vision AI
- Added privacy note that photo is shared with configured vision AI
- Image URL field replaced with Camera/Gallery buttons on manual recipe page
- Terry vision API endpoint: POST /api/ai/scan-recipe
