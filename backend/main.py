import os
import signal
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Adava's Emu API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VM_ROOT = Path("/data/vms")
VM_ROOT.mkdir(parents=True, exist_ok=True)

VM_ID = "test-vm"
VM_DIR = VM_ROOT / VM_ID
DISK = VM_DIR / "disk.qcow2"
PID_FILE = VM_DIR / "qemu.pid"

VM_DIR.mkdir(parents=True, exist_ok=True)


def get_pid():
    if not PID_FILE.exists():
        return None

    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        PID_FILE.unlink(missing_ok=True)
        return None


@app.get("/api/vms")
def list_vms():
    pid = get_pid()

    return [
        {
            "id": VM_ID,
            "name": "Adava Test VM",
            "arch": "x86_64",
            "ram": 512,
            "cpus": 1,
            "disk": 10,
            "running": pid is not None,
        }
    ]


@app.post("/api/vms/{vm_id}/create")
def create_vm(vm_id: str):
    if vm_id != VM_ID:
        raise HTTPException(404, "VM not found")

    if DISK.exists():
        return {"status": "already-exists"}

    result = subprocess.run(
        [
            "qemu-img",
            "create",
            "-f",
            "qcow2",
            str(DISK),
            "10G",
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise HTTPException(500, result.stderr)

    return {
        "status": "created",
        "disk": str(DISK),
    }


@app.post("/api/vms/{vm_id}/start")
def start_vm(vm_id: str):
    if vm_id != VM_ID:
        raise HTTPException(404, "VM not found")

    if get_pid():
        return {"status": "already-running"}

    if not DISK.exists():
        raise HTTPException(400, "VM disk does not exist")

    process = subprocess.Popen(
        [
            "qemu-system-x86_64",
            "-name",
            "Adava-Test-VM",

            "-machine",
            "pc",

            "-m",
            "512",

            "-smp",
            "1",

            "-drive",
            f"file={DISK},format=qcow2",

            "-display",
            "none",

            "-monitor",
            "none",

            "-serial",
            "none",

            "-no-reboot",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    PID_FILE.write_text(str(process.pid))

    return {
        "status": "started",
        "pid": process.pid,
    }


@app.post("/api/vms/{vm_id}/stop")
def stop_vm(vm_id: str):
    if vm_id != VM_ID:
        raise HTTPException(404, "VM not found")

    pid = get_pid()

    if not pid:
        return {"status": "already-stopped"}

    os.kill(pid, signal.SIGTERM)

    PID_FILE.unlink(missing_ok=True)

    return {"status": "stopped"}
    
