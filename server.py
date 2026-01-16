import asyncio
import json
import os
from pathlib import Path
from typing import Dict, List

from aiohttp import web

DATA_FILE = Path(__file__).parent / "server_data.json"
STATIC_DIR = Path(__file__).parent / "docs"
CORS_ORIGIN = os.environ.get("MEMO_CORS_ORIGIN", "*")
CORS_HEADERS = {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def load_data() -> Dict[str, Dict[str, dict]]:
    if not DATA_FILE.exists():
        return {"memos": {}}
    return json.loads(DATA_FILE.read_text())


def save_data(data: Dict[str, Dict[str, dict]]) -> None:
    DATA_FILE.write_text(json.dumps(data, indent=2))


def history_ids(history: List[dict]) -> List[str]:
    return [entry["id"] for entry in history]


def is_prefix(shorter: List[str], longer: List[str]) -> bool:
    return len(shorter) <= len(longer) and shorter == longer[: len(shorter)]


class MemoStore:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._data = load_data()

    async def sync(self, client_memos: List[dict]) -> dict:
        async with self._lock:
            memos = self._data["memos"]
            results = []
            seen_ids = set()
            for memo in client_memos:
                memo_id = memo["id"]
                seen_ids.add(memo_id)
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
            save_data(self._data)

        return {"results": results, "serverMemos": server_memos}


async def handle_sync(request: web.Request) -> web.Response:
    payload = await request.json()
    client_memos = payload.get("memos", [])
    store: MemoStore = request.app["store"]
    response = await store.sync(client_memos)
    return web.json_response(response)


async def handle_health(_: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.path.startswith("/api/"):
        if request.method == "OPTIONS":
            return web.Response(status=204, headers=CORS_HEADERS)
        response = await handler(request)
        response.headers.update(CORS_HEADERS)
        return response
    return await handler(request)


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app["store"] = MemoStore()
    app.router.add_post("/api/sync", handle_sync)
    app.router.add_get("/api/health", handle_health)
    app.router.add_static("/", STATIC_DIR, show_index=True)
    return app


if __name__ == "__main__":
    web.run_app(create_app(), port=8080)
