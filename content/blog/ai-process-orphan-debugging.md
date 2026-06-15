+++
title = "How 10 Orphaned AI Processes Ate My Server's RAM (And How I Fixed It)"
description = "A debugging story about orphaned processes, memory pressure, and the simple fixes that prevent long-running AI agents from silently consuming your server's RAM."
date = 2026-06-15
updated = 2026-06-15

[extra]
canonical = ""
+++

## The Symptom

I ran my usual script to open a shell inside my container:

```bash
./connect-container.sh
```

The MOTD banner flashed, then immediately dumped me back to my host prompt. No error message. The container was clearly running — I checked with `incus list`. What was going on?

---

## The Discovery

I checked available memory:

```bash
free -h
```

```
               total        used        free      shared  buff/cache   available
Mem:           7.8Gi       7.4Gi       234Mi       398Mi       795Mi       353Mi
```

**353 MiB available out of 7.8 GiB.** The system was nearly out of memory.

I looked at what was consuming it:

```bash
ps aux --sort=-%mem | head -20
```

```
USER         PID %CPU %MEM    VSZ   RSS COMMAND
1001001   2467254  1.5  7.2 75034532 588408 opencode
1001001   3856527  2.4  6.6 75239312 543076 opencode
1001001   1105825  2.5  6.5 75148488 531892 opencode
...
```

Ten instances of `opencode` — an AI agent process — each consuming 400–600 MB of RAM. That's roughly **5 GB** of RAM eaten by a single program running in 10 copies.

---

## The Root Cause

The timeline told the story. Looking at the process start dates:

```
Jun 09 — PID 3066966
Jun 10 — PID 3856527
Jun 11 — PID 438983
Jun 12 — PIDs 1005413, 1077883, 1105825, 1176718, 1203963
Jun 14 — PIDs 2467254, 2538195
```

Each day I had connected to the container, ran `opencode` to use the AI assistant, then disconnected. When a shell exits, its child processes become **orphaned** — they get re-parented to PID 1 and keep running. Since `opencode` is a long-lived process (it keeps a language model loaded), it never terminates on its own.

Over a week, these orphans accumulated. Each one silently reserving ~500 MB.

---

## The Fix

### Step 1: Emergency Cleanup

Kill all the stale instances at once:

```bash
sudo kill -9 <PID1> <PID2> ...
```

Result:

```
               total        used        free      shared  buff/cache   available
Mem:           7.8Gi       2.8Gi       4.6Gi       397Mi       1.0Gi       4.9Gi
```

**3.6 GB freed instantly.** The remaining 2.8 GB was actual legitimate usage.

### Step 2: Prevent Future Orphans

The problem was structural: when I ran `opencode`, bash started it as a **child process**. When bash exited, the child was orphaned.

The fix is to use `exec`, which **replaces** the shell process with `opencode` instead of creating a child. When `opencode` exits (or the connection drops), nothing is left behind:

```bash
alias opencode='exec opencode'
```

I added this to `~/.bashrc`.

### Step 3: Safety Net

Even with the alias, there are edge cases — running opencode through other tools, force-killed shells, etc. So I added a cleanup to `~/.bash_logout`, which runs automatically when a login shell exits. The full file looks like this:

```bash
# ~/.bash_logout: executed by bash(1) when login shell exits.

# when leaving the console clear the screen to increase privacy
if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi

# Kill orphaned processes on logout
pkill -u "$(id -u)" -x opencode 2>/dev/null
pkill -u "$(id -u)" -x zed-editor 2>/dev/null
```

The original file just cleared the screen. The two `pkill` lines I added say: "before you close the door, check if any opencode or zed-editor processes are still running under my user ID. If so, kill them."

### Step 4: Bonus Safeguards

- **Added 2 GB swap** — prevents OOM killer from randomly terminating processes if memory spikes again.
- **Set memory limits on containers** — capped each container to prevent any single service from starving the host.

---

## The Lesson

Any long-running process you launch from a shell session can become an orphan if you exit without terminating it. This is especially dangerous with AI agents and language model servers, which:

1. Load large models into memory (500 MB+ each)
2. Run indefinitely by design
3. Don't respond to terminal hangup signals (SIGHUP)

**The rule I follow now:** either use `exec` to run the process in place of the shell, or explicitly clean up child processes in `~/.bash_logout`.

---

## Commands Reference

```bash
# Check memory pressure
free -h

# Find top memory consumers
ps aux --sort=-%mem | head -20

# Check process start dates
ps -o pid,ppid,lstart,cmd -p <PID>

# Kill by name
pkill -u "$(id -u)" -x opencode

# Add swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
