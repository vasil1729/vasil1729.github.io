+++
title = "Self-Hosting Frappe HRMS: A Production-Grade Docker Compose Deployment"
date = 2026-07-08
description = "How I deployed Frappe HRMS on my own infrastructure using Docker Compose, Caddy, Cloudflare, and WireGuard — with automated backups, user access control, and a rollback strategy."
[taxonomies]
tags = ["self-hosting", "devops", "docker", "frappe", "hrms", "erpnext"]
+++

## Why Self-Host HRMS?

HR software handles some of the most sensitive data in any organization: payroll, attendance, leave, employee records. When you hand that to a SaaS provider, you're trusting them with your entire workforce's personal information.

For my own setup, I wanted:

- **Full data ownership** — my data, my server, my backups
- **No per-seat licensing** — Frappe HRMS is open source (MIT)
- **Customizable** — Frappe's low-code framework lets me extend anything
- **Private** — no third-party servers handling employee PII
- **Cost-effective** — one VPS for the whole stack

What I didn't want was a fragile "it works on my machine" deployment. I needed something I could maintain for years, upgrade safely, and recover from a disaster without panic.

## Architecture Overview

The deployment runs on a single VPS behind Caddy, which handles TLS termination, HTTP/2, caching, and WebSocket proxying. Inside Docker, everything is segmented into internal and proxy networks.

```
Internet → Cloudflare DNS → Caddy (TLS) → Nginx (frontend)
                                           ├── /assets/ → static files
                                           ├── /socket.io/ → WebSocket
                                           └── / → Frappe Backend (Gunicorn)
                                                ├── MariaDB (internal)
                                                ├── Redis Cache (internal)
                                                ├── Redis Queue (internal)
                                                ├── Redis SocketIO (internal)
                                                ├── Workers × N (internal)
                                                └── Scheduler (internal)
```

The key design decisions:

- **Internal network for data layer** — MariaDB and Redis are on a bridge network with `internal: true`. No external access, not even from the host.
- **Read-only containers** — all persistent data goes to Docker volumes. Containers are ephemeral.
- **Drop all capabilities** — containers start with `cap_drop: ALL` and only add back what's strictly needed.
- **Separate worker replicas** — background jobs scale independently from the web server.
- **Nginx frontend sidecar** — a separate Nginx container sits in front of the backend. It serves static assets directly (avoiding the Python process for every CSS/JS file) and proxies API/WebSocket traffic to the appropriate upstream.
- **Configurator pattern** — a one-shot container handles first-run setup (site creation, app installation, configuration), so the main containers have clean startup logic.

## The Stack

| Component | Image | Role |
|-----------|-------|------|
| Nginx (frontend) | Same Frappe image | Static asset serving, reverse proxy to backend/websocket |
| Frappe/ERPNext (backend) | Custom build from `frappe/erpnext:v15.41.0` | Gunicorn web server, API |
| Workers × N | Same custom image | Background job processing |
| Scheduler | Same custom image | Scheduled task dispatch |
| MariaDB | `mariadb:10.8` | Primary database |
| Redis (×3) | `redis:7-alpine` | Cache, job queue, SocketIO pub/sub |
| WebSocket | Same custom image | Node.js SocketIO server |
| Caddy | Host-level | TLS termination, HTTP/2 reverse proxy |
| Cloudflare | DNS (proxied) | CDN, DDoS protection, edge caching |

## Building the Custom Image

The official Frappe Docker images include ERPNext but not HRMS. I needed a custom build:

```dockerfile
FROM frappe/erpnext:v15.41.0

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends git nodejs npm \
    && apt-get clean

RUN bench get-app --branch v15.0.0 hrms https://github.com/frappe/hrms

USER frappe
```

The `configurator` container in `compose.yaml` then creates the Frappe site, installs ERPNext and HRMS, applies overrides from `site_config.json`, and runs `setup-site.py` to create the admin user and disable public signup.

## Access Control

Frappe has built-in user management, but I wanted a declarative approach. Users are defined in `config/users.yaml`:

```yaml
users:
  - email: admin@example.com
    first_name: Admin
    last_name: User
    password: "<strong-password>"
    role: System Manager
    enabled: 1
```

A `sync-users.sh` script reads this file and creates or updates users via the Frappe console. Self-signup is explicitly disabled in both the Frappe System Settings and the site config.

This means:
- No registration page
- No invite links
- Only users I explicitly add can log in
- Changes are Git-tracked (the YAML file lives in the repo)

## Backups and Disaster Recovery

The backup script creates:

1. **Database dump** — gzipped SQL via `bench backup`
2. **Public files** — uploaded documents and images
3. **Private files** — employee records, payroll data

All three are stored locally with a configurable retention (default 14 days). The `update.sh` script automatically creates a pre-update backup before any upgrade — so you can always roll back.

Restore is a one-liner:

```bash
./scripts/restore.sh 20260708_020000
```

This stops the web server, restores the database and files, verifies integrity, and brings the service back up.

## Reverse Proxy

### Caddy (Edge)

Caddy terminates TLS and forwards all traffic to the Nginx frontend container:

```caddy
hrms.vasil.dpdns.org {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    encode zstd gzip

    handle /socket.io/* {
        reverse_proxy hrms-frontend:8080 {
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Forwarded-Host {host}
        }
    }

    handle {
        reverse_proxy hrms-frontend:8080 {
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Forwarded-Host {host}
            header_up X-Forwarded-Port {remote_port}
        }
    }
}
```

Everything — assets, API, WebSocket — goes to the Nginx sidecar on port 8080. Caddy doesn't serve assets directly; that's Nginx's job.

### Nginx Frontend

Each Frappe site has its assets stored in a shared `assets` Docker volume (symlinks to each app's `public` directory). The Nginx sidecar serves them and proxies everything else to the appropriate container:

```nginx
server {
    listen 8080;
    server_name _;

    client_max_body_size 10M;

    # Static assets with aggressive caching
    location /assets/ {
        root /home/frappe/frappe-bench/sites;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri $uri/ @asset_404;
    }

    # 404 without cache headers — prevents Cloudflare from caching errors
    location @asset_404 {
        internal;
        return 404;
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://websocket:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Everything else → backend
    location / {
        proxy_pass http://backend:8000;
    }
}
```

A subtle but critical detail: the `@asset_404` named location returns 404 *without* cache headers. If the `try_files` fallback returned 404 directly in the `/assets/` block, Nginx would add `expires 1y` and `Cache-Control: public, immutable` to the error response — causing Cloudflare to cache the 404 for a year. This happened during initial deployment and took a Cloudflare cache purge to fix.

## Deployment Walkthrough

### Prerequisites

```bash
# Server (Ubuntu 24.04)
apt update && apt install -y docker.io docker-compose-v2 git

# Clone the project
git clone <repo-url> hrms
cd hrms

# Configure
cp .env.example .env
# Edit .env with secure passwords
```

### First Deploy

```bash
make install
```

This builds the custom Docker image, starts the data layer (MariaDB + Redis), runs the configurator to create the site and install apps, then starts all services.

### Daily Operations

```bash
make health        # Check everything is running
make backup        # Manual backup
make logs backend  # Watch web server logs
make sync-users    # Add/update users after editing config/users.yaml
```

### Upgrades

```bash
make update
```

This creates a pre-update backup, pulls new base images, rebuilds the custom image, restarts services, runs `bench migrate`, clears caches, and verifies health. If anything fails, rollback is:

```bash
git checkout <previous-version>
make install
```

## Lessons Learned

**1. The Frappe Docker image is opinionated.** The official entrypoint script has its own site creation and service management logic. Working with it rather than against it made the setup more robust.

**2. Configurator vs init containers.** I initially tried to bake all setup into the entrypoint, but separate configurator containers are cleaner. They run once, they exit, and the main containers don't need startup conditionals.

**3. Named volumes are non-negotiable.** Bind mounts seem simpler but volumes are easier to back up, snapshot, and migrate. Frappe's bench stores everything under `/home/frappe/frappe-bench/`, so a single `sites` volume captures the entire state.

**4. Resource limits prevent cascading failures.** Frappe's background jobs can consume significant memory. Setting `mem_limit` on the worker containers prevents a single runaway job from taking down the whole stack.

**5. Test restores before you need them.** I verified the restore script works by doing a full backup → restore → verify cycle on a staging instance before relying on it for production.

**6. Caddy can't serve Frappe's assets from another container.** Frappe's assets are symlinks inside a Docker volume mounted on the backend/frontend containers. Caddy runs in its own container without access to that volume. An Nginx sidecar sharing the same volumes is the simplest solution — it serves assets from disk and proxies everything else.

**7. Cloudflare will cache your 404s.** If Nginx returns a 404 with `Cache-Control: public, max-age=31536000` (from `expires 1y`), Cloudflare caches that error for a full year. Use a named `@location` to serve 404s without cache headers. Always verify after a cache purge: check `cf-cache-status: MISS` on the first request.

**8. Named volumes for assets need careful mount ordering.** The configurator creates symlinks (`assets/frappe → …/apps/frappe/frappe/public`) in the `sites` volume. A separate `assets` volume is mounted on top of `sites/assets` to hold generated files like `assets.json`. The symlinks survive because they're created into the `assets` volume by the configurator.

## What's Next

- **S3-compatible backup destination** — push backups to MinIO or Backblaze B2 instead of local disk
- **Authentik SSO integration** — connect Frappe to Authentik for centralized auth across self-hosted services
- **Prometheus metrics** — expose queue depths, request latency, and database pool usage
- **Automated image builds** — GitHub Actions to rebuild the Docker image weekly with latest HRMS updates

## Conclusion

Frappe HRMS is a capable, open-source HR platform that runs well on modest hardware. With Docker Compose, Caddy, and some thoughtful scripting, you get a production-grade deployment that's maintainable, secure, and recoverable.

The project source is available [on GitHub](https://github.com/vasil1729/hrms) — including compose files, scripts, configuration, and everything needed to reproduce this setup.

---

*Part of my self-hosting series. Previously: [Hermes Agent Optimization](@/blog/hermes-agent-optimization.md)*
