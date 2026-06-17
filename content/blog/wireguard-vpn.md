+++
title = "Running My Own WireGuard VPN in a Docker Container"
description = "Why I ditched every commercial VPN and ran WireGuard in Docker on my VPS — and why I'm never going back."
date = 2026-06-18

[taxonomies]
tags = ["wireguard", "vpn", "docker", "privacy"]
+++

I'd been paying for a commercial VPN for years. Not because I torrent — I don't. Not because I'm paranoid — well, maybe a little. But because the internet isn't a single, neutral network anymore. Some sites block certain countries. Some networks block certain sites. And some days you just don't want your ISP to know what you're reading at 2 AM.

The problem with commercial VPNs is that you're trading one surveillance problem for another. You don't know where the servers are, who runs them, or what they log. The trust model is "we promise we don't log, pinky swear." And eventually, some of them get caught logging. Or they get acquired by an ad company. Or their exit node IP gets blacklisted and you're back to square one.

I already had a VPS doing almost nothing most of the time. A Hetzner box in Germany running the AI agent I mentioned in other posts. Its CPU idles at 2%. It has a static IP. And I pay for it anyway. So one afternoon I stopped the commercial VPN subscription and deployed my own.

The `linuxserver/wireguard` Docker image is the gold standard for this. One `docker-compose.yml`, one `docker compose up -d`, and you have a fully functional WireGuard server. It generates keys automatically, outputs peer configs as QR codes, and persists everything in a `config/` directory. Peers are defined by a comma-separated list — `PEERS=laptop,phone` — and each gets a directory with its private key, public key, and a PNG you can scan on your phone.

I use it for everything now. My laptop routes all traffic through it. My phone connects when I'm on untrusted Wi-Fi. The latency is negligible — perhaps 2ms extra — and the bandwidth is whatever my Hetzner link can do. No throttling, no "premium servers" paywall, no logging dashboard that insists everything is fine. The only logs are the ones I explicitly enable to debug a connectivity issue.

The real surprise was how little I think about it. Commercial VPNs required constant attention — was the app updated, was the subscription still active, was this server faster than that one. Self-hosted WireGuard just works. `wg show` shows the tunnel is up, and I forget it exists until I need it.
