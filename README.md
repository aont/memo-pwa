# Memo PWA

Memo PWA is a lightweight, offline-first note-taking experience. It stores memos locally in the browser, keeps a version history for each memo, and can sync with a simple server to resolve updates and conflicts.

## Features

- Create and edit memos with a title and content.
- Automatic version history with restore points.
- Local persistence via `localStorage` for offline use.
- Manual sync to the server with conflict handling.

## Getting started

### Prerequisites

- Python 3.10+ (for the sync server)

### Run the server

```bash
python server.py
```

The app will be available at `http://localhost:8080`.

## Project structure

- `frontend/` contains the client assets (`index.html`, `styles.css`, `app.js`).
- `server.py` is the aiohttp server for sync operations.
- `server_data.sqlite3` is created automatically to store synced memo data.

## Usage

1. Open the app in your browser.
2. Use **New memo** to add a memo.
3. Edit the title or content. Click **Save version** to capture a snapshot.
4. Use **Sync** to push/pull changes with the server.

## API

### `POST /sync`

Send local memos and receive reconciliation results.

**Request body**

```json
{
  "memos": [
    {
      "id": "uuid",
      "title": "Memo title",
      "history": [
        {
          "id": "uuid",
          "content": "Memo content",
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

**Response body**

```json
{
  "results": [
    {
      "id": "uuid",
      "status": "accepted",
      "memo": {}
    }
  ],
  "serverMemos": []
}
```

## Health check

### `GET /health`

Returns server health status.

**Response body**

```json
{
  "status": "ok"
}
```


## Frontend ↔ Backend communication details

### Endpoint address used by frontend

- Sync target is determined by `apiBase` and sent to `fetch(syncEndpoint())`.
- Default API base is current origin (`window.location.origin`), so with default settings it becomes `http://<frontend-host>:<port>`.
- You can override the base from the UI (`api-base` input), and the app stores it in `localStorage` key `memoPwa.apiBase` (legacy `memo-api-base` is migrated automatically).
- The sync route appends `/sync` to the API base, so practical sync destination is typically `http://<server-host>:<port>/sync`.
- If frontend API base is set to `https://host/path`, sync goes to `https://host/path/sync`.

### Request payload (frontend → backend)

The frontend sends this JSON via `POST`:

```json
{
  "memos": [
    {
      "id": "uuid",
      "title": "Memo title",
      "history": [
        {
          "id": "uuid",
          "content": "Memo content",
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  ],
  "deletedMemos": [
    {
      "id": "uuid",
      "deletedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Response payload (backend → frontend)

The backend returns reconciliation results:

```json
{
  "results": [
    {
      "id": "uuid",
      "status": "accepted | update | conflict | deleted",
      "memo": {}
    }
  ],
  "serverMemos": [
    {
      "id": "uuid",
      "title": "Memo title",
      "history": []
    }
  ],
  "serverDeleted": [
    {
      "id": "uuid",
      "deletedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Other API endpoint

Health check is a separate endpoint: `GET /health`.
