+++
title = "Profiling and Optimizing an AI Agent's Resource Usage"
description = "A deep dive into analyzing a deployed Hermes agent's RAM and disk footprint, the five changes that cut its memory reservation in half, and the tools used to measure before-and-after."
date = 2026-07-04

[taxonomies]
tags = ["ai-agent", "docker", "performance", "python", "infrastructure"]

[extra]
+++

A few weeks after migrating my autonomous AI agent (Hermes) from Incus to a hardened Docker Compose stack, I started wondering: *is this thing eating too much RAM?* The Docker Compose file gave the gateway container a 2 GB memory limit, but I had no idea whether that was generous headroom or barely enough to keep it alive.

I decided to profile it properly — measure what it actually uses, find what's inflating its footprint, and cut where it makes sense.

---

## Step 1: Measuring Current Usage

The first tool in any Docker resource investigation is `docker stats`:

```bash
docker stats hermes-docker-gateway-1 --no-stream
```

What I saw:

| Container | Mem Usage | Limit | % | PIDs |
|-----------|-----------|-------|---|------|
| gateway | 423 MB | 2 GB | 21% | 19 |
| gbrain | 55 MB | 1 GB | 5.4% | 9 |
| postgres | 9.3 MB | 512 MB | 1.8% | 6 |
| redis | 3.2 MB | 192 MB | 1.7% | 6 |

The gateway was using **423 MB RSS** — well within its 2 GB limit. The limit itself was the problem: 2 GB was 4.7× the actual usage, reserving capacity that the host could use for other containers (Matrix, Gitea, databases, and a Telegram bot all share the same VPS).

But RSS is only part of the picture. I also checked disk footprint inside the mounted `data/hermes/` volume:

```bash
du -sh ~/hermes-docker/data/hermes/*/
```

| Path | Size | Suspect |
|------|------|---------|
| `.local/` | **681 MB** | Pip user-site packages + uv cache |
| `hermes-agent/` | **268 MB** | Full upstream git repo clone |
| `.cache/` | **223 MB** | pip/uv/npm caches |
| `state.db` | **115 MB** | SQLite session database |
| `logs/` | 24 MB | Rotated agent logs |

423 MB RAM + ~1.2 GB of disk bloat. I wanted to understand where it all comes from and what could be trimmed safely.

---

## Step 2: Finding the Hotspots

### Where does the 423 MB RSS go?

The gateway runs as a single Python process with asyncio. Looking at the logs and the codebase, the major contributors are:

- **Python interpreter + standard library** — ~15 MB baseline
- **Imported modules** — OpenAI SDK, httpx, Rich, prompt_toolkit, SQLite, yaml, etc. — ~80-100 MB
- **Session state** — The agent keeps `_session_messages` in memory for the active conversation. Each turn appends messages; the SQLite DB at 115 MB suggests significant session history.
- **Mem0 (local Qdrant)** — The memory provider uses Qdrant in local mode with `on_disk: true`. At rest, the vector store is only 48 KB (barely used), but the `mem0` library with its embedding pipeline adds ~50 MB.
- **Thread overhead** — Each API call spawns a new thread (`Thread-4491`, `Thread-4493`...). The logs show threads 4491–4547 in a single conversation, though each lives only for the duration of the HTTP request.
- **File descriptors** — 19 PIDs includes the main event loop, Telegram webhook server, cron scheduler, kanban dispatcher, and ephemeral API call threads.

### The disk bloat investigation

The three largest items on disk had different origins:

**`.local/` (681 MB):** This is the pip `--user` install directory. The agent lazy-installs optional dependencies at runtime — the log shows `"Lazy-installing discord.py[voice]==2.7.1 brotlicffi==1.2.0.1 for feature 'platform.discord'"` during a cron run. Every lazy install goes to `~/.local/lib/python3.*/site-packages/`, and pip caches downloaded wheels in `~/.cache/pip/`. Over weeks of operation, this accumulates.

**`hermes-agent/` (268 MB):** A full shallow clone of the upstream repository. This turned out to be a leftover from my pre-Docker local development setup. The Docker image has its own copy at `/app/hermes/` — the mounted volume copy is never read at runtime.

**`state.db` (115 MB):** SQLite database storing session history, message state, and agent metadata. With no VACUUM policy, deleted rows leave behind freelist pages that bloat the file.

---

## Step 3: The Changes

### Change 1: Right-size the memory limit

The most obvious fix was the 2 GB → 1 GB memory limit:

```yaml
# docker-compose.yml — gateway service
mem_limit: 1g
mem_reservation: 512m
```

`mem_reservation: 512m` is the interesting part. Docker guarantees at least 512 MB will be available to the container (the *reservation*), but allows it to burst up to 1 GB (the *limit*). Since steady-state usage is 423 MB, this gives ~100 MB headroom for traffic spikes while freeing 1 GB for the host scheduler to allocate elsewhere.

### Change 2: Strip build artifacts from the Docker image

The Dockerfile was a standard multi-stage build: clone the repo, install Python deps, install Node.js deps, copy everything to the final stage. The problem was *everything* was copied — including `node_modules/`, `tests/`, `website/`, `web/`, `ui-tui/`, `apps/`, `optional-skills/`, and the `.git/` directory.

```dockerfile
# gateway/Dockerfile — added after COPY
RUN rm -rf \
    /app/hermes/node_modules \
    /app/hermes/tests \
    /app/hermes/website \
    /app/hermes/web \
    /app/hermes/ui-tui \
    /app/hermes/apps \
    /app/hermes/optional-skills \
    /app/hermes/.git
```

This doesn't just save disk in the image layer — it prevents these files from ever being available in the container at runtime, which matters for `read_only: true` containers where accidentally writing to a mutable bind mount could populate these directories.

### Change 3: Suppress pip/uv caches at runtime

The lazy dependency installer was writing cache files that would never be reused across container restarts (the caches live in the bind-mounted volume). I added environment variables to disable caching:

```yaml
# docker-compose.yml — gateway environment
PIP_NO_CACHE_DIR: "true"
UV_NO_CACHE: "true"
```

This prevents `.cache/pip/` and `.cache/uv/` from growing on every lazy install. The installed packages themselves (in `.local/`) are still needed — those are the actual dependencies, not cache — but without this change, the cache directory alone was 223 MB and growing.

### Change 4: Periodic SQLite VACUUM

The 115 MB `state.db` wasn't necessarily 115 MB of real data. SQLite marks deleted rows as free pages; over time, the file grows but doesn't shrink. I added a maintenance script:

```bash
#!/bin/sh
# state-db-vacuum — runs inside the gateway container
DB="${HERMES_HOME:-/home/hermes}/state.db"
if [ -f "$DB" ]; then
    sqlite3 "$DB" "PRAGMA auto_vacuum=INCREMENTAL; VACUUM; REINDEX;"
fi
```

This script lives in `data/hermes/cron/` and runs weekly. The `auto_vacuum=INCREMENTAL` pragma tells SQLite to start reclaiming free pages incrementally rather than all at once during a VACUUM, which is gentler on I/O.

### Change 5: Remove the stale repo clone

This was the easiest: the `data/hermes/hermes-agent/` directory was a shallow clone I'd made during the initial migration for development convenience. The running container uses `/app/hermes/` from the image. Two weeks of accumulated cron jobs were touching the wrong copy and causing confusion.

```bash
rm -rf ~/hermes-docker/data/hermes/hermes-agent/
```

Saved 268 MB instantly.

---

## Step 4: The Results

After applying all changes and redeploying:

| Metric | Before | After |
|--------|--------|-------|
| Gateway RSS | 423 MB | ~415 MB (no meaningful change — as expected) |
| Memory limit | 2 GB | 1 GB |
| Memory reservation | none | 512 MB |
| Docker image size | ~1.1 GB | ~780 MB (-320 MB) |
| Volume disk usage | 3.8 GB | 2.7 GB (-1.1 GB) |
| state.db | 115 MB | 112 MB (first VACUUM reclaimed 3 MB) |
| Stale repo | 268 MB | 0 (deleted) |
| Cache dir growth | unbounded | capped (pip/uv caches disabled) |

The RAM savings came from the **memory limit reduction**, not from making the process use less memory. The process RSS stayed essentially the same — it was already using an appropriate amount for its workload. The fix was giving it a more realistic ceiling.

The disk savings came from deleting the stale clone (268 MB) and stripping the Docker image of Node.js build artifacts (~320 MB). The cache suppression prevents future bloat but doesn't reclaim the existing ~200 MB of cached files — those will be cleaned next time the container is rebuilt from scratch.

---

## What I Learned

**Monitoring: don't guess, measure.** I assumed the agent was memory-hungry because "AI agent" sounds resource-intensive. The numbers showed a different story: 423 MB is modest for a Python process managing session state, a vector store, and a Telegram gateway. The real waste was in the limits, not the usage.

**`mem_reservation` is more important than `mem_limit`.** Setting a high limit without a reservation means the container can be starved by other processes (the kernel might overcommit). Setting a low limit without headroom means OOM kills during traffic spikes. Both together give the scheduler clear signals.

**SQLite grows silently.** Without a VACUUM policy, even a well-behaved database expands to fill its history. A 115 MB SQLite file for a Telegram bot's session history means months of conversations — most of which will never be queried again. Adding a maintenance cron is cheap insurance.

**Docker images are not trees.** The multi-stage build was doing the right thing for dependency management, but I was bringing the entire forest into the final stage. Stripping tests, documentation, web UIs, and git history from the production image is obvious in hindsight — the agent doesn't serve a web dashboard or run unit tests at runtime.

---

## The Commands Reference

```bash
# Check container resource usage
docker stats hermes-docker-gateway-1 --no-stream

# Inspect Docker memory config
docker inspect hermes-docker-gateway-1 | python3 -c "
import sys, json; d = json.load(sys.stdin)[0]
print('mem_limit:', d['HostConfig']['Memory'])
print('mem_reservation:', d['HostConfig']['MemoryReservation'])
"

# Check SQLite database page count vs free pages
sqlite3 state.db "PRAGMA page_count; PRAGMA freelist_count; PRAGMA page_size;"

# Rebuild and restart after docker-compose changes
docker compose build gateway && docker compose up -d gateway

# View state.db size on host
ls -lh ~/hermes-docker/data/hermes/state.db
```
