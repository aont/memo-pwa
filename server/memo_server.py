import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

SCHEMA_VERSION = 2
PBKDF2_ITERATIONS = 150_000
TOKEN_BYTES = 32


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


def normalize_token(token):
    if not isinstance(token, dict):
        return None
    token_value = token.get("token") if isinstance(token.get("token"), str) else None
    if not token_value:
        return None
    created_at = token.get("createdAt") if isinstance(token.get("createdAt"), str) else now_iso()
    last_used = token.get("lastUsedAt") if isinstance(token.get("lastUsedAt"), str) else created_at
    return {
        "token": token_value,
        "createdAt": created_at,
        "lastUsedAt": last_used,
    }


def normalize_user(user):
    if not isinstance(user, dict):
        user = {}
    user_id = user.get("id") if isinstance(user.get("id"), str) else f"u_{time.time()}"
    username = user.get("username") if isinstance(user.get("username"), str) else "user"
    password_hash = user.get("passwordHash") if isinstance(user.get("passwordHash"), str) else None
    salt = user.get("salt") if isinstance(user.get("salt"), str) else None
    created_at = user.get("createdAt") if isinstance(user.get("createdAt"), str) else now_iso()
    tokens_raw = user.get("tokens") if isinstance(user.get("tokens"), list) else []
    tokens = [t for t in (normalize_token(t) for t in tokens_raw) if t]
    return {
        "id": user_id,
        "username": username,
        "passwordHash": password_hash,
        "salt": salt,
        "createdAt": created_at,
        "tokens": tokens,
    }


def hash_password(password, salt=None):
    if salt is None:
        salt_bytes = secrets.token_bytes(16)
    elif isinstance(salt, str):
        salt_bytes = base64.b64decode(salt)
    else:
        salt_bytes = salt
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt_bytes, PBKDF2_ITERATIONS
    )
    return (
        base64.b64encode(salt_bytes).decode("utf-8"),
        base64.b64encode(digest).decode("utf-8"),
    )


def verify_password(password, salt, expected_hash):
    if not salt or not expected_hash:
        return False
    _, candidate_hash = hash_password(password, salt)
    return hmac.compare_digest(candidate_hash, expected_hash)


def create_user(username, password):
    salt, password_hash = hash_password(password)
    return {
        "id": f"u_{time.time()}",
        "username": username,
        "passwordHash": password_hash,
        "salt": salt,
        "createdAt": now_iso(),
        "tokens": [],
    }


def issue_token(user):
    token = secrets.token_urlsafe(TOKEN_BYTES)
    now = now_iso()
    entry = {"token": token, "createdAt": now, "lastUsedAt": now}
    user.setdefault("tokens", []).append(entry)
    return token


def find_user_by_username(users, username):
    for user in users:
        if user.get("username") == username:
            return user
    return None


def find_user_by_token(users, token):
    for user in users:
        for entry in user.get("tokens", []):
            if entry.get("token") == token:
                entry["lastUsedAt"] = now_iso()
                return user
    return None


def parse_basic_auth(auth_value):
    if not auth_value.startswith("Basic "):
        return None
    encoded = auth_value.split(" ", 1)[1].strip()
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    username, password = decoded.split(":", 1)
    return username, password


def authenticate_request(request, db):
    auth_value = request.headers.get("Authorization", "")
    if auth_value.startswith("Bearer "):
        token = auth_value.split(" ", 1)[1].strip()
        if not token:
            return None, None
        user = find_user_by_token(db.get("users", []), token)
        return user, token
    basic_creds = parse_basic_auth(auth_value)
    if basic_creds:
        username, password = basic_creds
        user = find_user_by_username(db.get("users", []), username)
        if user and verify_password(password, user.get("salt"), user.get("passwordHash")):
            return user, None
    return None, None


def get_request_scheme(request):
    if request.app.get("trust_proxy"):
        forwarded = request.headers.get("X-Forwarded-Proto")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
    return request.scheme


def bootstrap_user(username):
    user = {
        "id": f"u_{time.time()}",
        "username": username,
        "passwordHash": None,
        "salt": None,
        "createdAt": now_iso(),
        "tokens": [],
    }
    token = issue_token(user)
    return user, token


async def load_db(path: Path):
    if not path.exists():
        return {"schema": SCHEMA_VERSION, "users": [], "notesByUser": {}}, None
    data = await asyncio.to_thread(path.read_text, encoding="utf-8")
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return {"schema": SCHEMA_VERSION, "users": [], "notesByUser": {}}, None
    if not isinstance(parsed, dict):
        return {"schema": SCHEMA_VERSION, "users": [], "notesByUser": {}}, None
    schema = parsed.get("schema", 1)
    if schema == 1:
        notes = parsed.get("notes") if isinstance(parsed.get("notes"), list) else []
        normalized_notes = [normalize_note(note) for note in notes]
        user, token = bootstrap_user("legacy")
        return (
            {"schema": SCHEMA_VERSION, "users": [user], "notesByUser": {user["id"]: normalized_notes}},
            token,
        )
    users_raw = parsed.get("users") if isinstance(parsed.get("users"), list) else []
    users = [normalize_user(user) for user in users_raw]
    notes_by_user_raw = parsed.get("notesByUser") if isinstance(parsed.get("notesByUser"), dict) else {}
    notes_by_user = {}
    for user in users:
        raw_notes = notes_by_user_raw.get(user["id"], [])
        if not isinstance(raw_notes, list):
            raw_notes = []
        notes_by_user[user["id"]] = [normalize_note(note) for note in raw_notes]
    return {"schema": SCHEMA_VERSION, "users": users, "notesByUser": notes_by_user}, None


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
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


@web.middleware
async def https_middleware(request, handler):
    if request.app.get("require_https") and get_request_scheme(request) != "https":
        return web.json_response({"error": "https_required"}, status=403)
    return await handler(request)


@web.middleware
async def auth_middleware(request, handler):
    if request.path in {"/health", "/auth/login", "/auth/register"}:
        return await handler(request)
    user, token = authenticate_request(request, request.app["db"])
    if not user:
        return web.json_response({"error": "unauthorized"}, status=401)
    request["user"] = user
    request["token"] = token
    return await handler(request)


async def create_app(data_path: Path, require_https=False, trust_proxy=False, allow_register=True):
    lock = asyncio.Lock()
    db, bootstrap_token = await load_db(data_path)
    if bootstrap_token:
        print("Migrated legacy notes into 'legacy' user.")
        print("Use this token to access notes:")
        print(bootstrap_token)
    app = web.Application(middlewares=[cors_middleware, https_middleware, auth_middleware])
    app["db"] = db
    app["lock"] = lock
    app["require_https"] = require_https
    app["trust_proxy"] = trust_proxy
    app["allow_register"] = allow_register

    async def get_notes(request):
        user = request["user"]
        async with lock:
            notes = db.get("notesByUser", {}).get(user["id"], [])
            return web.json_response({"schema": SCHEMA_VERSION, "notes": notes})

    async def post_notes(request):
        user = request["user"]
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "invalid_json"}, status=400)
        notes = payload.get("notes") if isinstance(payload, dict) else None
        if not isinstance(notes, list):
            return web.json_response({"error": "notes_required"}, status=400)
        incoming = [normalize_note(note) for note in notes]
        async with lock:
            user_notes = db.setdefault("notesByUser", {}).setdefault(user["id"], [])
            existing = {note["id"]: note for note in user_notes}
            for note in incoming:
                existing[note["id"]] = note
            db["notesByUser"][user["id"]] = list(existing.values())
            db["schema"] = SCHEMA_VERSION
            await save_db(data_path, db)
        return web.json_response({"status": "ok", "received": len(incoming)})

    async def register(request):
        if not request.app.get("allow_register"):
            return web.json_response({"error": "registration_disabled"}, status=403)
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "invalid_json"}, status=400)
        username = payload.get("username") if isinstance(payload, dict) else None
        password = payload.get("password") if isinstance(payload, dict) else None
        if not isinstance(username, str) or not username.strip():
            return web.json_response({"error": "username_required"}, status=400)
        if not isinstance(password, str) or not password:
            return web.json_response({"error": "password_required"}, status=400)
        async with lock:
            if find_user_by_username(db.get("users", []), username):
                return web.json_response({"error": "user_exists"}, status=409)
            user = create_user(username.strip(), password)
            token = issue_token(user)
            db.setdefault("users", []).append(user)
            db.setdefault("notesByUser", {})[user["id"]] = []
            db["schema"] = SCHEMA_VERSION
            await save_db(data_path, db)
        return web.json_response(
            {
                "status": "ok",
                "token": token,
                "user": {"id": user["id"], "username": user["username"]},
            }
        )

    async def login(request):
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "invalid_json"}, status=400)
        username = payload.get("username") if isinstance(payload, dict) else None
        password = payload.get("password") if isinstance(payload, dict) else None
        if not isinstance(username, str) or not isinstance(password, str):
            return web.json_response({"error": "invalid_credentials"}, status=400)
        async with lock:
            user = find_user_by_username(db.get("users", []), username)
            if not user or not verify_password(password, user.get("salt"), user.get("passwordHash")):
                return web.json_response({"error": "invalid_credentials"}, status=401)
            token = issue_token(user)
            db["schema"] = SCHEMA_VERSION
            await save_db(data_path, db)
        return web.json_response(
            {
                "status": "ok",
                "token": token,
                "user": {"id": user["id"], "username": user["username"]},
            }
        )

    async def logout(request):
        user = request["user"]
        token = request.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)
        async with lock:
            tokens = [t for t in user.get("tokens", []) if t.get("token") != token]
            user["tokens"] = tokens
            await save_db(data_path, db)
        return web.json_response({"status": "ok"})

    async def me(request):
        user = request["user"]
        return web.json_response({"id": user["id"], "username": user["username"]})

    async def health(_request):
        return web.json_response({"status": "ok"})

    app.router.add_route("GET", "/notes", get_notes)
    app.router.add_route("POST", "/notes", post_notes)
    app.router.add_route("POST", "/auth/register", register)
    app.router.add_route("POST", "/auth/login", login)
    app.router.add_route("POST", "/auth/logout", logout)
    app.router.add_route("GET", "/auth/me", me)
    app.router.add_route("GET", "/health", health)
    app.router.add_route("OPTIONS", "/{tail:.*}", lambda _req: web.Response(status=204))
    return app


def main():
    parser = argparse.ArgumentParser(description="Memo PWA Sync Server (aiohttp).")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--data", default="memo_server.json")
    parser.add_argument("--require-https", action="store_true")
    parser.add_argument("--trust-proxy", action="store_true")
    parser.add_argument("--disable-register", action="store_true")
    args = parser.parse_args()
    data_path = Path(args.data)
    allow_register = not args.disable_register
    app = asyncio.run(
        create_app(
            data_path,
            require_https=args.require_https,
            trust_proxy=args.trust_proxy,
            allow_register=allow_register,
        )
    )
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
