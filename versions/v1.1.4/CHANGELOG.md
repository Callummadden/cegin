# v1.1.4

Released: June 19, 2026

## Fixes
- Fixed meal plan not syncing to server (open mode crash)
- Fixed notifications, push tokens, scanned items crashing in open mode
- Fixed cookbook photos not displaying (server image paths now resolve to full URLs)
- Fixed GENERATE LIST button overlapping bottom nav in recipe picker
- Removed all user_id foreign key constraints (open mode uses user_id=0)
