+++
title = "Profiling and Optimizing an AI Agent's Resource Usage"
description = "A deep dive into analyzing a deployed Hermes agent's RAM and disk footprint, the five changes that cut its memory reservation in half, and the SQLite performance tuning that made it snappier."
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
| `profiles/` | **2.3 GB** | 89 leftover bench test profiles |
| `.local/` | **681 MB** | Pip user-site packages + uv cache |
| `hermes-agent/` | **268 MB** | Full upstream git repo clone |
| `.cache/` | **223 MB** | pip/uv download caches |
| `state.db` | **115 MB** | SQLite session database |
| `logs/` | 24 MB | Rotated agent logs |

423 MB RAM + ~3.6 GB of disk bloat. Time to investigate.

---

## Step 2: Finding the Hotspots

### Where does the 423 MB RSS go?

The gateway runs as a single Python process with asyncio. Looking at the logs and the codebase, the major contributors are:

- **Python interpreter + standard library** — ~15 MB baseline
- **Imported modules** — OpenAI SDK, httpx, Rich, prompt_toolkit, SQLite, yaml, etc. — ~80-100 MB
- **Session state** — The agent keeps `_session_messages` in memory for the active conversation. With a default `max_turns` of 90, a long conversation can accumulate hundreds of messages before resetting.
- **Mem0 (local Qdrant)** — The memory provider uses Qdrant in local mode with `on_disk: true`. At rest, the vector store is only 48 KB (barely used), but the `mem0` library with its embedding pipeline adds ~50 MB.
- **Thread overhead** — Each API call spawns a new thread. A single conversation typically spawns threads 4491–4547, though each lives only for the duration of the HTTP request.

### The SQLite hot seat

The `state.db` was particularly interesting. At 115 MB with default PRAGMAs, every session lookup was paying a heavy tax:

| Setting | Value | Problem |
|---------|-------|---------|
| `journal_mode` | WAL | OK |
| `synchronous` | FULL (2) | fsync per transaction — safe but slow |
| `cache_size` | 2 MB | Tiny — any decent-sized read hits disk |
| `auto_vacuum` | NONE | Deleted rows leave dead space, file grows forever |
| `freelist_count` | 310 pages | ~1.2 MB of unreclaimable free pages |
| `mmap_size` | 0 | No memory-mapped I/O |

The SQLite connection was opened fresh for every read, with no PRAGMA tuning applied in the `SessionDB.__init__` constructor. Each connection defaulted to the most conservative settings.

---

## Step 3: The Changes

### Change 1: Right-size the memory limit

The most obvious fix was the 2 GB → 1 GB memory limit:

```yaml
# docker-compose.yml — gateway service
mem_limit: 1g
mem_reservation: 512m
```

`mem_reservation: 512m` is the interesting part. Docker guarantees at least 512 MB will be available to the container (the *reservation*), but allows burst up to 1 GB (the *limit*). Since steady-state usage is 423 MB, this gives ~100 MB headroom for traffic spikes while freeing 1 GB for the host scheduler to allocate elsewhere.

### Change 2: Strip build artifacts from the Docker image

The Dockerfile was a standard multi-stage build: clone the repo, install Python deps, install Node.js deps, copy everything to the final stage. The problem was *everything* was copied — including `node_modules/`, `tests/`, `website/`, `web/`, `ui-tui/`, `apps/`, `optional-skills/`, and the `.git/` directory.

```dockerfile
# gateway/Dockerfile — added after COPY
RUN rm -rf \
    /app/hermes/node_modules /app/hermes/tests \
    /app/hermes/website /app/hermes/web \
    /app/hermes/ui-tui /app/hermes/apps \
    /app/hermes/optional-skills /app/hermes/.git
```

Saves ~320 MB from the image layer and prevents these files from being available in the container at runtime.

### Change 3: Suppress pip/uv caches at runtime

The lazy dependency installer was writing cache files that would never be reused across container restarts (the caches live in the bind-mounted volume):

```yaml
# docker-compose.yml — gateway environment
PIP_NO_CACHE_DIR: "true"
UV_NO_CACHE: "true"
```

This prevents `.cache/pip/` and `.cache/uv/` from growing on every lazy install.

### Change 4: SQLite performance tuning

This was the most impactful change. I created a patch that sets optimal PRAGMAs on every `SessionDB` connection:

```patch
# patches/012-sqlite-performance.patch
+self._conn.execute("PRAGMA synchronous=NORMAL")
+self._conn.execute("PRAGMA cache_size=-64000")   # 64 MB cache
+self._conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
+self._conn.execute("PRAGMA temp_store=MEMORY")
+self._conn.execute("PRAGMA mmap_size=268435456")  # 256 MB mmap
```

| Setting | Before | After | Why |
|---------|--------|-------|-----|
| `synchronous` | FULL | NORMAL | WAL mode already protects against corruption; NORMAL avoids an extra fsync per transaction, which is the dominant cost for write-heavy workloads |
| `cache_size` | 2 MB | 64 MB | Keeps hot pages in RAM; a session FTS query that touches thousands of rows goes from 100+ disk reads to ~zero |
| `auto_vacuum` | NONE | INCREMENTAL | Recovers free pages on each commit instead of letting the file grow forever |
| `temp_store` | FILE | MEMORY | Temp sorts (e.g. ORDER BY on FTS results) stay in RAM instead of writing to disk |
| `mmap_size` | 0 | 256 MB | Large reads use mmap'd I/O — avoids copying through the page cache, reduces syscall overhead |

I also ran VACUUM + REINDEX live to reclaim the freelist pages and defragment the FTS5 indexes:

```bash
# Before: page_count=29269, freelist=310
# After:  page_count=28958, freelist=0
```

The patch applies to every new `SessionDB` connection, so all future connections — including the gateway's per-request session lookups — get the tuned settings. I also added the same PRAGMAs to `entrypoint.sh` so they take effect even before a rebuild:

```sh
# gateway/entrypoint.sh
python3 -c "
import sqlite3
conn = sqlite3.connect('$DB')
conn.execute('PRAGMA synchronous=NORMAL')
conn.execute('PRAGMA cache_size=-64000')
conn.execute('PRAGMA auto_vacuum=INCREMENTAL')
conn.execute('PRAGMA temp_store=MEMORY')
conn.execute('PRAGMA mmap_size=268435456')
conn.close()
"
```

### Change 5: Cap conversation length

The default `max_turns` was 90, meaning a single conversation could accumulate 90+ messages before resetting. Each message stays in `_session_messages` until the turn ends, and every API call resends the entire conversation history. On a long conversation, this inflates both RAM and API call latency (more tokens = slower).

```yaml
# config.yaml
agent:
  max_turns: 30
```

This is still generous enough for multi-step tool-using conversations, but prevents unbounded growth.

### Change 6: Remove the stale repo and test artifacts

```bash
rm -rf ~/hermes-docker/data/hermes/hermes-agent/       # 268 MB — stale clone
rm -rf ~/hermes-docker/data/hermes/profiles/bench*      # ~2.25 GB — test profiles
rm -rf ~/hermes-docker/data/hermes/bench_*              # ~52 MB — leftover test data
rm -rf ~/hermes-docker/data/hermes/.cache/pip/          # 223 MB — pip cache
rm -rf ~/hermes-docker/phase*.py                        # test scripts in deploy root
```

Total reclaimed: **~2.8 GB** of disk.

---

## Step 4: The Results

| Metric | Before | After |
|--------|--------|-------|
| Gateway RSS | 423 MB | ~415 MB (no meaningful change — as expected) |
| Memory limit | 2 GB | 1 GB |
| Memory reservation | none | 512 MB |
| Docker image size | ~1.1 GB | ~780 MB |
| Volume disk usage | 3.8 GB | ~1 GB |
| state.db freelist | 310 pages | 0 |
| state.db auto_vacuum | NONE | INCREMENTAL |
| state.db SQLite cache | 2 MB | 64 MB |
| SQLite synchronous | FULL | NORMAL |
| Agent max_turns | 90 | 30 |
| Cache dir growth | unbounded | capped |

The RAM savings came from the **memory limit reduction**, not from making the process use less memory. The process RSS stayed essentially the same — it was already using an appropriate amount for its workload. The fix was giving it a more realistic ceiling.

The disk savings came from deleting stale clones, test artifacts, and caches. The SQLite tuning won't show up in `docker stats` but it's where the runtime performance improvement lives: session lookups that were paying an fsync tax on every write and a page fault on every read are now staying in RAM.

---

## What I Learned

**SQLite defaults are for embedded use cases, not servers.** The SQLite authors optimize for "works everywhere with minimal configuration." For a server process that opens and closes connections frequently, the defaults are terrible: synchronous=FULL (slow), cache_size=2000 pages (tiny), auto_vacuum=NONE (bloat). The single biggest performance win was setting these once at connection init time.

**`mem_reservation` is more important than `mem_limit`.** Setting a high limit without a reservation means the container can be starved by other processes (the kernel might overcommit). Setting a low limit without headroom means OOM kills during traffic spikes. Both together give the scheduler clear signals.

**Docker images are not trees.** The multi-stage build was doing the right thing for dependency management, but I was bringing the entire forest into the final stage. Stripping tests, documentation, web UIs, and git history from the production image is obvious in hindsight.

**Monitoring: don't guess, measure.** I assumed the agent was memory-hungry because "AI agent" sounds resource-intensive. The numbers showed a different story: 423 MB is modest for a Python process managing session state, a vector store, and a Telegram gateway. The real waste was in the limits, not the usage.

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
python3 -c "
import sqlite3
conn = sqlite3.connect('data/hermes/state.db')
conn.execute('PRAGMA synchronous=NORMAL')
conn.execute('PRAGMA cache_size=-64000')
for p in ['journal_mode', 'synchronous', 'cache_size', 'auto_vacuum',
          'page_count', 'freelist_count', 'page_size']:
    c = conn.execute(f'PRAGMA {p}')
    print(f'{p}: {c.fetchone()[0]}')
conn.close()
"

# VACUUM + REINDEX state.db
python3 -c "
import sqlite3
conn = sqlite3.connect('data/hermes/state.db')
conn.execute('PRAGMA auto_vacuum=INCREMENTAL')
conn.execute('VACUUM')
conn.execute('REINDEX')
conn.execute('PRAGMA optimize')
conn.close()
print('VACUUM + REINDEX complete')
"

# Rebuild and restart after docker-compose changes
docker compose build gateway && docker compose up -d gateway

# View state.db size on host
ls -lh ~/hermes-docker/data/hermes/state.db
```
