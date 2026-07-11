# Documentation Update Summary

**Date:** 2026-07-11
**Author:** Automated documentation update

## Changes Made

### README.md — Complete Rewrite

The README was rewritten from a functional but minimal document into a comprehensive, professional project README. Changes include:

- **Added centre-aligned header** with project name, tagline, and website link
- **Added badges row** — GPL-3.0 license, Docker Hub, GitHub Release, Node.js, Expo SDK, GitHub Stars
- **Added project description** — clear two-sentence summary of what Cegin is and what it does
- **Retained all screenshots** — same layout, same images, same alt text
- **Expanded features list** — from 6 bullet points to 14, adding USDA Nutrition, allergen flags, offline-first, multi-device sync, multi-image recipes, and kitchen log
- **Added Tech Stack table** — server, mobile, AI providers, auth, images, deployment, security
- **Restructured Quick Start** — clearer Docker section with numbered steps, added JWT_SECRET to secrets setup, added separate Local Development section
- **Added API Documentation link** — pointing to `docs/API.md`
- **Added Architecture section** — ASCII diagram showing server components and data flow, plus a comparison table of Server Mode vs Local Mode
- **Moved Chef Terry section** — expanded with recipe generation and URL import features
- **Moved AI Providers table** — same content, better context
- **Reorganised Security section** — added rate limiting, SSRF protection, Helmet, per-user scoping
- **Moved Backups & Data** — same content
- **Retained Project Structure** — same tree, added `docs/API.md` entry
- **Moved Development section** — same content
- **Added Troubleshooting table** — converted from bullet list to structured table
- **Added Contributing section** — fork/branch/PR workflow, guidelines
- **Added License section** — explicit GPL-3.0 reference
- **Removed duplicate code fences** at end of file

### docs/API.md — New File

Created comprehensive REST API documentation covering every `/api/*` endpoint in the server. Structure:

- **Table of Contents** with anchor links to each section
- **Authentication section** — register, login, me endpoints with rate limiting notes
- **AI Assistant section** — all 14 AI endpoints (chat, recipe, import, tidy, convert, shopping-list, meal-plan, audit-recipe, apply-substitutions, fix-mistake, adjust-cooking, nutrition, prep-steps, scan-fridge, scan-recipe)
- **Recipes section** — CRUD + search, with full field documentation
- **Recipe Images section** — add/list/delete images per recipe
- **Collections section** — full CRUD + recipe membership management
- **Notifications section** — settings, register/unregister tokens, test
- **Meal Plans section** — get and sync
- **Scanned Items section** — get, add, mark consumed
- **Shopping List section** — get, replace, clear
- **Favorites, Chat History, Dietary Profiles, Activity Context** — get/replace/clear
- **Cookbook Entries section** — CRUD with photo uploads
- **Terry Vision Scans section** — CRUD with photo uploads
- **Cook Stats section** — get, record, clear
- **Image Proxy section** — SSRF-protected image resizing
- **Static Files section** — cookbook and terry-vision uploads
- **WebSocket section** — connection, incoming message types, ping/pong
- **Error Responses section** — standard error format and HTTP status codes

Each endpoint includes: method, path, request body schema, response schema, required/optional fields, and error codes.

## Files Modified

| File | Action | Size |
|:-----|:-------|:-----|
| `README.md` | Rewritten | ~16 KB |
| `docs/API.md` | Created | ~25 KB |
| `DOCS_UPDATE.md` | Created | This file |

## Notes

- All existing screenshot references are preserved (paths unchanged)
- All existing quick start instructions are preserved (just restructured)
- The API documentation is derived from reading `server/index.js` (1213 lines) and `server/db.js` (1072 lines) — every route defined in the source is documented
- License confirmed as GPL-3.0 from `LICENSE` file
- Server version confirmed as `1.3.2` from `server/package.json`
