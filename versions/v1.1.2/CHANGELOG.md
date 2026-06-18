# v1.1.2

Released: June 19, 2026

## Changes

### Server Sync
- Kitchen log, cooking streaks, and cook counts now sync to the Docker server in server mode
- Previously these were stored only in local AsyncStorage and lost on app reinstall
- Falls back to local storage when server is offline
