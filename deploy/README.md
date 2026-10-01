# Remote RS Ubuntu POC

Dokumentasi operasional lengkap tersedia di `docs/OPERASIONAL.md` dan `docs/OPERASIONAL.pdf`.

This Compose stack is isolated from existing applications. It only publishes TCP 8443. It does not use ports 85 or 3001.

## Prerequisites

- Ubuntu host with Docker Engine and Docker Compose.
- TCP 8443 available on the host.
- Firewall rules that allow only approved LAN or VPN clients to TCP 8443.
- The dashboard host can reach permitted TightVNC endpoints on TCP 5900.

## Deploy

```bash
git clone https://github.com/OWNER/remote-rs.git /opt/remote-rs
cd /opt/remote-rs
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
docker compose -f deploy/compose.yaml up -d --build
```

Set a unique `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `deploy/.env`. Do not commit this file.

Open `https://<server-ip-or-hostname>:8443` after deployment. Caddy uses an internal certificate authority for this POC. Install its root certificate on approved technician browsers before normal use:

```bash
docker compose -f deploy/compose.yaml cp web:/data/caddy/pki/authorities/local/root.crt ./remote-rs-root.crt
```

Distribute `remote-rs-root.crt` only through the IT trust-store process. Do not bypass browser certificate warnings in normal use.

## Operations

```bash
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs -f
docker compose -f deploy/compose.yaml down
```

`remote-rs-data` persists inventory, users, and audit data. Do not remove this volume unless a verified backup exists.

## Public Repository Safety

The repository excludes live device inventory, user data, audits, `.env`, and the local noVNC POC folder. Add devices through the dashboard scan or manual inventory after deployment.
