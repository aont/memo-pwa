import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone

import asyncpg
from aiohttp import web

SCHEMA_VERSION = 2
PBKDF2_ITERATIONS = 150_000
TOKEN_BYTES = 32


def now_iso():
    return datetime.now(tz=timezone.utc).isoformat()


def now_utc():
    return datetime.now(tz=timezone.utc)


def ensure_datetime(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return now_utc()
    return now_utc()


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


async def authenticate_request(request, db):
    auth_value = request.headers.get("Authorization", "")
    if auth_value.startswith("Bearer "):
        token = auth_value.split(" ", 1)[1].strip()
        if not token:
            return None, None
        user = await find_user_by_token(db, token)
        return user, token
    basic_creds = parse_basic_auth(auth_value)
    if basic_creds:
        username, password = basic_creds
        user = await find_user_by_username(db, username)
        if user and verify_password(password, user.get("salt"), user.get("passwordHash")):
            return user, None
    return None, None


def get_request_scheme(request):
    if request.app.get("trust_proxy"):
        forwarded = request.headers.get("X-Forwarded-Proto")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
    return request.scheme


def row_to_user(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "passwordHash": row["password_hash"],
        "salt": row["salt"],
        "createdAt": row["created_at"].isoformat() if row["created_at"] else now_iso(),
    }


async def ensure_schema(pool):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                salt TEXT,
                created_at TIMESTAMPTZ NOT NULL
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL,
                last_used_at TIMESTAMPTZ NOT NULL
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                note_id TEXT NOT NULL,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                versions JSONB NOT NULL,
                PRIMARY KEY (user_id, note_id)
            )
            """
        )


async def find_user_by_username(pool, username):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, username, password_hash, salt, created_at
            FROM users
            WHERE username = $1
            """,
            username,
        )
    return row_to_user(row)


async def find_user_by_token(pool, token):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.id, u.username, u.password_hash, u.salt, u.created_at
            FROM tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token = $1
            """,
            token,
        )
        if row:
            await conn.execute(
                """
                UPDATE tokens
                SET last_used_at = $1
                WHERE token = $2
                """,
                now_utc(),
                token,
            )
    return row_to_user(row)


async def insert_user(pool, user):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO users (id, username, password_hash, salt, created_at)
            VALUES ($1, $2, $3, $4, $5)
            """,
            user["id"],
            user["username"],
            user["passwordHash"],
            user["salt"],
            ensure_datetime(user["createdAt"]),
        )


async def insert_token(pool, user_id, token):
    now = now_utc()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO tokens (token, user_id, created_at, last_used_at)
            VALUES ($1, $2, $3, $4)
            """,
            token,
            user_id,
            now,
            now,
        )
    return token


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,OPTIONS"
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
    user, token = await authenticate_request(request, request.app["db"])
    if not user:
        return web.json_response({"error": "unauthorized"}, status=401)
    request["user"] = user
    request["token"] = token
    return await handler(request)


async def create_app(pool, require_https=False, trust_proxy=False, allow_register=True):
    await ensure_schema(pool)
    app = web.Application(middlewares=[cors_middleware, https_middleware, auth_middleware])
    app["db"] = pool
    app["require_https"] = require_https
    app["trust_proxy"] = trust_proxy
    app["allow_register"] = allow_register

    async def get_notes(request):
        user = request["user"]
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT note_id, title, text, created_at, updated_at, versions
                FROM notes
                WHERE user_id = $1
                """,
                user["id"],
            )
        notes = []
        for row in rows:
            versions = row["versions"] if isinstance(row["versions"], list) else []
            note = normalize_note(
                {
                    "id": row["note_id"],
                    "title": row["title"],
                    "text": row["text"],
                    "createdAt": row["created_at"].isoformat() if row["created_at"] else now_iso(),
                    "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else now_iso(),
                    "versions": versions,
                }
            )
            notes.append(note)
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
        async with pool.acquire() as conn:
            async with conn.transaction():
                for note in incoming:
                    await conn.execute(
                        """
                        INSERT INTO notes (
                            user_id,
                            note_id,
                            title,
                            text,
                            created_at,
                            updated_at,
                            versions
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                        ON CONFLICT (user_id, note_id)
                        DO UPDATE SET
                            title = EXCLUDED.title,
                            text = EXCLUDED.text,
                            created_at = EXCLUDED.created_at,
                            updated_at = EXCLUDED.updated_at,
                            versions = EXCLUDED.versions
                        """,
                        user["id"],
                        note["id"],
                        note["title"],
                        note["text"],
                        ensure_datetime(note["createdAt"]),
                        ensure_datetime(note["updatedAt"]),
                        json.dumps(note["versions"], ensure_ascii=False),
                    )
        return web.json_response({"status": "ok", "received": len(incoming)})

    async def put_notes(request):
        user = request["user"]
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "invalid_json"}, status=400)
        notes = payload.get("notes") if isinstance(payload, dict) else None
        if not isinstance(notes, list):
            return web.json_response({"error": "notes_required"}, status=400)
        incoming = [normalize_note(note) for note in notes]
        async with pool.acquire() as conn:
            async with conn.transaction():
                for note in incoming:
                    await conn.execute(
                        """
                        INSERT INTO notes (
                            user_id,
                            note_id,
                            title,
                            text,
                            created_at,
                            updated_at,
                            versions
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                        ON CONFLICT (user_id, note_id)
                        DO UPDATE SET
                            title = EXCLUDED.title,
                            text = EXCLUDED.text,
                            created_at = EXCLUDED.created_at,
                            updated_at = EXCLUDED.updated_at,
                            versions = EXCLUDED.versions
                        """,
                        user["id"],
                        note["id"],
                        note["title"],
                        note["text"],
                        ensure_datetime(note["createdAt"]),
                        ensure_datetime(note["updatedAt"]),
                        json.dumps(note["versions"], ensure_ascii=False),
                    )
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
        existing = await find_user_by_username(pool, username.strip())
        if existing:
            return web.json_response({"error": "user_exists"}, status=409)
        user = create_user(username.strip(), password)
        token = issue_token(user)
        await insert_user(pool, user)
        await insert_token(pool, user["id"], token)
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
        user = await find_user_by_username(pool, username)
        if not user or not verify_password(password, user.get("salt"), user.get("passwordHash")):
            return web.json_response({"error": "invalid_credentials"}, status=401)
        token = issue_token(user)
        await insert_token(pool, user["id"], token)
        return web.json_response(
            {
                "status": "ok",
                "token": token,
                "user": {"id": user["id"], "username": user["username"]},
            }
        )

    async def logout(request):
        token = request.get("token")
        if not token:
            return web.json_response({"error": "token_required"}, status=400)
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM tokens WHERE token = $1", token)
        return web.json_response({"status": "ok"})

    async def me(request):
        user = request["user"]
        return web.json_response({"id": user["id"], "username": user["username"]})

    async def health(_request):
        return web.json_response({"status": "ok"})

    app.router.add_route("GET", "/notes", get_notes)
    app.router.add_route("POST", "/notes", post_notes)
    app.router.add_route("PUT", "/notes", put_notes)
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
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", "postgresql://localhost:5432/memo_pwa"),
    )
    parser.add_argument("--require-https", action="store_true")
    parser.add_argument("--trust-proxy", action="store_true")
    parser.add_argument("--disable-register", action="store_true")
    args = parser.parse_args()
    allow_register = not args.disable_register
    async def init_app():
        pool = await asyncpg.create_pool(dsn=args.database_url)
        app = await create_app(
            pool,
            require_https=args.require_https,
            trust_proxy=args.trust_proxy,
            allow_register=allow_register,
        )

        async def close_pool(_app):
            await pool.close()

        app.on_cleanup.append(close_pool)
        return app

    web.run_app(init_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
