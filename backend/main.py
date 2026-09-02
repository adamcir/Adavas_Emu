import asyncio
import hashlib
import hmac
import os
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


app = FastAPI(title="Adava's Emu API")

# Frontend and API are normally served from the same nginx origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_ROOT = Path("/data")
VM_ROOT = DATA_ROOT / "users"
DB_PATH = DATA_ROOT / "adavas_emu.db"

SESSION_COOKIE = "adava_session"
SESSION_DAYS = 7
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
SUPPORTED_ARCHES = {"x86_64", "i386"}
MAX_DISKS_PER_VM = 4

DATA_ROOT.mkdir(parents=True, exist_ok=True)
VM_ROOT.mkdir(parents=True, exist_ok=True)


class AuthPayload(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=256)


class CreateVMPayload(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    arch: str = "x86_64"
    ram: int = Field(default=512, ge=128, le=16384)
    cpus: int = Field(default=1, ge=1, le=8)
    disk: int = Field(default=10, ge=1, le=256)


class AddDiskPayload(BaseModel):
    name: str = Field(default="Data disk", min_length=1, max_length=64)
    size_gb: int = Field(default=10, ge=1, le=512)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vms (
                id TEXT PRIMARY KEY,
                owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                arch TEXT NOT NULL,
                ram_mb INTEGER NOT NULL,
                cpus INTEGER NOT NULL,
                vnc_port INTEGER NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS disks (
                id TEXT PRIMARY KEY,
                vm_id TEXT NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                size_gb INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


init_db()


def utcnow():
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 250_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 250_000)
    return hmac.compare_digest(actual, expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int, response: Response):
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(days=SESSION_DAYS)

    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (utcnow().isoformat(),))
        conn.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), user_id, expires.isoformat()),
        )

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=os.getenv("ADAVA_SECURE_COOKIE", "0") == "1",
        path="/",
    )


def current_user_from_token(token: str | None):
    if not token:
        return None

    with db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.username
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash(token), utcnow().isoformat()),
        ).fetchone()

    return dict(row) if row else None


def require_user(request: Request):
    user = current_user_from_token(request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def vm_dir(user_id: int, vm_id: str) -> Path:
    return VM_ROOT / str(user_id) / "vms" / vm_id


def pid_file(user_id: int, vm_id: str) -> Path:
    return vm_dir(user_id, vm_id) / "qemu.pid"


def qemu_log(user_id: int, vm_id: str) -> Path:
    return vm_dir(user_id, vm_id) / "qemu.log"


def get_pid(user_id: int, vm_id: str):
    path = pid_file(user_id, vm_id)
    if not path.exists():
        return None

    try:
        pid = int(path.read_text().strip())
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        path.unlink(missing_ok=True)
        return None


def get_vm_for_user(conn, vm_id: str, user_id: int):
    row = conn.execute(
        "SELECT * FROM vms WHERE id = ? AND owner_id = ?",
        (vm_id, user_id),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="VM not found")

    return row


def port_is_free(port: int) -> bool:
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def allocate_vnc_port(conn) -> int:
    used = {row["vnc_port"] for row in conn.execute("SELECT vnc_port FROM vms")}
    for port in range(5901, 6000):
        if port not in used and port_is_free(port):
            return port
    raise HTTPException(status_code=503, detail="No free VNC ports")


def serialize_vm(conn, row):
    disks = conn.execute(
        "SELECT * FROM disks WHERE vm_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall()

    return {
        "id": row["id"],
        "name": row["name"],
        "arch": row["arch"],
        "ram": row["ram_mb"],
        "cpus": row["cpus"],
        "running": get_pid(row["owner_id"], row["id"]) is not None,
        "disk_count": len(disks),
        "disk": sum(d["size_gb"] for d in disks),
    }


def stop_vm_process(user_id: int, vm_id: str):
    pid = get_pid(user_id, vm_id)
    if not pid:
        return False

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    for _ in range(30):
        try:
            os.kill(pid, 0)
            time.sleep(0.1)
        except ProcessLookupError:
            break
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    pid_file(user_id, vm_id).unlink(missing_ok=True)
    return True


@app.post("/api/auth/register")
def register(payload: AuthPayload, response: Response):
    username = payload.username.strip()

    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-32 characters and use only letters, numbers, ., _ or -",
        )

    with db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, hash_password(payload.password), utcnow().isoformat()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Username already exists")

        user_id = cur.lastrowid

    create_session(user_id, response)
    return {"id": user_id, "username": username}


@app.post("/api/auth/login")
def login(payload: AuthPayload, response: Response):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
            (payload.username.strip(),),
        ).fetchone()

    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    create_session(row["id"], response)
    return {"id": row["id"], "username": row["username"]}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))

    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(request: Request):
    return require_user(request)


@app.get("/api/vms")
def list_vms(request: Request):
    user = require_user(request)

    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM vms WHERE owner_id = ? ORDER BY created_at",
            (user["id"],),
        ).fetchall()

        return [serialize_vm(conn, row) for row in rows]


@app.post("/api/vms")
def create_vm(payload: CreateVMPayload, request: Request):
    user = require_user(request)
    arch = payload.arch.strip()

    if arch not in SUPPORTED_ARCHES:
        raise HTTPException(status_code=400, detail="Supported architectures: x86_64, i386")

    vm_id = uuid.uuid4().hex[:12]
    disk_id = uuid.uuid4().hex[:12]
    directory = vm_dir(user["id"], vm_id)
    directory.mkdir(parents=True, exist_ok=False)
    disk_path = directory / f"{disk_id}.qcow2"

    try:
        with db() as conn:
            vnc_port = allocate_vnc_port(conn)
            now = utcnow().isoformat()
            conn.execute(
                """
                INSERT INTO vms(id, owner_id, name, arch, ram_mb, cpus, vnc_port, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    vm_id,
                    user["id"],
                    payload.name.strip(),
                    arch,
                    payload.ram,
                    payload.cpus,
                    vnc_port,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO disks(id, vm_id, name, path, size_gb, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (disk_id, vm_id, "System disk", str(disk_path), payload.disk, now),
            )

        result = subprocess.run(
            ["qemu-img", "create", "-f", "qcow2", str(disk_path), f"{payload.disk}G"],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "qemu-img failed")

    except Exception as exc:
        with db() as conn:
            conn.execute("DELETE FROM vms WHERE id = ? AND owner_id = ?", (vm_id, user["id"]))
        shutil.rmtree(directory, ignore_errors=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(exc))

    with db() as conn:
        row = get_vm_for_user(conn, vm_id, user["id"])
        return serialize_vm(conn, row)


@app.delete("/api/vms/{vm_id}")
def delete_vm(vm_id: str, request: Request):
    user = require_user(request)

    with db() as conn:
        get_vm_for_user(conn, vm_id, user["id"])
        if get_pid(user["id"], vm_id):
            raise HTTPException(status_code=409, detail="Stop the VM before deleting it")

        conn.execute("DELETE FROM vms WHERE id = ?", (vm_id,))

    shutil.rmtree(vm_dir(user["id"], vm_id), ignore_errors=True)
    return {"status": "deleted"}


@app.post("/api/vms/{vm_id}/start")
def start_vm(vm_id: str, request: Request):
    user = require_user(request)

    with db() as conn:
        row = get_vm_for_user(conn, vm_id, user["id"])
        disks = conn.execute(
            "SELECT * FROM disks WHERE vm_id = ? ORDER BY created_at, id",
            (vm_id,),
        ).fetchall()

    if get_pid(user["id"], vm_id):
        return {"status": "already-running"}

    if not disks:
        raise HTTPException(status_code=400, detail="VM has no disks")

    for disk in disks:
        if not Path(disk["path"]).exists():
            raise HTTPException(status_code=500, detail=f"Missing disk: {disk['name']}")

    executable = "qemu-system-x86_64" if row["arch"] == "x86_64" else "qemu-system-i386"
    display = row["vnc_port"] - 5900

    args = [
        executable,
        "-name", row["name"],
        "-machine", "pc",
        "-m", str(row["ram_mb"]),
        "-smp", str(row["cpus"]),
        "-vnc", f"127.0.0.1:{display}",
        "-display", "none",
        "-monitor", "none",
        "-serial", "none",
        "-no-reboot",
    ]

    for index, disk in enumerate(disks):
        args += [
            "-drive",
            f"file={disk['path']},format=qcow2,if=ide,index={index}",
        ]

    log_handle = open(qemu_log(user["id"], vm_id), "a")
    try:
        process = subprocess.Popen(
            args,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    finally:
        log_handle.close()

    pid_file(user["id"], vm_id).write_text(str(process.pid))

    time.sleep(0.15)
    if process.poll() is not None:
        pid_file(user["id"], vm_id).unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="QEMU exited immediately. Check qemu.log for details.",
        )

    return {"status": "started", "pid": process.pid}


@app.post("/api/vms/{vm_id}/stop")
def stop_vm(vm_id: str, request: Request):
    user = require_user(request)

    with db() as conn:
        get_vm_for_user(conn, vm_id, user["id"])

    stopped = stop_vm_process(user["id"], vm_id)
    return {"status": "stopped" if stopped else "already-stopped"}


@app.get("/api/vms/{vm_id}/disks")
def list_disks(vm_id: str, request: Request):
    user = require_user(request)

    with db() as conn:
        get_vm_for_user(conn, vm_id, user["id"])
        rows = conn.execute(
            "SELECT id, name, size_gb FROM disks WHERE vm_id = ? ORDER BY created_at, id",
            (vm_id,),
        ).fetchall()

    return [dict(row) for row in rows]


@app.post("/api/vms/{vm_id}/disks")
def add_disk(vm_id: str, payload: AddDiskPayload, request: Request):
    user = require_user(request)

    with db() as conn:
        get_vm_for_user(conn, vm_id, user["id"])

        if get_pid(user["id"], vm_id):
            raise HTTPException(status_code=409, detail="Stop the VM before adding a disk")

        count = conn.execute(
            "SELECT COUNT(*) AS count FROM disks WHERE vm_id = ?",
            (vm_id,),
        ).fetchone()["count"]

        if count >= MAX_DISKS_PER_VM:
            raise HTTPException(
                status_code=409,
                detail=f"Maximum {MAX_DISKS_PER_VM} IDE disks per VM in this prototype",
            )

        disk_id = uuid.uuid4().hex[:12]
        path = vm_dir(user["id"], vm_id) / f"{disk_id}.qcow2"
        conn.execute(
            """
            INSERT INTO disks(id, vm_id, name, path, size_gb, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                disk_id,
                vm_id,
                payload.name.strip(),
                str(path),
                payload.size_gb,
                utcnow().isoformat(),
            ),
        )

    result = subprocess.run(
        ["qemu-img", "create", "-f", "qcow2", str(path), f"{payload.size_gb}G"],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        with db() as conn:
            conn.execute("DELETE FROM disks WHERE id = ?", (disk_id,))
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=result.stderr)

    return {"id": disk_id, "name": payload.name.strip(), "size_gb": payload.size_gb}


@app.delete("/api/vms/{vm_id}/disks/{disk_id}")
def delete_disk(vm_id: str, disk_id: str, request: Request):
    user = require_user(request)

    with db() as conn:
        get_vm_for_user(conn, vm_id, user["id"])

        if get_pid(user["id"], vm_id):
            raise HTTPException(status_code=409, detail="Stop the VM before deleting a disk")

        count = conn.execute(
            "SELECT COUNT(*) AS count FROM disks WHERE vm_id = ?",
            (vm_id,),
        ).fetchone()["count"]

        if count <= 1:
            raise HTTPException(status_code=409, detail="A VM must keep at least one disk")

        row = conn.execute(
            "SELECT * FROM disks WHERE id = ? AND vm_id = ?",
            (disk_id, vm_id),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Disk not found")

        conn.execute("DELETE FROM disks WHERE id = ?", (disk_id,))

    Path(row["path"]).unlink(missing_ok=True)
    return {"status": "deleted"}


@app.websocket("/ws/vms/{vm_id}/console")
async def vm_console(websocket: WebSocket, vm_id: str):
    user = current_user_from_token(websocket.cookies.get(SESSION_COOKIE))
    if not user:
        await websocket.close(code=4401)
        return

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM vms WHERE id = ? AND owner_id = ?",
            (vm_id, user["id"]),
        ).fetchone()

    if not row:
        await websocket.close(code=4404)
        return

    if not get_pid(user["id"], vm_id):
        await websocket.close(code=4409)
        return

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", row["vnc_port"])
    except OSError:
        await websocket.close(code=1011)
        return

    requested = websocket.headers.get("sec-websocket-protocol", "")
    protocols = [item.strip() for item in requested.split(",") if item.strip()]
    chosen = "binary" if "binary" in protocols else None
    await websocket.accept(subprotocol=chosen)

    async def ws_to_vnc():
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return

            data = message.get("bytes")
            if data is None and message.get("text") is not None:
                data = message["text"].encode("latin1")

            if data:
                writer.write(data)
                await writer.drain()

    async def vnc_to_ws():
        while True:
            data = await reader.read(65536)
            if not data:
                return
            await websocket.send_bytes(data)

    tasks = {
        asyncio.create_task(ws_to_vnc()),
        asyncio.create_task(vnc_to_ws()),
    }

    _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    for task in pending:
        task.cancel()

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass


NOVNC_PATH = Path("/usr/share/novnc")

if NOVNC_PATH.exists():
    app.mount(
        "/novnc",
        StaticFiles(directory=str(NOVNC_PATH), html=True),
        name="novnc",
    )
