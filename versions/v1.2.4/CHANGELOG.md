# Changelog

## 1.2.4 — 2026-06-20

### Timer Bar
- Tap timer pill to jump back to the exact step in cook mode
- Finished timers stay visible in the bar with green border and "0:00"
- DISMISS button to clear a finished timer (stops alarm and vibration)
- Cook mode stays mounted in background — returning from timer bar is instant
- Keep-awake only active when cook mode is focused

### Timer Notifications
- Fixed notification trigger format for SDK 56 (old format silently rejected)
- Fixed notification channel initialization at app startup
- Fixed duplicate timer notifications (one per timer, scheduled at start)
- Timer uses `setAlarmClock()` for exact scheduling (bypasses OEM battery optimization)
- Notification channel uses longer vibration pattern for alarm feel

### Timer Alarm
- Fixed timer alarm not stopping when dismissed (audio kept looping)
- Added `stopAlarm` callback so `cancelTimer` can stop audio before removing from state
- Fixed `player.stop()` not being called before `player.release()` (Android needs both)
- Removed duplicate vibration useEffect block in CookModeScreen

### Timer Accuracy
- Fixed timer drift — now uses wall-clock time (`endTime = Date.now() + seconds * 1000`)
- Each tick recalculates remaining time from `endTime - Date.now()` instead of decrementing by 1
- Timer and notification stay perfectly in sync regardless of interval drift

### Fixes
- Added `initNotifications()` called at app startup to eagerly create notification channels
- Added `USE_EXACT_ALARM` permission for Android 12+ exact alarm scheduling
- Added native `ExactAlarm` module to check/request exact alarm permission at runtime
