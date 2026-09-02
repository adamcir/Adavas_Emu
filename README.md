# Adavas_Emu

A web QEMU console by Adava Development.

## Prototype features

- Login and registration with server-side sessions
- Password hashing with PBKDF2-HMAC-SHA256
- Per-user VM ownership
- Multiple simultaneous x86/x86_64 QEMU instances
- Multiple qcow2 disks per VM (up to 4 IDE disks in this prototype)
- Start / stop / delete VM
- Disk add / delete
- noVNC console in the web UI
- Fullscreen / maximize console
- SQLite metadata database
- Docker Compose deployment

## Start

```bash
docker compose build
docker compose up -d
```

Open:

```text
http://SERVER_IP:8080
```

## Updating from the older single-test-VM prototype

The old `data/vms/test-vm` layout is not automatically imported. The new version stores
accounts and VM metadata in `data/adavas_emu.db` and user VM disks in `data/users/`.

Keep a backup of `data/` before upgrading.

## HTTPS

For a public deployment, put Adava's Emu behind HTTPS and set:

```yaml
environment:
  - ADAVA_SECURE_COOKIE=1
```

Do not expose this prototype directly to the public Internet without additional hardening
(rate limiting, backups, resource quotas, audit logging, CSRF review, and TLS).

## License

GNU General Public License v3.0.

Copyright © 2026 Adava Development.
