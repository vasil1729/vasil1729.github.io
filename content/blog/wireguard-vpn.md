+++
title = "Self-Hosted WireGuard VPN"
description = "Running a WireGuard VPN server in Docker on a VPS for personal use."
date = 2026-06-18

[taxonomies]
tags = ["wireguard", "vpn", "docker", "privacy"]

[extra]
+++

Most VPN protocols you've heard of — OpenVPN, IPsec, L2TP — were designed in the 1990s and early 2000s. They run in userspace, make dozens of context switches per packet, and rely on complex handshake state machines with sprawling codebases. OpenVPN alone is over 600,000 lines of code. IPsec has four separate protocol specifications, each with multiple modes and options that may or may not be implemented by any given peer.

WireGuard was designed from first principles in 2015 by Jason A. Donenfeld. It lives entirely in the Linux kernel (since 5.6) as a virtual network interface — you create a `wg0` device and configure it with a single `wg` command. There is no daemon. There is no userspace component at runtime. The entire codebase is about 4,000 lines. The crypto is fixed to Curve25519, BLAKE2s, ChaCha20, and Poly1305 — no cipher negotiation, no versioning, nothing to misconfigure.

Architecturally, WireGuard treats each peer as a cryptographic identity. Every interface has a private key; every peer has a public key. When a packet leaves the interface, the kernel encrypts and encapsulates it to the peer's endpoint IP in a single operation. When a packet arrives, the kernel strips the UDP header, authenticates it by the source public key, decrypts it, and hands it to the network stack. This all happens in interrupt context — there is no scheduling delay, no buffer copy between kernel and userspace.

The VPN market has three broad categories:

- **Commercial providers (NordVPN, Mullvad, ExpressVPN)** — consumer products with apps, servers in multiple countries, and varying logging policies. You don't control the server and you trust their promises about what they do or don't log.
- **Enterprise VPNs (OpenVPN, IPsec, WireGuard in enterprise deployments)** — used for site-to-site and remote access. Complex to configure, often tied to proprietary management consoles.
- **Self-hosted WireGuard** — you run the server on hardware you control. No logs, no third-party dependency, no app to install (clients are built into Linux, macOS, Android, iOS, and Windows). It's the simplest VPN protocol to deploy because the configuration is just a list of public keys and allowed IPs.

I run a self-hosted WireGuard server in a Docker container on a VPS. The setup:

```yaml
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    cap_add: [NET_ADMIN, SYS_MODULE]
    environment:
      - SERVERURL=<vps-ip>
      - SERVERPORT=51820
      - PEERS=laptop,phone
      - PEERDNS=1.1.1.1
      - ALLOWEDIPS=0.0.0.0/0
    ports:
      - 51820:51820/udp
    volumes:
      - ./config:/config
      - /lib/modules:/lib/modules
```

The container generates keys and configuration for each peer automatically, saved to `./config/peer_<name>/`. For mobile clients it also outputs a QR code PNG. I imported the laptop config as a file and scanned the QR code from my phone.

A full-tunnel setup routes all traffic through the VPS. The container writes config and keys to `./config/` and nothing else.
