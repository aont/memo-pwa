# Memo PWA Specification

## Purpose

Provide a simple memo-taking progressive web app that works offline, tracks memo history, and syncs with a lightweight server for reconciliation across sessions or devices.

## Functional requirements

### Client

- **Memo management**
  - Users can create new memos.
  - Each memo has a title and content.
  - Titles are editable.
  - The most recent memo is active by default.
- **Version history**
  - Users can save versions of memo content.
  - Version entries include an ID and timestamp.
  - Users can restore a previous version, creating a new version entry.
- **Local persistence**
  - Memos are stored in IndexedDB under a single database.
  - On load, the app restores the last saved state from IndexedDB.
- **Sync**
  - Manual sync initiates a `POST /sync` request.
  - The client merges server updates and resolves conflicts by creating a copy when needed.
  - Sync status feedback is visible to the user.

### Server

- **Sync endpoint**
  - Uses `POST /sync`.
  - Accepts a list of memos from the client.
  - For each memo:
    - Accepts identical histories.
    - Accepts client updates when the server history is a prefix of the client history.
    - Returns server updates when the client history is a prefix of the server history.
    - Flags conflicts when histories diverge.
  - Returns any server-only memos.
- **Health endpoint**
  - Uses `GET /health`.

## Data model

### Memo

```json
{
  "id": "uuid",
  "title": "string",
  "history": [
    {
      "id": "uuid",
      "content": "string",
      "timestamp": "ISO-8601"
    }
  ]
}
```

## Non-functional requirements

- **Offline-first**: The app must function without network access using IndexedDB storage.
- **PWA assets**: The client ships a web app manifest, service worker, and icons to enable installation and offline access to the app shell.
- **Offline sync response**: When offline, sync requests should return a clear error response to the client.
- **Simple deployment**: Server runs with `python server.py` and serves static assets from `frontend/`.
- **Minimal dependencies**: The server uses aiohttp only.

## Future considerations

- Automatic background sync.
- Authentication for multi-user separation.
- Search and tagging for memos.
