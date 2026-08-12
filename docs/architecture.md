# Architecture

This document is intentionally outside normal agent boot context. Read it only for cross-module or architectural work.

## Runtime split

- The Go server owns room mode, player slots, lobby timing, post-match reset, chat fan-out and the 60 Hz simulation clock.
- The first player in a room is the authoritative game host.
- The host runs `GameEngine` inside a module Web Worker; server `tick` messages advance the simulation independently from `requestAnimationFrame` and browser painting.
- Joined clients send normalized input over WebSocket. Short remote bomb taps are latched until transmitted.
- The host Worker simulates movement, bombs, flames, damage, lives, power-ups and optional AI/teams/ghost rules, then publishes state snapshots through the host page.
- Non-host clients interpolate visual positions between snapshots.
- PushOK owns application structure, views and event wiring. The frame renderer uses framework refs only for transform/opacity updates; it performs no layout reads during gameplay.
- Static frontend assets are embedded in the Go binary.

## Match lifecycle

- Classic/Ghost: 2 players start a 20-second collection window, followed by a 10-second countdown; player 4 starts the countdown immediately.
- Co-op: one player is enough to start a 10-second countdown.
- Teams: all four players are required before the 10-second countdown.
- A finished room remains visible for a 6-second grace period and then resets automatically while preserving connected clients.
- If the active host disconnects during a match, the server finishes the match rather than migrating authority without a guaranteed current simulation state.

## Source of truth

Production code and runtime behavior have priority over this document. Protocol details are recorded in `docs/protocol.md`.
