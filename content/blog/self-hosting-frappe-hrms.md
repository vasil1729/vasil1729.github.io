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
Internet → Cloudflare DNS → Caddy (TLS) → Frappe Backend
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
- **Configurator pattern** — a one-shot container handles first-run setup (site creation, app installation, configuration), so the main containers have clean startup logic.

## The Stack

| Component | Image | Role |
|-----------|-------|------|
| Frappe/ERPNext | Custom build from `frappe/erpnext:v15.41.0` | Web server (Gunicorn), API, background workers, scheduler |
| MariaDB | `mariadb:10.8` | Primary database |
| Redis | `redis:7-alpine` | Cache, job queue, SocketIO pub/sub |
| Caddy | Host-level | Reverse proxy, TLS, static file serving |
| Cloudflare | DNS + API | TLS certificate automation via DNS challenge |

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
  - email: vasilardev@gmail.com
    first_name: Vasil
    last_name: Admin
    password: "caderousse"
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

Caddy handles the edge with automatic TLS via Cloudflare's DNS challenge:

```caddy
hrms.vasil.dpdns.org {
    tls { dns cloudflare {env.CLOUDFLARE_API_TOKEN} }
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        X-XSS-Protection "1; mode=block"
        -Server
    }

    handle /assets/* {
        root * /home/frappe/frappe-bench/sites
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    handle {
        reverse_proxy backend:8000
    }
}
```

Static assets get aggressive caching (1 year, immutable). Everything else proxies to the Frappe backend with WebSocket support for real-time updates.

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

## What's Next

- **S3-compatible backup destination** — push backups to MinIO or Backblaze B2 instead of local disk
- **Authentik SSO integration** — connect Frappe to Authentik for centralized auth across self-hosted services
- **Prometheus metrics** — expose queue depths, request latency, and database pool usage
- **Automated image builds** — GitHub Actions to rebuild the Docker image weekly with latest HRMS updates

## Conclusion

Frappe HRMS is a capable, open-source HR platform that runs well on modest hardware. With Docker Compose, Caddy, and some thoughtful scripting, you get a production-grade deployment that's maintainable, secure, and recoverable.

The full project source is available [on GitHub](https://github.com/yourusername/hrms) — including compose files, scripts, documentation, and everything needed to reproduce this setup.

---

*Part of my self-hosting series. Previously: [Hermes Agent Optimization](@/blog/hermes-agent-optimization.md)*
