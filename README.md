# Adavas_Emu

Web QEMU manager by Adava Development.

## Features

- Login / registration and per-user sessions
- Multiple VM instances per user
- Multiple qcow2 hard disks
- VM Settings dialog with **General**, **Disks** and **Media**
- Rename VM and change architecture, RAM and vCPU count while stopped
- CD/DVD ISO attachment from `/data/media`
- Floppy image attachment (`.img`, `.ima`, `.flp`, `.raw`) from `/data/media`
- noVNC console with fullscreen/maximize
- SQLite metadata storage
- Docker Compose deployment

## Media directory

Because `./data` is mounted to `/data` in the backend container, place images on the host in:

```text
./data/media/
```

For example:

```bash
mkdir -p data/media
cp ~/Downloads/debian.iso data/media/
cp ~/Downloads/bootdisk.img data/media/
```

The VM must be stopped before attaching/ejecting media or changing hard disks.

## Hot update without rebuilding

If your existing backend image already contains Python, QEMU and noVNC, you can update code without rebuilding:

```bash
docker cp backend/main.py adavas-emu-backend:/app/main.py
docker restart adavas-emu-backend
docker restart adavas-emu-frontend
```

The frontend directory is mounted as a volume, so frontend file edits do not need an image rebuild.

Verify noVNC exists:

```bash
docker exec adavas-emu-backend ls -l /usr/share/novnc/vnc.html
curl http://127.0.0.1:8080/api/health
```

If `/usr/share/novnc/vnc.html` is missing, install it in the current container:

```bash
docker exec -u root adavas-emu-backend sh -c 'apt-get update && apt-get install -y novnc websockify'
docker restart adavas-emu-backend
```

## License

GNU GPLv3.

Copyright © 2026 Adava Development.


## VM hardware settings

Open **Nastavení → Obecné** to change:

- VM name
- Architecture (`x86_64` or `i386`)
- RAM
- vCPU count

The VM must be stopped before these settings can be changed.

`arm`/`aarch64` are intentionally not shown yet because the current Docker image only
installs `qemu-system-x86`. Add `qemu-system-arm` before enabling ARM guests.
