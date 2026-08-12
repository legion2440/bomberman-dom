# WebSocket protocol

Messages use JSON objects with a `type` field and optional `data`.

## Client → server

- `join`: `{ nickname, mode }`; supported modes are `classic`, `coop`, `teams`, `ghosts`
- `chat`: `{ text }`
- `input`: `{ x, y, bomb }`
- `state`: authoritative host game snapshot
- `game_over`: `{ winnerId, winnerNickname, reason }`

## Server → client

- `joined`: client identity and assigned slot
- `lobby`: room mode, players, phase and remaining wait/countdown time
- `chat`: normalized chat message
- `input`: relayed input with sender client id
- `tick`: `{ at }`, server wall-clock timestamp in milliseconds used to advance the host simulation Worker
- `state`: host snapshot relayed to non-host clients
- `game_start`: authoritative player list and room mode for the match
- `game_over`: normalized winner payload
- `error`: user-visible protocol error

The Go server is authoritative for room capacity, lobby timing and the simulation clock. The current game host is authoritative for Bomberman state and physics, with the engine isolated in a Web Worker.

## Mode timing

- `classic`: mandatory 2–4 player `20 s wait → 10 s countdown`, with the countdown starting early when the fourth player joins.
- `ghosts`: same lobby timing as classic; ghost interaction is enabled only after the match starts.
- `coop`: one or more humans; a 10-second countdown starts when the first player joins.
- `teams`: waits for all four humans, then starts a 10-second countdown.

## Post-match reset

After `game_over`, the room enters `finished`. Six seconds later the server creates a fresh lobby clock for the clients that are still connected and broadcasts a new `lobby` state. Clients return from the result overlay without reloading the page.
