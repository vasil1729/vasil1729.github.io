+++
title = "Telegram MTProto Proxy"
description = "Running an MTProto proxy on a VPS so I can connect when Telegram is blocked."
date = 2026-06-18

[taxonomies]
tags = ["telegram", "docker", "proxy", "infrastructure"]
+++

Telegram uses its own transport protocol called MTProto, not HTTPS or WebSockets. The client opens a persistent TCP connection to Telegram's data centers, typically on ports 443, 80, or a handful of other standard ports. When a network or ISP blocks these — either by IP range blacklisting or Deep Packet Inspection (DPI) that identifies the MTProto handshake — the client cannot connect at all.

There are a few ways around this:

- **SOCKS5 proxy** — forwards raw TCP bytes through a middleman. Works but doesn't hide the fact that you're proxying from the ISP, and SOCKS5 proxies are easily identified and blocked themselves.
- **HTTP CONNECT proxy** — similar, wrapped in HTTP. Also trivial to detect and block.
- **Tor** — Telegram supports connecting through Tor. High latency, exit nodes are frequently blocked, and it's overkill for just messaging.
- **MTProto proxy** — a lightweight forwarder that speaks MTProto on both sides. The client treats it as a transport hop; the proxy decrypts the outer layer, re-encrypts, and forwards to Telegram's DC. Because it speaks the same protocol as Telegram itself, DPI systems cannot distinguish MTProto proxy traffic from a direct Telegram connection without also blocking Telegram entirely.

Architecturally, an MTProto proxy is just a packet forwarder with a crypto wrapper. The client and proxy share a pre-shared secret (16 bytes, randomly generated). The client wraps every outgoing MTProto packet in a lightweight encrypted envelope using that secret; the proxy strips the envelope and forwards the inner MTProto payload to Telegram. Responses flow back the same way. The proxy never sees the message content — MTProto's end-to-end encryption (layer 2 of the MTProto protocol) is between the client and Telegram's servers, not terminated at the proxy.

The attack surface is minimal. The proxy has no state, no session tracking, no persistent storage. It keeps a connection map in memory (client endpoint → Telegram DC connection) and nothing else. If the container crashes, the map is lost and clients reconnect within seconds. There is nothing to log, no database to rotate, no credentials beyond the static secret.

The primary use case is networks where Telegram is actively blocked. A random port like 8448 behind a static IP is easy to keep unblocked because it's not a known Telegram port and the traffic pattern is indistinguishable from any other encrypted TCP stream at the packet level. Sharing is done via a `tg://proxy?server=<ip>&port=<port>&secret=<hex>` link that Telegram clients parse natively — tap it and the proxy is configured.

Compared to other methods:

| Method | Detectable as proxy | Requires extra software | Latency impact | Server resources |
|---|---|---|---|---|
| Direct | N/A | None | None | None |
| SOCKS5 | Yes | Client config | Low | Moderate |
| HTTP CONNECT | Yes | Client config | Low | Moderate |
| Tor | No | Tor bundle | High | High |
| MTProto proxy | No | Built into Telegram | Negligible (1 hop) | Minimal |

The MTProto proxy is the best option specifically for Telegram because it requires no client-side software beyond Telegram itself, adds negligible latency, and resists DPI by using the same protocol as the service it's proxying. The tradeoff is that it only works for Telegram — it's not a general-purpose proxy.

I run one in a Docker container on a VPS, mapped to port 8448:

```yaml
services:
  mtproxy:
    image: telegrammessenger/proxy:latest
    ports:
      - "8448:443"
    environment:
      - SECRET=ff74976b51f831a5931fb629cdc91a2e
    volumes:
      - proxy-config:/data

volumes:
  proxy-config:
```

The secret is generated once with `head -c 16 /dev/urandom | xxd -ps`. The connection link is `tg://proxy?server=<vps-ip>&port=8448&secret=<secret>`. It has been running for months without a single restart or config change.
