+++
title = "A Loose Cable, a Slow WSL Boot, and a Shell That Kept Losing My PATH"
description = "A debugging story about running WSL Ubuntu off a flaky external HDD — a slow, fragile .zshrc that lost opencode from PATH, ext4 journal recovery eating the first boot, and 71 crash-orphaned junk files quietly piling up in $HOME."
date = 2026-06-23

[taxonomies]
tags = ["wsl", "linux", "zsh", "debugging", "ext4", "infrastructure"]

[extra]
canonical = ""
+++

## The Symptom

Two annoyances showed up on the same machine — WSL Ubuntu running off an **external USB hard drive** that occasionally has a loose connection.

**Annoyance #1:** Every time I started a fresh WSL session, `opencode` wasn't found:

```bash
opencode
# zsh: command not found: opencode
```

The fix that "worked" was running this every single time:

```bash
source ~/.zshrc
```

After that, `opencode` ran fine. This never used to happen.

**Annoyance #2:** After I did a `wsl --shutdown` in Windows (or the drive lost connection) and restarted, the **first** WSL session of the day took noticeably long to come up.

Two separate problems — one shared root cause hiding underneath.

---

## The Discovery

First I confirmed the basics. My login shell *was* zsh, and `opencode` *did* exist:

```bash
getent passwd "$USER" | cut -d: -f7
# /usr/bin/zsh

ls -la ~/.opencode/bin/
# -rwxr-xr-x ... opencode
```

So the binary was there and the shell was right. Then I timed how long an interactive zsh actually took to start — even with a *warm* disk:

```bash
/usr/bin/time -v zsh -i -c 'true' 2>&1 | grep "wall clock"
# Elapsed (wall clock) time: 0:02.70
```

**2.7 seconds** just to open a shell. On a cold external disk, that balloons. So I profiled it with zsh's built-in profiler:

```bash
zsh -i -c 'zmodload zsh/zprof; source ~/.zshrc >/dev/null 2>&1; zprof | head'
```

```
num  calls   time        self       name
 1)    2    956.59ms   478.29ms     nvm
 2)    2    618.70ms   309.35ms     compdump
 3)   24    439.80ms    18.33ms     _omz_source
 ...
 6)    1   1115.05ms   ...          nvm_auto
```

`nvm` alone was eating **~1.1 seconds** of disk reads on every startup. `compinit`/`compdump` added another ~1 second. All of it reading hundreds of small files off a slow, sometimes-flaky disk.

Then the real "aha" — I checked the kernel log:

```bash
dmesg | grep -iE "ext4|recovery|orphan"
```

```
EXT4-fs (sdd): 1 orphan inode deleted
EXT4-fs (sdd): recovery complete
EXT4-fs (sdd): mounted filesystem ... r/w with ordered data mode.
```

The root filesystem (`/dev/sdd`, the external HDD) had to **replay its journal and recover an orphaned inode** before it could even mount read-write — and that happened ~19 seconds into boot.

---

## The Root Cause

### Why `opencode` kept vanishing from PATH

My `.zshrc` exported `opencode`'s directory near the very **bottom** of the file:

```bash
# ...line 202 of ~/.zshrc...
export PATH=/home/ultimatum/.opencode/bin:$PATH
```

That line sits *after* all the slow, disk-heavy work (`nvm`, `compinit`, `asdf`, plugin sourcing). On a flaky external disk, `.zshrc` runs slowly — and if the connection hiccups mid-load, zsh never reaches the bottom of the file. The shell comes up "working" (the prompt appears) but the last PATH exports never ran.

Re-running `source ~/.zshrc` once the disk had settled simply finished the job. The file was never broken — it just wasn't *finishing*.

### Why the first boot was slow

This one was textbook ext4. When a disk is pulled or disconnected mid-write, the filesystem is left in an inconsistent state. On the next mount, ext4 **replays its journal** to recover. Because my drive sometimes loses connection (and because I don't always shut WSL down cleanly), nearly every cold start triggered that recovery pass — hence the slow first boot. It's inherent to unclean shutdowns, not a misconfiguration.

### The junk files nobody asked for

My `.zshrc` writes a small per-session file to remember the last directory:

```bash
export WSL_LAST_DIR_FILE="$HOME/.wsl_last_dir_$$"   # $$ = PID
```

On a *clean* exit these get cleaned up. But on an abrupt crash, they're orphaned — and the old cleanup only deleted files **older than 2 days**. So they accumulated. I found **71 stale tracker files** sitting in `$HOME`:

```bash
ls ~/.wsl_last_dir_* | wc -l    # 32 (dead sessions)
ls ~/.last_dir*      | wc -l    # 39 (an obsolete July-2025 mechanism)
```

---

## The Fix

### Step 1: Make critical tools survive an interrupted load

Move `opencode` (and `bun`) onto PATH at the **top** of `~/.zshrc`, before anything slow runs — so even a half-loaded `.zshrc` still has them:

```bash
# Set EARLY so a slow/flaky external-disk load can't strip these from PATH.
export PATH=$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH
```

### Step 2: Lazy-load nvm (the biggest win)

`node` and `npm` already resolve through symlinks in `~/.local/bin`, so there's no reason to source the heavy `nvm.sh` on every startup. Load it only when `nvm` is actually called:

```bash
export NVM_DIR="$HOME/.nvm"
nvm() {
  unset -f nvm
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
  nvm "$@"
}
```

That reclaims ~1.1s of disk I/O from every single shell.

### Step 3: Cache compinit

The completion system runs a full security audit on every start. Do it at most **once per day**:

```bash
autoload -Uz compinit
if [[ -n ~/.zcompdump(#qNmh-24) ]]; then
  compinit -C   # dump is fresh (<24h): skip the slow security audit
else
  compinit      # regenerate + audit at most once per day
fi
```

### Step 4: Clean up crash-orphaned files automatically

Teach the cleanup function to remove session files whose **PID is no longer running** — not just old ones:

```bash
cleanup_wsl_dirs() {
  local f pid
  for f in "$HOME"/.wsl_last_dir_<->; do
    [[ -e "$f" ]] || continue
    pid=${f##*_}
    kill -0 "$pid" 2>/dev/null || rm -f "$f" 2>/dev/null
  done
  find "$HOME" -maxdepth 1 -name ".wsl_last_dir_*" -type f -mtime +2 -delete 2>/dev/null
}
```

Then I swept out the existing mess (71 files → 5: only live sessions plus the shared file).

### Step 5: Stop creating the recovery in the first place

The slow boot is a *consequence* of unclean unmounts. The real fix lives in the habit, not the config:

- **Always `wsl --shutdown` in Windows before unplugging the drive.** This flushes the ext4 journal so the next mount skips recovery entirely.
- Treat the loose connection as the actual bug — a flaky cable mid-write risks far more than a slow boot. A stable port/cable (or moving the distro to internal storage) is the durable fix.

---

## The Result

Shell startup dropped from **~2.7s to ~0.7s** on a warm disk — and proportionally far more on a cold one, since the worst offenders were exactly the disk-heavy steps:

```bash
/usr/bin/time -v zsh -i -c 'true' 2>&1 | grep "wall clock"
# Elapsed (wall clock) time: 0:00.72
```

`opencode` now resolves from the first prompt, `node`/`npm`/`nvm` all still work, and `$HOME` stays tidy on its own.

---

## The Lesson

Two takeaways, both about **fragile environments**:

1. **Order matters when your config can be interrupted.** Anything you *must* have — PATH entries for your daily tools — belongs at the top of your shell rc, before slow or failure-prone work. Don't bury essentials behind a second of disk I/O on a disk that might blink.
2. **An unclean unmount is never free.** Journaling filesystems pay for it with a recovery pass on the next boot, and any process that writes per-session state will leak files when it's killed instead of exited. Build the cleanup into startup, and cultivate the habit of shutting down cleanly.

---

## Commands Reference

```bash
# Confirm your login shell
getent passwd "$USER" | cut -d: -f7

# Time an interactive shell startup
/usr/bin/time -v zsh -i -c 'true' 2>&1 | grep "wall clock"

# Profile what's slow in zsh startup
zsh -i -c 'zmodload zsh/zprof; source ~/.zshrc >/dev/null 2>&1; zprof | head'

# Check for ext4 journal recovery (the slow-first-boot tell)
dmesg | grep -iE "ext4|recovery|orphan"

# Find crash-orphaned per-session files
ls ~/.wsl_last_dir_* | wc -l

# Always shut WSL down cleanly before unplugging an external disk (run in Windows)
wsl --shutdown
```
