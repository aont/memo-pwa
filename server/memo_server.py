import argparse
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

SCHEMA_VERSION = 1


def now_iso():
    return datetime.now(tz=timezone.utc).isoformat()


def normalize_version(version, fallback_text):
    created_at = version.get("createdAt") if isinstance(version, dict) else None
    text = version.get("text") if isinstance(version, dict) else None
    version_id = version.get("id") if isinstance(version, dict) else None
    return {
        "id": version_id if isinstance(version_id, str) else f"v_{time.time()}",
        "text": text if isinstance(text, str) else fallback_text,
        "createdAt": created_at if isinstance(created_at, str) else now_iso(),
    }


def normalize_note(note):
    if not isinstance(note, dict):
        note = {}
    note_id = note.get("id") if isinstance(note.get("id"), str) else f"n_{time.time()}"
    title = note.get("title") if isinstance(note.get("title"), str) else "Untitled"
    text = note.get("text") if isinstance(note.get("text"), str) else ""
    created_at = note.get("createdAt") if isinstance(note.get("createdAt"), str) else now_iso()
    updated_at = note.get("updatedAt") if isinstance(note.get("updatedAt"), str) else now_iso()
    versions_raw = note.get("versions") if isinstance(note.get("versions"), list) else []
    versions = (
        [normalize_version(v, text) for v in versions_raw]
        if versions_raw
        else [normalize_version({}, text)]
    )
    return {
        "id": note_id,
        "title": title,
        "text": text,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "versions": versions,
    }


async def load_db(path: Path):
    if not path.exists():
        return {"schema": SCHEMA_VERSION, "notes": []}
    data = await asyncio.to_thread(path.read_text, encoding="utf-8")
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return {"schema": SCHEMA_VERSION, "notes": []}
    notes = parsed.get("notes") if isinstance(parsed, dict) else []
    if not isinstance(notes, list):
        notes = []
    normalized = [normalize_note(note) for note in notes]
    return {"schema": SCHEMA_VERSION, "notes": normalized}


async def save_db(path: Path, db: dict):
    payload = json.dumps(db, ensure_ascii=False, indent=2)
    await asyncio.to_thread(path.write_text, payload, encoding="utf-8")


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


async def create_app(data_path: Path):
    lock = asyncio.Lock()
    db = await load_db(data_path)

    async def get_notes(_request):
        async with lock:
            return web.json_response(db)

    async def post_notes(request):
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "invalid_json"}, status=400)
        notes = payload.get("notes") if isinstance(payload, dict) else None
        if not isinstance(notes, list):
            return web.json_response({"error": "notes_required"}, status=400)
        incoming = [normalize_note(note) for note in notes]
        async with lock:
            existing = {note["id"]: note for note in db.get("notes", [])}
            for note in incoming:
                existing[note["id"]] = note
            db["notes"] = list(existing.values())
            db["schema"] = SCHEMA_VERSION
            await save_db(data_path, db)
        return web.json_response({"status": "ok", "received": len(incoming)})

    async def health(_request):
        return web.json_response({"status": "ok"})

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_route("GET", "/notes", get_notes)
    app.router.add_route("POST", "/notes", post_notes)
    app.router.add_route("GET", "/health", health)
    app.router.add_route("OPTIONS", "/{tail:.*}", lambda _req: web.Response(status=204))
    return app


def main():
    parser = argparse.ArgumentParser(description="Memo PWA Sync Server (aiohttp).")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--data", default="memo_server.json")
    args = parser.parse_args()
    data_path = Path(args.data)
    app = asyncio.run(create_app(data_path))
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
