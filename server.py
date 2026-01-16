import json
from pathlib import Path
from aiohttp import web

DATA_FILE = Path("server_data.json")


def load_data():
    if not DATA_FILE.exists():
        return {"users": {}}
    try:
        return json.loads(DATA_FILE.read_text())
    except json.JSONDecodeError:
        return {"users": {}}


def save_data(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


@web.middleware
async def auth_middleware(request, handler):
    if request.path.startswith("/auth"):
        return await handler(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return web.json_response({"error": "missing token"}, status=401)
    data = request.app["data"]
    user = next((user for user in data["users"].values() if user["token"] == token), None)
    if not user:
        return web.json_response({"error": "invalid token"}, status=403)
    request["user"] = user
    return await handler(request)


async def handle_register(request):
    data = request.app["data"]
    token = f"token-{len(data['users']) + 1}"
    user_id = f"user-{len(data['users']) + 1}"
    data["users"][user_id] = {"token": token, "notes": []}
    save_data(data)
    return web.json_response({"token": token})


async def handle_login(request):
    data = request.app["data"]
    if not data["users"]:
        return await handle_register(request)
    user = next(iter(data["users"].values()))
    return web.json_response({"token": user["token"]})


async def handle_get_notes(request):
    user = request["user"]
    return web.json_response({"notes": user.get("notes", [])})


async def handle_put_notes(request):
    user = request["user"]
    payload = await request.json()
    notes = payload.get("notes", [])
    if not isinstance(notes, list):
        return web.json_response({"error": "notes must be a list"}, status=400)
    user["notes"] = notes
    save_data(request.app["data"])
    return web.json_response({"status": "ok"})


async def create_app():
    app = web.Application(middlewares=[auth_middleware])
    app["data"] = load_data()
    app.router.add_post("/auth/register", handle_register)
    app.router.add_post("/auth/login", handle_login)
    app.router.add_get("/notes", handle_get_notes)
    app.router.add_put("/notes", handle_put_notes)
    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=8080)
