+++
title = "Hardening a Linux Server: A Practical Journey"
description = "A real-world walkthrough of securing a production Ubuntu server — SSH hardening, fail2ban, firewalls, kernel tuning, Docker security, and the gaps I'm still fixing."
date = 2026-06-15
updated = 2026-06-15

[extra]
canonical = ""
+++

## Introduction

I recently took over a production Ubuntu server running multiple services — Incus containers, Docker, a Matrix homeserver, Gitea, and custom AI agent infrastructure. Before adding anything new, I needed to understand and improve its security posture.

This is the story of what I found, what I hardened, and what I'm still fixing. It's not a theoretical checklist — it's what one real server looked like and what I did about it.

---

## Step 1: SSH Hardening

The door to your server. If this isn't locked properly, nothing else matters.

### What I found

The server had a dedicated `99-hardening.conf` in `/etc/ssh/sshd_config.d/` with most of the right ideas but a few critical gaps:

```
# Bad — root can SSH with a password
PermitRootLogin yes
PasswordAuthentication yes

# Good — rate limiting
MaxAuthTries 3
MaxSessions 2
LoginGraceTime 30

# Good — logging
LogLevel VERBOSE

# Good — disable forwarding
AllowTcpForwarding no
X11Forwarding no
AllowAgentForwarding no
```

The two problems: **root login was enabled**, and **password authentication was enabled**. On a server exposed to the internet, this is how brute force attacks succeed.

### What I changed

```bash
# Disable password authentication entirely
PasswordAuthentication no

# Root can only log in with a key
PermitRootLogin prohibit-password
```

This means only users with an SSH key can log in, and only non-root users (or root with a key). Brute force attacks become irrelevant.

### Other SSH hardening already in place

The config already had good defaults worth noting:

- `MaxAuthTries 3` — kick after 3 failed attempts
- `MaxSessions 2` — limit concurrent sessions
- `ClientAliveInterval 300` + `ClientAliveCountMax 2` — drop dead connections after 10 minutes
- `AllowUsers vasil root` — whitelist which users can SSH
- `LogLevel VERBOSE` — log fingerprints and key details
- All forwarding disabled — no port forwarding, X11, or agent forwarding

---

## Step 2: Fail2ban — Your First Line of Defense

### What was already there

The server had fail2ban installed and configured. The SSH jail was custom-tuned:

```
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400    # 24 hours
```

Three failed attempts and you're banned for a full day. This pairs perfectly with `MaxAuthTries 3` in SSH — after three auth failures the connection drops, and three more and you're banned from even trying again.

There was also a global whitelist for my IP:

```
ignoreip = 127.0.0.1/8 ::1 <my-public-ip>
```

### Verification

Check active bans:

```bash
sudo fail2ban-client status sshd
```

---

## Step 3: Firewall — The Missing Piece

### What I found

**No firewall was active.** `ufw status` returned "inactive". There were no iptables rules either. The server was fully exposed on every port its services were listening on.

This was the biggest gap. With no firewall:

- Any service that binds to `0.0.0.0` is accessible from anywhere
- There's no rate limiting at the network level
- Port scans reveal every open service

### What I set up

```bash
# Default deny incoming, allow outgoing
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow ssh

# Allow specific service ports
ufw allow 80/tcp    # HTTP (caddy reverse proxy)
ufw allow 443/tcp   # HTTPS

# Enable
ufw enable
```

For Docker, there's a subtlety: Docker's iptables rules bypass UFW by default. I added a rule to UFW's `before.rules` to handle Docker traffic properly, or configured Docker to use a dedicated network namespace.

---

## Step 4: Kernel Hardening

### What was already good

The server had sensible `sysctl` settings out of the box on Ubuntu:

| Parameter | Value | What it does |
|---|---|---|
| `net.ipv4.tcp_syncookies` | 1 | Prevents SYN flood attacks |
| `net.ipv4.conf.all.rp_filter` | 1 | Reverse path filtering (anti-spoofing) |
| `net.ipv4.icmp_echo_ignore_broadcasts` | 1 | Ignore ICMP broadcast pings (smurf attack) |
| `net.ipv4.conf.all.accept_source_route` | 0 | Disable IP source routing |

### What I added

```bash
# Protect against SYN flood attacks (already on, but explicit)
net.ipv4.tcp_syncookies = 1

# Ignore ICMP redirects (prevents MITM via bogus redirects)
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# Ignore source-routed packets (already on)
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Protect against time-wait assassination
net.ipv4.tcp_rfc1337 = 1

# Increase the local port range for outgoing connections
net.ipv4.ip_local_port_range = 32768 60999
```

Applied with:

```bash
sudo sysctl -p /etc/sysctl.d/99-hardening.conf
```

---

## Step 5: Docker Security

### What was good

Docker was running with AppArmor and seccomp security profiles enabled by default:

```
Security Options:
  apparmor
  seccomp
```

These restrict what syscalls containers can make, even if the container is compromised.

### What was missing

Several containers had **no memory limits**. An unlimited container could consume all host RAM and trigger the OOM killer, potentially killing critical services. This was a resource availability issue as much as a security one.

```bash
docker update --memory 256M --memory-swap 512M gitea-server
docker update --memory 256M --memory-swap 512M gitea-db
docker update --memory 128M --memory-swap 256M caddy-proxy
```

Matrix services already had sensible limits (synapse: 2 GB, postgres: 512 MB, element-web: 256 MB).

---

## Step 6: Automatic Updates

### What was already there

```bash
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
```

Security updates are downloaded and installed automatically every day. This is critical for a production server — the window between a CVE disclosure and exploitation can be hours.

---

## Step 7: What I'm Still Fixing

Hardening is never done. Here's what's still on my list:

### Password policies

```
PASS_MAX_DAYS  99999
PASS_MIN_DAYS  0
PASS_WARN_AGE  7
```

Passwords never expire. I need to set a reasonable rotation policy:

```bash
# In /etc/login.defs
PASS_MAX_DAYS 90
PASS_MIN_DAYS 7
PASS_WARN_AGE 14
```

### AppArmor profiles

Docker uses AppArmor, but the host itself has no custom AppArmor profiles. For a server running multiple services, enforcing AppArmor on critical processes (like postgres, caddy, and the Incus daemon) adds defense in depth.

### Two-factor authentication

Adding TOTP (via `libpam-google-authenticator`) to SSH would eliminate the remaining risk from stolen SSH keys. This is the next significant hardening step.

### Auditd rules

`auditd` is running with default rules. Custom rules to monitor:

- `sudo` usage
- Changes to `/etc/passwd`, `/etc/shadow`, `/etc/ssh/`
- File accesses on sensitive data paths

---

## Lessons Learned

1. **Defaults are not enough.** Ubuntu ships with sensible defaults, but a production server needs explicit hardening. UFW is not active by default. SSH allows password auth by default.

2. **Hardening configs can conflict.** The `99-hardening.conf` had both `PasswordAuthentication no` and `PasswordAuthentication yes` — the last one wins, so the intended hardening was silently disabled. Always verify your configs.

3. **Layer your defenses.** SSH hardening stops brute force. Fail2ban adds a network-level block. A firewall prevents access to unexpected ports. Auditd logs what gets through. Each layer covers gaps in the others.

4. **Automate security updates.** Unattended-upgrades with automatic reboots mean critical patches are applied before you've even read the CVE.

5. **Resource limits are security.** An unconstrained container that consumes all memory isn't just an availability problem — it can be used for DoS attacks, crypto mining, or to mask malicious activity by starving audit processes.

---

## Commands Reference

```bash
# SSH hardening verification
sshd -T | grep -E 'passwordauthentication|permitrootlogin'

# Check fail2ban status
sudo fail2ban-client status sshd

# Check firewall
sudo ufw status verbose

# Check kernel parameters
sysctl net.ipv4.tcp_syncookies net.ipv4.conf.all.rp_filter

# Check Docker security
docker info | grep -i security

# Check auto-updates
cat /etc/apt/apt.conf.d/20auto-upgrades

# Check password policy
grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS' /etc/login.defs

# Apply kernel hardening
sudo sysctl -p /etc/sysctl.d/99-hardening.conf

# Check SSH config for conflicts
grep -rn 'PasswordAuthentication' /etc/ssh/
```
