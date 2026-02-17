import argparse
import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from aiohttp import web

DEFAULT_DATA_FILE = Path(__file__).parent.parent / "server_data.sqlite3"
STATIC_DIR = Path(__file__).parent.parent / "frontend"
DEFAULT_CORS_ORIGIN = "*"


def init_db(data_file: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(data_file)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memos (
            id TEXT PRIMARY KEY,
            memo_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS deleted_memos (
            id TEXT PRIMARY KEY,
            deleted_at TEXT NOT NULL
        )
        """
    )
    return conn


def load_data(conn: sqlite3.Connection) -> Dict[str, Dict[str, dict]]:
    memos = {}
    for memo_id, memo_json in conn.execute("SELECT id, memo_json FROM memos"):
        memos[memo_id] = json.loads(memo_json)
    deleted = {}
    for memo_id, deleted_at in conn.execute("SELECT id, deleted_at FROM deleted_memos"):
        deleted[memo_id] = deleted_at
    return {"memos": memos, "deleted": deleted}


def save_data(conn: sqlite3.Connection, data: Dict[str, Dict[str, dict]]) -> None:
    memos = data["memos"]
    deleted = data["deleted"]
    with conn:
        conn.execute("DELETE FROM memos")
        conn.executemany(
            "INSERT INTO memos (id, memo_json) VALUES (?, ?)",
            [(memo_id, json.dumps(memo)) for memo_id, memo in memos.items()],
        )
        conn.execute("DELETE FROM deleted_memos")
        conn.executemany(
            "INSERT INTO deleted_memos (id, deleted_at) VALUES (?, ?)",
            [(memo_id, deleted_at) for memo_id, deleted_at in deleted.items()],
        )


def history_ids(history: List[dict]) -> List[str]:
    return [entry["id"] for entry in history]


def is_prefix(shorter: List[str], longer: List[str]) -> bool:
    return len(shorter) <= len(longer) and shorter == longer[: len(shorter)]


class MemoStore:
    def __init__(self, data_file: Path) -> None:
        self._lock = asyncio.Lock()
        self._conn = init_db(data_file)
        self._data = load_data(self._conn)

    async def sync(self, client_memos: List[dict], client_deleted: List[dict]) -> dict:
        async with self._lock:
            memos = self._data["memos"]
            deleted = self._data["deleted"]
            results = []
            seen_ids = set()
            for deletion in client_deleted:
                memo_id = deletion.get("id")
                if not memo_id:
                    continue
                deleted_at = deletion.get("deletedAt") or deletion.get("deleted_at")
                if not deleted_at:
                    deleted_at = datetime.now(timezone.utc).isoformat()
                memos.pop(memo_id, None)
                deleted[memo_id] = deleted_at
            for memo in client_memos:
                memo_id = memo["id"]
                seen_ids.add(memo_id)
                if memo_id in deleted:
                    results.append(
                        {"id": memo_id, "status": "deleted", "deletedAt": deleted[memo_id]}
                    )
                    continue
                server_memo = memos.get(memo_id)
                if not server_memo:
                    memos[memo_id] = memo
                    results.append({"id": memo_id, "status": "accepted", "memo": memo})
                    continue

                client_history = history_ids(memo["history"])
                server_history = history_ids(server_memo["history"])

                if client_history == server_history:
                    results.append({"id": memo_id, "status": "accepted", "memo": server_memo})
                elif is_prefix(server_history, client_history):
                    memos[memo_id] = memo
                    results.append({"id": memo_id, "status": "accepted", "memo": memo})
                elif is_prefix(client_history, server_history):
                    results.append({"id": memo_id, "status": "update", "memo": server_memo})
                else:
                    results.append({"id": memo_id, "status": "conflict", "memo": server_memo})

            server_memos = [memo for memo_id, memo in memos.items() if memo_id not in seen_ids]
            server_deleted = [
                {"id": memo_id, "deletedAt": deleted_at}
                for memo_id, deleted_at in deleted.items()
                if memo_id not in seen_ids
            ]
            save_data(self._conn, self._data)

        return {
            "results": results,
            "serverMemos": server_memos,
            "serverDeleted": server_deleted,
        }


async def handle_api(request: web.Request) -> web.Response:
    payload = await request.json()
    client_memos = payload.get("memos", [])
    client_deleted = payload.get("deletedMemos", [])
    store: MemoStore = request.app["store"]
    response = await store.sync(client_memos, client_deleted)
    return web.json_response(response)


async def handle_health(_: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


@web.middleware
async def cors_middleware(request: web.Request, handler):
    cors_headers = dict(request.app["cors_headers"])
    requested_headers = request.headers.get("Access-Control-Request-Headers")
    if requested_headers:
        cors_headers["Access-Control-Allow-Headers"] = requested_headers
    if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method"):
        return web.Response(status=204, headers=cors_headers)
    response = await handler(request)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        response.headers.update(cors_headers)
    return response


def create_app(serve_frontend: bool, data_file: Path, cors_origin: str) -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["store"] = MemoStore(data_file)
    app["cors_headers"] = {
        "Access-Control-Allow-Origin": cors_origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "600",
    }
    app.router.add_post("/sync", handle_api)
    app.router.add_get("/health", handle_health)
    if serve_frontend:
        async def handle_index(_: web.Request) -> web.Response:
            return web.FileResponse(STATIC_DIR / "index.html")

        app.router.add_get("/", handle_index)
        app.router.add_static("/", STATIC_DIR, show_index=True)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Memo backend server")
    parser.add_argument("--bind", default="0.0.0.0", help="Bind address for the server")
    parser.add_argument("--port", type=int, default=8080, help="Port number for the server")
    parser.add_argument(
        "--data-file",
        type=Path,
        default=DEFAULT_DATA_FILE,
        help="SQLite data file path for memo storage",
    )
    parser.add_argument(
        "--cors-origin",
        default=DEFAULT_CORS_ORIGIN,
        help="CORS origin to allow for API requests",
    )
    parser.add_argument(
        "--no-serve-frontend",
        action="store_false",
        dest="serve_frontend",
        help="Disable serving the frontend static files",
    )
    parser.set_defaults(serve_frontend=True)
    args = parser.parse_args()
    web.run_app(
        create_app(args.serve_frontend, args.data_file, args.cors_origin),
        host=args.bind,
        port=args.port,
    )
