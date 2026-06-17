+++
title = "The Telegram Proxy That Wasn't Supposed to Exist"
description = "How I ended up running an MTProto proxy on my VPS because sometimes the internet just stops working."
date = 2026-06-18

[taxonomies]
tags = ["telegram", "docker", "proxy", "infrastructure"]
+++

It started with a disappearing chat. I was on a trip, Telegram was the only way my team reached me, and at some point between one train station and the next, messages just stopped arriving. Not the kind of silence where nobody's talking. The kind where the app spins, then gives you that defeated "connecting..." banner at the top. Telegram was blocked on that network.

I solved it the same way everyone does — found a public MTProto proxy, pasted the link into Telegram, and was back online in ten seconds. But the experience left a bad taste. That proxy could disappear tomorrow. It could be logging everything. It's someone else's server, someone else's uptime, someone else's trust. And once you've used a Telegram proxy, your connection depends on that random person remembering to renew their VPS.

A month later I was setting up a new server for an unrelated project — a WireGuard VPN, actually — and I realized the same box had spare capacity and a static IP. That's the moment the Telegram MTProto proxy was born. Not because I needed it right then. Because I wanted it waiting for the next time I did.

The setup was comically simple: a single `docker compose up -d` with the official `telegrammessenger/proxy` image. Generate a 16-byte hex secret from `/dev/urandom`, map port 8448 to the container's 443, and you're done. I shared the connection link with three people I trust, and it's been running ever since, untouched. No config changes, no restarts, no maintenance. It doesn't log. It doesn't know who connects. It just sits there on port 8448, silently proxying bytes for the four people who have the secret.

I don't think about it most days. But every now and then I'm on a train, Telegram spins, I remember the `tg://proxy?server=...` link in my notes, paste it in, and messages start flooding in again.
