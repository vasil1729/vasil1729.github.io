+++
title = "Migrating an AI Agent from Incus to Docker: A Security Retrospective"
description = "Why I moved my autonomous AI agent (Hermes) from an Incus container to a hardened Docker Compose stack — seccomp, read-only rootfs, dropped capabilities, network segmentation, and the tradeoffs I made along the way."
date = 2026-06-17
updated = 2026-06-18

[taxonomies]
tags = ["docker", "security", "incus", "ai-agent", "infrastructure"]
+++

## The Problem Space

Autonomous AI agents are not static websites or CI runners. They receive untrusted input from the outside world (in this case, Telegram messages), execute tools against that input (shell commands, file operations, API calls), manage their own codebase (self-modification via tool calls), and run scheduled jobs. Every Telegram message is a potential attack vector — prompt injection can trick the agent into issuing a malicious tool call, which means RCE from a chat message is a realistic threat.

The core architectural tension is:

**You need to give the agent enough access to be useful** (code modification, tool execution, network access to LLM APIs), **but limit the blast radius if that access is abused** via an injected prompt.

This tension applies to any autonomous agent deployment, regardless of the specific software being used. The problem isn't about hermes-agent specifically — it's about how you isolate a process that must simultaneously hold sensitive credentials, write to its own code directory, and accept untrusted input.

Containerization solves part of it (namespace isolation, cgroup limits), but the default container posture — writable rootfs, full capability set, no network segmentation — is designed for general-purpose workloads, not high-risk processes. The Incus container that hosted the agent before this migration had the same flat trust model as any default Docker container: one compromise, everything gone.

The solution is to think in terms of blast radius reduction rather than perfect prevention. No practical deployment can stop a kernel 0-day. But you can make the common attack chain — prompt injection → tool call RCE → privilege escalation → lateral movement → persistence — fail at the first few steps by stripping the container of everything it doesn't explicitly need.

---

## The Architecture Before

The agent (called Hermes) runs inside an Incus container on a single VPS. The container holds everything:

<pre class="mermaid">
flowchart TB
  subgraph hermes_prod["Incus Container: hermes-prod"]
    direction TB
    R[("Redis :6379")]
    P[("Postgres :5432")]
    C[("Caddy :80→:8443")]
    A["Hermes Gateway (Python)<br/>GBrain MCP Server (Bun)"]
  end
  
  subgraph props[" "]
    IP["Bridge IP: 10.10.10.100"]
    CAP["Full capabilities, writable rootfs"]
    SEC["No seccomp, no AppArmor per-process"]
  end

  hermes_prod --- props
</pre>

It worked. But the question I asked myself was: **what happens when someone achieves RCE through the agent?**

Not if — when. Prompt injection is a known risk for autonomous agents. A Telegram message that tricks the agent into executing a malicious tool call is a realistic scenario. The question is the blast radius.

### The Incus Blast Radius

With the container running as a standard Incus system container:
- Full Linux capability set (~40 capabilities)
- Writable rootfs — attacker can write binaries to `/usr/bin/`, plant `ld.so.preload`, modify systemd services
- No seccomp profile — all syscalls available
- Postgres and Redis are accessible via localhost with no network policy
- All API keys, tokens, and secrets are in a single `.env` file readable from the same shell
- No memory limits per service — a single OOM in any process threatens all others

This is a **single trust domain**. Compromise one process, compromise everything.

---

## The Security Constraints That Drove the Design

I had three requirements that pulled in different directions:

1. **Hardened isolation** — the gateway process should have as little kernel and filesystem access as possible
2. **Self-modification** — I regularly ask the agent to modify its own code, apply patches, deploy updates via Telegram. This means the agent needs write access to its codebase
3. **Free LLM models** — the agent uses opencode-zen free-tier models through the same API key

The tension is obvious: requirement 1 wants a read-only, capability-starved container. Requirement 2 wants write access. Reconciling them is the core architectural decision.

### The Solution: Split the Concern

Not with a management sidecar container — that would defeat the self-modification workflow. Instead:

- **Rootfs is read-only** (`read_only: true` in Docker) — protects `/usr/bin/`, `/lib/`, `/etc/` from tampering
- **Code and data are writable volumes** — `./data/hermes/` is bind-mounted read-write, giving the agent exactly the directories it needs to modify
- **Capabilities are dropped entirely** (`cap_drop: ALL`) — no `mount`, no `mknod`, no `SYS_ADMIN`, no `NET_RAW`
- **Seccomp is on by default** — Docker's default seccomp profile blocks hundreds of syscalls used in kernel escape exploits
- **No new privileges** (`no-new-privileges:true`) — prevents setuid/setcap escalation
- **Network segmentation** — Postgres and Redis live on an `internal: true` network (`db_net`) that the gateway can reach but nothing else can
- **Memory limits per service** — each container gets a `mem_limit` so a crafted input can't exhaust host memory

The threat model then becomes: an attacker who achieves Python RCE in the gateway gets a process that can read/write agent data and code, but **cannot** escape the container's kernel isolation, cannot reach Postgres without credentials, cannot pivot to other network services, and cannot persist outside of its data volume.

---

## The Target Architecture

<pre class="mermaid">
flowchart TB
  subgraph docker["Docker Compose Stack"]
    subgraph db_net["db_net (internal)"]
      direction LR
      RD[("Redis :6379")]
      PG[("Postgres :5432")]
    end

    subgraph backend_net["backend_net"]
      direction TB
      GW["Hermes Gateway
        read_only: true, cap_drop: ALL
        seccomp: default, no-new-privs
        mem_limit: 2G
        volumes: data (rw)"]
      GB["GBrain (Bun MCP)
        read_only: true, cap_drop: ALL
        mem_limit: 1G"]
    end
  end

  RD --- GW
  PG --- GW
  GW --- GB
</pre>

### Service Breakdown

| Service | Image | Role |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Session storage, conversation history |
| `redis` | `redis:7-alpine` | Message queuing, caching |
| `gbrain` | `oven/bun:1.3-slim` | Knowledge brain MCP server (github:garrytan/gbrain) |
| `gateway` | Custom build from patched hermes-agent | The agent itself |

### Networking

Two networks:
- **`db_net`** (`internal: true`): Postgres (5432) + Redis (6379). Only the gateway is on this network. No external access.
- **`backend_net`**: Gateway + gbrain (9876). Not internal — the gateway needs outbound HTTPS to Telegram and opencode APIs.

No ports are exposed to the host. The gateway uses Telegram long-polling, so no reverse proxy is needed.

### Persistent Volumes

```
./data/
├── postgres/          # Postgres data directory
├── redis/             # Redis append-only log
├── hermes/            # Agent config, sessions, memory, logs, state.db
│   ├── .env
│   ├── config.yaml
│   ├── profiles/
│   ├── sessions/
│   ├── cron/
│   ├── logs/
│   ├── state.db
│   └── ...
└── gbrain/            # Knowledge brain data
    ├── config.json
    └── brain.pglite/
```

---

## The Patches That Made It Work

The hermes-agent upstream has no tenant isolation. I added 11 patches across the codebase to scope every data path by `chat_id`:

| Patch | File | What It Does |
|---|---|---|
| Memory scope | `agent/agent_init.py` | Passes `chat_id` to `MemoryStore` for per-chat disk storage |
| User-group perms | `gateway/authz_mixin.py` | Enables per-user-per-group authorization from `config.yaml` |
| Provider hiding | `gateway/slash_commands.py` | Hides internal providers from `/model` command output |
| Model switch | `hermes_cli/model_switch.py` | Injects opencode-zen as a free provider |
| Free Zen models | `hermes_cli/models.py` | Filters to only $0-cost models; replaces curated list |
| Session scope | `hermes_state.py` | Scopes FTS5 message search by `chat_id` |
| Mem0 local mode | `plugins/memory/mem0/__init__.py` | Adds Qdrant-based local memory as alternative to cloud Mem0 |
| Cron scope | `tools/cronjob_tools.py` | Cron jobs are only visible from the chat that created them |
| Memory tool scope | `tools/memory_tool.py` | Per-chat memory file paths |
| Session search scope | `tools/session_search_tool.py` | Session listing and search filtered by `chat_id` |
| Package lock | `package-lock.json` | Marks esbuild platform packages as `peer: true` |

### How Patches Survive in Docker

Instead of applying patches on a live filesystem (as they were in Incus), the Dockerfile clones the upstream repo at a pinned commit and applies each `.patch` file with `git apply`:

```dockerfile
RUN git clone https://github.com/NousResearch/hermes-agent.git /app/hermes && \
    cd /app/hermes && \
    git checkout 02f878ec5ac665bd9d7be7ec7093cd017e1084f9 && \
    for p in /app/patches/*.patch; do git apply "$p"; done
```

The patches live in `patches/` alongside `docker-compose.yml`, version-controlled. Rebuilding produces the same image every time.

---

## The Dockerfiles

### Gateway

```dockerfile
FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y git curl ca-certificates build-essential libpq-dev

COPY patches/ /app/patches/
RUN git clone https://github.com/NousResearch/hermes-agent.git /app/hermes && \
    cd /app/hermes && \
    git checkout 02f878ec5ac665bd9d7be7ec7093cd017e1084f9 && \
    for p in /app/patches/*.patch; do git apply "$p"

WORKDIR /app/hermes
RUN python -m venv /app/hermes/venv && \
    . /app/hermes/venv/bin/activate && \
    pip install --no-cache-dir -e ".[gateway]" python-telegram-bot

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && npm install

FROM python:3.12-slim
RUN adduser --disabled-password --gecos '' hermes
COPY --from=builder --chown=hermes:hermes /app/hermes /app/hermes
USER hermes
ENV PATH="/app/hermes/venv/bin:$PATH" \
    VIRTUAL_ENV=/app/hermes/venv \
    HERMES_HOME=/home/hermes
ENTRYPOINT ["/app/hermes/entrypoint.sh"]
CMD ["python", "-m", "hermes_cli.main", "gateway", "run"]
```

The `python-telegram-bot` extra is not included in the upstream's `.[gateway]` extras — it needs to be installed explicitly.

### GBrain (Knowledge Brain)

GBrain is a Bun/TypeScript project from `github:garrytan/gbrain`, installed globally via `bun install -g`. Getting it to work in a hardened container required several iterations:

```dockerfile
FROM oven/bun:1.3-slim
RUN apt-get update && apt-get install -y git ca-certificates
RUN bun install -g github:garrytan/gbrain && \
    useradd -m gbrain && \
    cp -r /root/.bun /home/gbrain/.bun && \
    chown -R gbrain:gbrain /home/gbrain/.bun && \
    chmod o+x /home/gbrain && \
    rm -f /usr/local/bin/gbrain && \
    ln -s /home/gbrain/.bun/install/global/node_modules/gbrain/src/cli.ts /usr/local/bin/gbrain

USER gbrain
WORKDIR /home/gbrain
EXPOSE 9876
ENTRYPOINT ["/usr/local/bin/gbrain", "serve", "--http", "--port", "9876"]
```

Key lessons:
- The `oven/bun:1.3-slim` image is Debian-based, not Alpine — use `useradd` not `adduser`
- `bun install -g` writes to `/root/.bun/` and creates a symlink at `/usr/local/bin/gbrain` pointing to the absolute root path — if you move `.bun` to a non-root user, you must recreate the symlink
- The `gbrain` home directory (`/home/gbrain`) defaults to `drwx------` — if you run the container as a different UID (e.g. for volume mount compatibility), other users cannot traverse it. `chmod o+x` fixes this.

---

## What Went Wrong (and How I Fixed It)

This section didn't exist in the original migration plan. It's here because the plan didn't survive contact with reality.

### 1. GBrain Wasn't on npm

My first Dockerfile for gbrain used `bun install -g gbrain`, which installed a completely different package — the JavaScript gbrain (a GPU ML library), not the knowledge brain MCP server. The actual package was a private dependency: `github:garrytan/gbrain`, defined in the Incus container's `~/.bun/install/global/package.json`.

**Fix**: Use `bun install -g github:garrytan/gbrain` instead.

### 2. Stale Symlinks After Moving .bun

`bun install -g` creates `/usr/local/bin/gbrain` as a symlink to `/root/.bun/install/global/node_modules/gbrain/src/cli.ts`. When I copied `/root/.bun` to `/home/gbrain/.bun` and switched to the `gbrain` user, the symlink still pointed to the original root path. Result: "executable file not found in $PATH".

**Fix**: Recreate the symlink to the new path.

### 3. Home Directory Traversal Denied

Even with the correct symlink, running the container as UID 1000 (for volume mount compatibility) gave "Permission denied" on `/usr/local/bin/gbrain`. The issue wasn't the binary — it was `/home/gbrain/` having `drwx------` permissions, preventing UID 1000 from traversing to the `.bun` directory.

**Fix**: `chmod o+x /home/gbrain` in the Dockerfile, and run as the `gbrain` user (UID 1001).

### 4. PGLite Stale Lock

After a clean shutdown, gbrain refused to start: "Timed out waiting for PGLite lock." The lock file at `brain.pglite/.gbrain-lock/lock` persisted across container restarts but was orphaned.

**Fix**: Clear the lock directory: `rm -rf brain.pglite/.gbrain-lock`.

### 5. Hardcoded Paths in Config

The gbrain `config.json` from the Incus container had `"database_path": "/home/<user>/.gbrain/brain.pglite"` — a hardcoded absolute path from the old container's filesystem. In Docker, the data is mounted at `/home/gbrain/.gbrain/`. With `read_only: true` and the old path pointing to a non-existent directory, gbrain tried to create `/home/<user>/` and failed with `EROFS`.

**Fix**: Update `config.json` to point to `/home/gbrain/.gbrain/brain.pglite`.

### 6. The Great Postgres Data Directory

The Incus container's Postgres data was owned by UID 70 (the `postgres` user in Ubuntu). On the host, this showed as `drwx------ 19 70` owned by an unknown user. In Docker, the `postgres:16-alpine` image runs as UID 999. With `cap_drop: ALL`, the container couldn't read the directory, and I couldn't `rm -rf` it from the host because I wasn't UID 70.

**Fix**: Run an Alpine container as root to delete and recreate the directory inside the bind mount.

### 7. Telegram Polling Conflict

After stopping the old Incus container and starting the new Docker gateway, Telegram returned "Conflict: terminated by other getUpdates request" for ~30 seconds. Telegram servers hold the polling session for a brief window after a disconnect.

**Fix**: Wait 30 seconds and restart the gateway. Not a real problem, but alarming the first time.

---

## Docker Compose Security Configuration

The final config after all fixes:

```yaml
x-security: &security
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL

services:
  postgres:
    <<: [*restart, *security]
    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]
    networks: [db_net]

  redis:
    <<: [*restart, *security]
    cap_add: [DAC_OVERRIDE, FOWNER, SETUID, SETGID]
    networks: [db_net]

  gbrain:
    <<: [*restart, *security]
    read_only: true
    tmpfs: [/tmp]
    networks: [backend_net]

  gateway:
    <<: [*restart, *security]
    read_only: true
    tmpfs: [/tmp]
    networks: [db_net, backend_net]
    depends_on:
      postgres: condition: service_healthy
      redis: condition: service_started
```

No service has `SYS_ADMIN`, `NET_ADMIN`, `DAC_OVERRIDE`, or any of the capabilities commonly used in container escape exploits.

---

## What Changed vs What Stayed

### What Got Better

| Concern | Before (Incus) | After (Docker Compose) |
|---|---|---|
| Rootfs | Fully writable | `read_only: true` for gateway + gbrain |
| Capabilities | Full set (~40) | All dropped, only specific ones added back per service |
| Seccomp | None | Default Docker seccomp profile |
| Network isolation | Single flat bridge | 2 networks: `db_net` (internal) + `backend_net` |
| Memory limits | cgroup per container (2GiB total) | Per-service `mem_limit` |
| Privilege escalation | Possible | `no-new-privileges:true` on all services |
| Audit trail | Uncommitted git diffs on live FS | Patches in `patches/` dir, version-controlled |
| Recovery from compromise | Manual inspection of live FS | `docker compose down && docker compose up -d` |
| Upgrade path | Manual patching of live filesystem | Rebuild image with `docker compose build` |

### What Stayed the Same

- **Management workflow**: I still ask the agent to modify its own code via Telegram. The code volume is writable, so the agent can `git pull`, edit files, and restart services.
- **Free LLM models**: The opencode-zen API key and model filtering patches work identically.
- **Data**: All sessions, memories, configs, and cron jobs are preserved via the mounted volumes.
- **Single-tenant design**: Still one agent per deployment, with per-user authorization inside.

---

## Could an Attacker Still Escape?

Yes — a host kernel 0-day can always work. Docker's seccomp profile makes it harder (many exploit primitives require syscalls that are filtered by default), but no container runtime is a full security boundary against the kernel.

What changed is the **practical blast radius**:

| Attack Stage | Incus | Docker |
|---|---|---|
| RCE via prompt injection | Full shell, all capabilities | Python process, 0 capabilities, read-only rootfs |
| Write a backdoor | `wget ... && chmod +x` | Fails — rootfs is read-only |
| Explore the network | Full access to bridge, can scan host | Only sees `db_net` (Postgres:5432, Redis:6379) |
| Dump credentials | `cat ~/.hermes/.env` | Only the gateway's env vars — not Postgres/Redis root |
| Pivot to host | Can try kernel exploits with all syscalls | Seccomp + no-caps blocks most known escape paths |
| Persist after restart | Backdoor survives in `/usr/bin/` | Volume is the only writable path; ephemeral rootfs |

For a practical attacker (not an APT), the Docker posture raises the bar from *"find a shell and run exploit.sh"* to *"find a Python RCE, understand the container environment, find a seccomp-bypass-capable kernel exploit, and execute it"* — a dramatically harder chain.

---

## The Migration Steps (Revised)

What I actually ran, in order:

1. **Extract patches**: `git diff HEAD` from the live container, split into logical `.patch` files
2. **Backup data**: `pg_dump` for Postgres, file copy for `~/.hermes/` and `~/.gbrain/`
3. **Build Docker images**: `docker compose build` — expect ~5 minutes for the gateway (npm install is slow)
4. **Start DB and restore**: `docker compose up -d postgres && docker compose exec -T postgres psql < dump.sql`
5. **Debug permissions**: Postgres data owned by wrong UID → clear and recreate; Redis needs `DAC_OVERRIDE`; gbrain config has hardcoded paths
6. **Start everything**: `docker compose up -d`
7. **Cut over**: `incus stop hermes-prod`, wait 30s for Telegram session to expire, `docker compose restart gateway`
8. **Verify**: `docker compose logs gateway | grep "✓ telegram connected"`

---

## The Takeaway

For a static website or a CI runner, Incus vs Docker is largely a stylistic choice. For an **AI agent with tool execution, cron jobs, and untrusted input**, they are not comparable.

The combination of:
- `read_only: true` (no writable rootfs)
- `cap_drop: ALL` (no kernel capabilities)
- `no-new-privileges:true` (no setuid escalation)
- Internal-only networks (no lateral movement)
- Per-service memory limits (no DoS by memory exhaustion)
- Version-controlled patching pipeline (repeatable, auditable builds)

...reduces the blast radius of a prompt-injection-to-RCE chain from *"total host compromise"* to *"lost session data."*

Is it perfect? No — a kernel 0-day can still break out. But it turns the attacker's job from "trivial" to "find and exploit a vulnerability in the Linux kernel's seccomp filter or cgroup implementation," which is a vastly different threat profile.
