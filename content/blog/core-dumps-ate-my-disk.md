+++
title = "How 367 Core Dumps Ate 64 GB of My Disk (And Locked Me Out of SSH)"
description = "A segfaulting Docker service, an unlimited core ulimit, and a bind mount silently filled my server with crash dumps until SSH stopped working. Here is how I found it, fixed it, and made sure it never happens again."
date = 2026-10-04
updated = 2026-10-04

[taxonomies]
tags = ["debugging", "linux", "docker", "ssh", "infrastructure"]

[extra]
canonical = ""
+++

## The Symptom

SSH stopped accepting logins. Not a timeout caused by a firewall, not an auth failure — the connection was accepted and then simply went nowhere, over and over. Nothing had changed in my config. My keys were fine.

With no remote access left, I fell back to the one door that is always open: the machine's VNC console. Through the VNC session I could see the problem immediately:

```bash
df -h /
```

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       145G   93G   53G  64% /
```

93 GB used. But this number alone did not explain an outage that happened when the disk was even fuller — and a disk that full does explain why sshd died: when the root filesystem hits 100%, sshd cannot write logs, cannot complete PAM session setup, and cannot fork its session processes. The daemon is "running", but every login attempt dies silently.

So the real question was not *why SSH died*. It was: **what filled my disk?**

---

## The Discovery

The first pass was the usual drill — find the biggest directory and drill down:

```bash
du -xh -d1 / | sort -hr
```

```
77G     /
68G     /home
3.6G    /var
3.3G    /usr
```

`/home` was 68 GB of a 145 GB disk. Drilling in:

```bash
du -xh -d1 /home/user | sort -hr
```

```
68G     /home/user
65G     /home/user/hermes-stack
1.2G    /home/user/matrix
1003M   /home/user/.local
```

One directory — `hermes-stack` — held 65 GB. Inside it:

```bash
du -sh /home/user/hermes-stack/data/gateway/*
```

```
65G     /home/user/hermes-stack/data/gateway
```

And inside *that*:

```bash
ls /home/user/hermes-stack/data/gateway/core.* | wc -l
```

```
367
```

**367 files named `core.<pid>`. 64 GB of them.**

```bash
file core.1563
```

```
core.1563: ELF 64-bit LSB core file, x86-64, version 1 (SYSV), SVR4-style,
from 'python -m hermes_cli.main gateway run', real uid: 1000 ...
execfn: '/app/hermes/venv/bin/python'
```

These were **core dumps** — and every single one came from my hermes gateway container.

---

## What a Core Dump Actually Is

When a process crashes from a fatal signal (segmentation fault, abort, bus error), the kernel can save a snapshot of the process's entire memory to a file before it disappears. That file is a core dump, and it is genuinely useful: with `gdb` you can load it and see exactly which function, which line, which pointer was bad.

The trade-off is size. The dump contains the process's *whole* address space — which for a process holding 800 MB of live data is an 800 MB file. Three settings turned that trade-off into a crisis:

1. **`ulimit -c unlimited`** — inside the container, core dumps were unlimited:

   ```bash
   docker exec hermes-gateway-1 sh -c 'ulimit -c'
   ```
   ```
   unlimited
   ```

2. **A crash loop.** The gateway was segfaulting repeatedly. The timestamps told the story — **66 dumps in a single hour** on Sep 15 02:00, another 52 in one hour on Sep 16:

   ```
   66  2026-09-15_02
   52  2026-09-16_08
   38  2026-09-15_04
   32  2026-09-16_05
   ```

   A process that crashes once is an incident. A process that crashes 115 times in 48 hours, with restart policy `unless-stopped`, is a disk-filling machine.

3. **The dumps landed on the host disk.** The container's working directory was `/home/gateway`, which is a bind mount of `./data/gateway` on the host. Every dump the kernel wrote "inside" the container physically landed in `/home/user/hermes-stack/data/gateway` — no container size limit, no image quota, just raw ext4.

The math:

```
115 real dumps × ~825 MiB ≈ 64 GB
```

The crash itself: reading the signal information out of one of the dumps with `readelf` showed **signal 11 — SIGSEGV, code `SEGV_MAPERR`** (a memory access to an address that simply was not mapped). The fault lived in native extension code the gateway loads (`hf_xet`, `py_rust_stemmers`, tokenizers) while processing embeddings under a 1 GiB `mem_limit` — most likely an `mmap` that failed under memory pressure and was never checked.

And the smoking gun for the outage: **252 of the 367 files were zero bytes.** The kernel created the file, then had nowhere left to write it. The final nine attempts, all within the same minute at 01:38 on Sep 17, were empty. That was the moment the disk ran dry — and the moment SSH stopped working.

---

## The Fix

### Step 1: Delete the dumps

Core dumps from a crash that happened weeks ago are dead weight. Unless I was about to sit down with `gdb` to dissect a two-week-old segfault, there was no reason to keep them:

```bash
rm -f /home/user/hermes-stack/data/gateway/core.*
```

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       145G   29G  116G  20% /
```

**64 GB reclaimed in one second.** Disk usage went from 64% to 20%.

### Step 2: Turn off core dumps for good

Deleting files fixes the past; only a limit fixes the future. Docker containers inherit an unlimited core ulimit by default, so I capped it in the service definition:

```yaml
# docker-compose.yml
  gateway:
    ...
    mem_limit: 1g
    mem_reservation: 512m
    ulimits:
      core: 0
```

Then recreated the container and verified:

```bash
docker compose up -d gateway
docker exec hermes-gateway-1 sh -c 'ulimit -c'
```

```
0
```

`0` means the kernel will never write a core dump for this container again. If the gateway segfaults now, it just restarts — no 825 MB souvenir left behind.

### Step 3: Make sure nothing else is quietly growing

```bash
docker system df
```

```
TYPE            TOTAL    ACTIVE    SIZE      RECLAIMABLE
Images          23       14        13.74GB   432.4MB (3%)
Containers      24       23        320.7MB   2.302MB (0%)
Local Volumes   26       12        614.3MB   898.4kB (0%)
```

Images were the next-biggest line item (13.7 GB, including unused ones), but they were not what took my server down.

---

## What I Would Do Differently

- **A restart loop must never run silently forever.** The gateway crashed hundreds of times over two days and I heard nothing. A cheap `df` check in cron — alert at 80% — would have caught this while I still had SSH.
- **Full dumps are overkill in production.** If you do want crash forensics, cap them at a few kilobytes (`ulimits: core: 1024`) — enough to know a crash happened, far too small to fill a disk.
- **The segfault is still unfixed.** Disabling dumps removed the blast radius, not the bug. The next step is to catch one crash deliberately: temporarily re-enable a capped dump (or run the gateway under `gdb`), reproduce the fault, and get a backtrace out of the native extension that is failing.
- **Disk-full outranks almost every other outage.** A service crash affects one service. A full root filesystem takes SSH, logging, package manager, cron, and every daemon that needs to write *anything* with it.

---

## The Lesson

A core dump is a debugging artifact that costs exactly as much RAM as your process uses — and a containerized service with `restart: unless-stopped`, an unlimited core ulimit, and a bind mount to the host disk will happily produce one copy per crash, forever, until the machine can no longer boot a login session.

**The rule I follow now:** every long-running container gets an explicit `ulimits: core:` line, and every server gets a disk alert before it needs a VNC rescue.

---

## Commands Reference

```bash
# What is eating the disk?
df -h /
du -xh -d1 / | sort -hr
du -xh -d1 /home/<user> | sort -hr

# Find core dumps
find / -name 'core.*' -size +1M 2>/dev/null
ls /path/to/dumps/core.* | wc -l

# Identify what crashed
file core.<pid>
readelf --notes core.<pid>        # NT_SIGINFO holds the fatal signal

# Dump settings
cat /proc/sys/kernel/core_pattern
ulimit -c                          # current shell
docker exec <container> sh -c 'ulimit -c'

# Disable dumps for a container (docker-compose.yml)
#   ulimits:
#     core: 0
docker compose up -d <service>

# Docker-level space audit
docker system df -v
docker ps -a --format '{{.Names}}'   # spot crash-looping containers
```
