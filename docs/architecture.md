# Architecture

This document is intentionally outside normal agent boot context. Read it only for cross-module or architectural work.

## Runtime split

- The Go server owns rooms, player slots, lobby timing and chat fan-out.
- The first player in a room is the authoritative game host.
- Joined clients send normalized input over WebSocket.
- The host simulates movement, bombs, flames, damage, lives and power-ups, then publishes state snapshots.
- Non-host clients interpolate visual positions between snapshots.
- PushOK owns application structure, views and event wiring; the game renderer uses framework refs for frame-level transforms so movement does not force a full VDOM patch at 60 FPS.

## Source of truth

Production code and runtime behavior have priority over this document. Protocol details are recorded in `docs/protocol.md`.
