# Memo PWA Specifications

## Purpose

Memo PWA is a single-page, offline-first memo editor that runs entirely in the browser. It provides multi-note management, per-note version history, search/replace with highlighting, and optional manual sync to a server. The app is delivered as static HTML/CSS/JS with dynamic PWA assets registered at runtime.

## Application Architecture

* **Entry point:** A single HTML page loads the application and initializes the client-side logic.
* **Client controllers:** The application wires UI elements to the following functional components:

  * Notes controller for CRUD, switching, and versioning.
  * Search controller for find/highlight behavior.
  * History store for per-memo undo/redo.
  * Import/export controller for JSON portability.
  * Sync controller for manual server sync.
  * PWA bootstrap for manifest and service worker registration.
  * Persistence and preferences for local storage management.
* **Server implementation:** The optional sync server must be implemented in Python using asyncio and aiohttp.

## User Interface Specifications

### Layout

* **Top menu bar:** Fixed header with File/Edit/View menus and a status area showing the current memo title, search match counter, and save status.
* **Editor surface:** A textarea for input layered over a highlight-rendering surface; scrolling is kept in sync.
* **Bottom log panel:** Fixed footer with a scrollable log output. Visibility can be toggled.
* **Dialogs:** Modal overlays for Open, Rename, Find, Replace, Sync, and Versions actions.

### Menus & Actions

* **File:** New, Open, Rename, Export Selected, Export All, Import, Sync, Versions, Delete.
* **Edit:** Undo, Redo, Find, Next/Previous Match, Replace.
* **View:** Wrap toggle, Log toggle, Background theme (light/dark).

### Keyboard Shortcuts

* **Undo/Redo:** Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y).
* **Find:** Cmd/Ctrl+F.
* **Replace:** Cmd/Ctrl+H.
* **Find dialog navigation:** Enter for next match, Shift+Enter for previous.

## Data Model & Persistence

* **Primary database:** Stored in browser local storage under an application key and includes `{ version: 3, notes: [] }`. Each note includes `id`, `title`, `text`, `createdAt`, `updatedAt`, and `versions`.
* **Current note id:** Stored under a dedicated local storage key.
* **Preferences:** Wrap, theme, search options, log visibility, and sync settings are stored in local storage with dedicated keys.
* **Legacy migration:** If a legacy single-memo entry exists and no notes are present, a new note is created named “Migrated Memo.”

## Memo Lifecycle & Versioning

* **At least one memo:** The app ensures a memo exists on startup.
* **Create:** New memo is added, selected, and persisted.
* **Open/Switch:** Switching saves current memo, records a version, updates current id, and loads the selected memo.
* **Rename/Delete:** Rename updates title and timestamps; delete prompts confirmation and reselects the next memo.
* **Versioning:** Notes maintain a versions array. Versions are recorded automatically (minimum 5s interval) or forced during certain operations like sync and switching.
* **Versions dialog:** Users can restore a version (current content is saved as a new version).

## Editing, Search, and History

* **Undo/redo:** Each memo has its own history stack capped at 120 snapshots. New snapshots are recorded on debounce.
* **Search:** Supports plain text or regex search with optional case sensitivity. Matches are highlighted in an overlay and tracked with a match counter.
* **Replace:** Replace affects the active match; Replace All applies globally (with regex or escaped literal).

## Import & Export

* **Export selected/all:** Downloads JSON payloads with schema metadata and full note/version details.
* **Import:** Accepts JSON with a `notes` array, normalizes fields, resolves id collisions, and switches to the last imported memo.

## Manual Sync (Optional)

* **Settings:** Server endpoint and auth token are stored in local storage and editable in the Sync dialog.
* **Auth flows:** Register/login calls `/auth/register` or `/auth/login` and stores the returned token.
* **Sync behavior:**

  * Fetches server notes, compares version histories, and resolves fast-forward updates.
  * In conflicts, the local note is duplicated with a “Local copy” title and pushed to the server, while the server version replaces the original.
* **Replace actions:** Users can replace local notes with server data or overwrite server data with local data.

## PWA & Offline Support

* **Dynamic manifest:** Generated at runtime and attached as a manifest link.
* **Service worker:** Cache-first strategy caching the app scope; returns cached content when offline, with a fallback response.

## Logging & Diagnostics

* **Log panel:** UI log captures events, warnings, and errors; visibility is user-controlled.
* **Global errors:** Window error and unhandled promise rejections are logged.
