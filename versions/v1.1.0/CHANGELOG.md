# v1.1.0

Released: June 18, 2026

## Changes

### Settings
- Reorganized settings page — cleaner section order: About → Appearance → Features → Notifications → Health & Diet → Data → Developer
- Merged notification permissions and toggles into a single section (was split across two)
- Moved No AI toggle into its own Features section (✨)
- New hero-style About card with version badge and mode/AI status summary
- Added section icons (🎨✨🔔🥗📦⚙️) for visual identity
- Extracted reusable ToggleRow component for consistent toggle styling
- Moved static styles out of makeStyles into StyleSheet.create (performance)

### AI & Models
- AI Assistant section now shows both text and vision model names
- Model picker: discover and change models from the app via OpenAI-compatible /v1/models endpoint
- Setup wizard AI step: "Find Available Models" button auto-discovers models after entering API key
- Server mode: change models directly from the app (queries provider's /v1/models, updates at runtime)
- Terry now has access to dietary profiles in every chat — profiles are sent with each message and included in the system prompt, so Terry always respects dietary needs without having to ask

### Setup & Onboarding
- Added Health & Diet step to setup wizard (appears after server/local mode selection)
- Permissions step added to setup wizard — requests notification and camera permissions during onboarding

### Navigation
- Redesigned bottom nav — solid pill shape with reduced width, "Log" label (was "Kitchen Log")
- Bottom nav is now absolutely positioned — content scrolls behind it

### Terry (AI Assistant)
- Welcome screen is no longer scrollable — locked in place until a conversation starts
- Fixed text bar staying up after keyboard closes — removed KeyboardAvoidingView, switched to direct keyboard height tracking
- Redesigned Data and Developer sections — card-style toggles with descriptions, row-based data actions

### Server & Docker
- Fixed Dockerfile permission issue (COPY --chown=node:node)
- Fixed "fetch request has been cancelled" error in APK builds — AI requests now use a 60s timeout instead of 8s (regular API calls stay at 8s)

### Privacy
- Rewrote privacy policy "What Cegin collects" section — now "What data the app stores" with clear language that Cegin doesn't collect anything, data stays on user's device/server
