# Memo PWA (Menu): A Lightweight Offline Note App in One HTML File

## Overview

The provided content is a complete, self-contained web application that implements a simple memo editor designed to work like an installable Progressive Web App (PWA). It combines a menu-driven interface, a text editor with find-and-highlight functionality, per-note undo/redo history, and local persistence using the browser’s `localStorage`. It also includes optional offline support through a dynamically generated manifest and service worker.

In practice, this page functions as a minimal note-taking app that can run in a browser, save data locally, and behave like a standalone app when installed.

## Manual Sync & Version History

The app now keeps a version history per memo and can sync to a server on demand. Sync is manual-only (offline-first), and users can configure the server endpoint inside the PWA via **File → Sync…**. When syncing, fast-forward histories update directly, while divergent histories create a renamed local copy that is also uploaded to the server.

To run the optional asyncio + aiohttp sync server:

```bash
python server/memo_server.py --host 0.0.0.0 --port 8080 --data memo_server.json
```

The server exposes:

* `GET /notes` → returns all notes (with versions)
* `POST /notes` → upserts notes
* `GET /health` → health check

## User Interface Structure

### Menu Bar and App Status

At the top of the screen, a fixed menu bar provides three drop-down menus: **File**, **Edit**, and **View**. Each menu opens a panel containing actions associated with note management and editing operations.

On the right side of the menu bar, the app displays:

* The **current memo title** (truncated if long)
* The **match status** for search (for example, `2/10`)
* The **save status**, showing whether changes are saved or pending (for example, “保存中…” meaning “Saving…”)

This status area helps users understand the current note context and whether the app has persisted recent changes.

### Editor With Highlight Overlay

The editing area uses an interesting design: two layers are placed on top of each other inside the same container:

* A `textarea` (`#editor`) that accepts user input
* A `pre` element (`#highlightLayer`) that visually renders the same text while inserting highlighted spans for search matches

Because the highlight layer is transparent except for match backgrounds, the user experiences real-time highlighting while still typing into a normal text input. The app also keeps scrolling synchronized between the two layers so that the highlighted results remain aligned with the typed content.

### Bottom Log Panel

A bottom panel shows a running log of internal actions and events (such as database loads, saves, exports, and errors). This log is useful for debugging and for giving visibility into what the app is doing behind the scenes. The **View → Toggle Log** command allows the user to show or hide it.

## Memo Management Features

### Local Database Model

Memos are stored in a simple in-memory structure:

* `db = { version: 3, notes: [] }`
* Each note contains an `id`, `title`, `text`, `createdAt`, `updatedAt`, and `versions`

This database is serialized to `localStorage` under a versioned key. The app also stores the currently selected memo ID and UI preferences (wrap mode, search options, and log visibility).

### Creating, Opening, Renaming, and Deleting

The **File** menu covers the lifecycle of a memo:

* **New Memo** creates a new note with an auto-generated ID and default title.
* **Open…** shows a dialog with a dropdown list of existing memos (sorted by most recently updated).
* **Rename…** opens a dialog where the title can be edited; the same dialog also provides a delete action.
* **Delete Memo…** deletes the current memo, with a safeguard that prevents deleting the last remaining memo.

These actions update timestamps, refresh selection lists, and trigger persistence so that memo changes are stored reliably.

## Editing and Search Capabilities

### Undo and Redo Per Memo

Undo/redo is implemented as a per-note history stack, stored in a `Map` keyed by note ID. Each history entry is a snapshot containing:

* The note text
* Cursor selection start and end positions

The app captures snapshots on a debounce interval, limits history depth, and clears redo history when new edits occur. This provides familiar editing behavior while keeping memory usage bounded.

### Find, Next/Previous Match, and Highlighting

The app supports searching within the current memo via a **Find** dialog. Users can toggle:

* **Regex mode** (regular expression searching)
* **Case sensitivity**

Matches are computed by running a `RegExp` over the memo text. The app tracks all match ranges and designates one “active” match, which is styled differently (outlined) and reflected in the match status counter.

Users can navigate through matches using:

* Menu commands (**Next Match**, **Previous Match**)
* Buttons in the Find dialog
* Keyboard shortcuts (Enter and Shift+Enter within the Find input)

### Replace and Replace All

A separate **Replace** dialog enables:

* **Replace** (only the current active match)
* **Replace All** (every match)
* **Clear Text** (wipe the memo content, with confirmation)

Replacing updates the memo, triggers saves, recomputes matches, and records undo history so changes remain reversible.

## Import, Export, and Data Portability

The app supports JSON-based portability:

* **Export Selected…** downloads a JSON file containing only the current memo.
* **Export All…** downloads a JSON file containing every memo.

Exports include metadata such as `exportedAt`, and each note includes identifiers and timestamps.

For import:

* A hidden file input accepts `.json` files.
* The app validates that the payload contains a `notes` array.
* It normalizes note fields (ensuring title/text exist and timestamps are present).
* It avoids ID collisions by generating new IDs when necessary.
* After import, it switches to the last imported memo and persists the updated database.

This makes the app useful even without a server, because users can back up and restore their notes manually.

## Settings and View Preferences

### Wrap Mode

Wrap mode affects how lines behave in the editor:

* When wrap is enabled, long lines wrap visually.
* When wrap is disabled, the app applies a `nowrap` class and uses `white-space: pre` so the user can scroll horizontally.

The wrap preference is stored in `localStorage` so it persists across sessions.

### Log Visibility

The bottom log panel can be hidden to create a cleaner writing environment. Like other preferences, visibility is persisted.

## Progressive Web App and Offline Support

### Dynamic Manifest

Instead of referencing a static `manifest.json`, the app creates a manifest object at runtime, converts it into a `Blob`, and injects it as a `<link rel="manifest">`. It also defines a simple SVG icon through a `data:` URL.

### Service Worker Caching

The service worker is also generated dynamically as a script string, converted into a `Blob`, and registered. Its logic implements a cache-first approach:

* On install, it caches the app’s scope URL.
* On fetch, it returns cached content when available.
* If offline and no cache match exists, it returns a fallback response.

This design enables the app to continue loading even without a network connection, supporting the PWA goal of offline-first usage.

## Reliability and Diagnostics

The application includes a structured logger that:

* Limits log length to a fixed maximum
* Writes to both the on-screen log and the browser console
* Records informational events, warnings, and errors

It also listens to global error events (`window.error` and `unhandledrejection`) and logs them. This provides a basic but effective diagnostic mechanism for a small standalone app.

## Conclusion

This HTML file implements a compact memo application with surprisingly complete functionality: multi-note management, per-note undo/redo, search and replace with highlighting, JSON import/export, persistent settings, and offline PWA behavior. It is built to run entirely in the browser with no backend, relying on local storage and standard web APIs to deliver a simple, app-like note-taking experience.
