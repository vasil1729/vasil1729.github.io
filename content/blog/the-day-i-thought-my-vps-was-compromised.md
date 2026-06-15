+++
title = "The Day I Thought My VPS Was Compromised"
description = "SSH stopped working. Telegram revoked my bot token. My AI assistant froze. It looked like an attack. The logs told a different story."
date = 2026-06-15
updated = 2026-06-15

[extra]
canonical = ""
+++

## The First Sign

It started with a simple SSH error:

```
Received disconnect from server:
Too many authentication failures
```

I tried again. Same error. Then nothing — the connection timed out entirely.

A few minutes later, Telegram sent a security alert: active sessions had been reset, bot tokens had been revoked, and my newly-created AI assistant bot had been frozen.

At first glance, this looked like a compromise:

* SSH access stopped working.
* Telegram revoked bot credentials.
* My AI assistant stopped responding.

Three events, all at the same time. The natural conclusion: someone had broken in and was shutting things down.

---

## Phase 1: Recovering SSH Access

The first clue came from verbose SSH logs. OpenSSH showed repeated authentication attempts using multiple keys before eventually falling back to password authentication. Fail2Ban interpreted the repeated failures as suspicious activity and banned my public IP address.

The server itself was healthy. I had simply locked myself out.

Since the VPS was hosted on Contabo, I used the VNC console to regain access and inspect Fail2Ban. The ban list confirmed it — my own IP had been blocked.

```bash
sudo fail2ban-client status sshd
```

After unbanning the address and adding it to the Fail2Ban whitelist, SSH access was restored.

```bash
sudo fail2ban-client set sshd unbanip <my-ip>
echo "ignoreip = 127.0.0.1/8 ::1 <my-ip>" >> /etc/fail2ban/jail.local
```

---

## Phase 2: Investigating a Possible Compromise

Now that I could access the machine again, I needed to determine whether someone had actually gained access.

### What I checked

```bash
# Recent logins
last -10

# SSH auth log
grep -E 'Accepted|Failed' /var/log/auth.log

# Running services
ss -tlnp

# User accounts
cat /etc/passwd | grep /home

# Authorized keys
cat ~/.ssh/authorized_keys

# Listening ports
netstat -tulpn | grep LISTEN
```

### What I found

Every successful login originated from my own IP addresses and used my known ED25519 SSH key. No unknown accounts existed. No suspicious services were running. No unauthorized SSH keys had been added.

The evidence did not support a server compromise.

---

## Phase 3: The Telegram Mystery

The Telegram warning was more concerning than the SSH issue. It said sessions had been reset and bot tokens had been revoked.

Inside the container running my Hermes AI agent, I checked the service logs:

```bash
journalctl -u hermes-gateway.service --no-pager -n 50 | grep -i token
```

The answer appeared immediately:

```
telegram.error.InvalidToken: The token `8810345671:***` was rejected by the server.
```

Telegram had revoked the bot token. The Hermes service itself was functioning normally — it just could no longer authenticate.

Looking at the service status told an even more interesting story:

```
● hermes-gateway.service - Hermes Agent Gateway
     Active: active (running) since Sun 2026-06-14 18:07:00 UTC
     Memory: 619.8M (peak: 1.8G)
```

The service had been running for 18+ hours, consuming 620 MB of RAM with a peak of **1.8 GB** — all the while failing to connect to Telegram every 5 minutes and restarting its connection loop. The error was logged repeatedly:

```
Jun 15 09:01:35 hermes-prod python[467463]: telegram.error.InvalidToken: The token `8810345671:***` was rejected by the server.
Jun 15 13:02:31 hermes-prod python[467463]: telegram.error.InvalidToken: Unauthorized
```

The service was in a tight reconnect loop, burning CPU and memory, unable to do anything useful.

---

## Phase 4: Correlation Is Not Causation

The most interesting lesson from the incident was that two unrelated failures happened almost simultaneously.

**Failure #1:** Fail2Ban banned my IP after repeated SSH authentication attempts. This was my fault — my SSH client was cycling through multiple keys aggressively, triggering the rate limit.

**Failure #2:** Telegram's security systems froze a recently-created bot and revoked its token. This was unrelated to any server activity — it was Telegram's automated fraud detection flagging the new bot as suspicious.

The timing created the illusion of a single incident. The logs told a different story.

---

## Phase 5: What This Server Taught Me

While investigating, I discovered several security gaps that were unrelated to the incident but worth fixing:

### SSH Hardening Gaps

The server had a dedicated SSH hardening config at `/etc/ssh/sshd_config.d/99-hardening.conf` with good intent but conflicting settings:

```
PasswordAuthentication yes    # Should be: no
PermitRootLogin yes           # Should be: prohibit-password
```

Whoever wrote the config added both `PasswordAuthentication no` and `PasswordAuthentication yes` — the last value wins, so passwords were still accepted despite the hardening intent.

### No Active Firewall

`ufw status` returned "inactive". There were no iptables rules either. The server was fully exposed on every port its services were listening on. This was fixed by:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### Memory Leaks from Orphaned Processes

During the investigation, I discovered **10 orphaned `opencode` processes** each consuming 400-600 MB of RAM — a separate story covered in detail [here](/blog/ai-process-orphan-debugging/).

### The Hermes Service Memory Bloat

The hermes-gateway service peaked at 1.8 GB RAM while stuck in a Telegram reconnection loop. This was a significant resource drain. The service was disconnected, the bot token was invalid, yet the system kept retrying indefinitely.

---

## Lessons Learned

1. **Always check logs before assuming compromise.** Every piece of evidence I found pointed away from an intrusion. The story only looked scary before I looked at the data.

2. **Keep alternative access paths available.** The VNC console saved me when SSH was blocked. Without it, I'd have needed a datacenter visit or a support ticket.

3. **Whitelist trusted IPs in Fail2Ban.** A single `ignoreip` directive prevents you from locking yourself out.

4. **Distinguish between security events and actual intrusions.** A revoked bot token is an application concern, not a sign that someone has root on your machine.

5. **Check for conflicting configs.** Both `PasswordAuthentication no` and `PasswordAuthentication yes` in the same config file — the intended hardening was silently disabled.

6. **Correlation is not causation.** Two systems failing at the same time does not mean one caused the other. Sometimes it's just a coincidence.

7. **Hercules services need monitoring.** A service in a reconnection loop can silently consume over a gigabyte of memory while doing nothing useful. Set memory limits and health checks.

---

## The Real Fixes Applied

| Issue | Fix |
|---|---|
| SSH lockout | Added IP to Fail2Ban whitelist |
| Telegram token revoked | Need to recreate bot and get new token |
| No firewall | Enabled UFW with default-deny |
| Conflicting SSH config | Fixed `PasswordAuthentication` to `no`, `PermitRootLogin` to `prohibit-password` |
| Orphaned processes | Killed 10 stale opencode instances, added `exec` alias, `.bash_logout` cleanup |
| Hermes memory leak | Service needs token fix or disabling until new bot is created |
| Container memory limits | Set caps on Incus and Docker containers |

---

## Commands Reference

```bash
# Check Fail2Ban status
sudo fail2ban-client status sshd

# Unban yourself
sudo fail2ban-client set sshd unbanip <your-ip>

# Check recent logins
last -10

# Check service logs
journalctl -u <service-name> --no-pager -n 50 | grep -i error

# Verify SSH config doesn't have conflicts
grep -rn 'PasswordAuthentication' /etc/ssh/

# Check firewall
sudo ufw status verbose

# Find memory-hungry services
ps aux --sort=-%mem | head -10
```
