# WebSocket protocol

Messages use JSON objects with a `type` field and optional `data`.

## Client → server

- `join`: `{ nickname, mode }`; supported modes are `classic`, `coop`, `teams`, `ghosts`
- `chat`: `{ text }`
- `input`: `{ x, y, bomb }`
- `state`: authoritative host game snapshot
- `game_over`: `{ winnerId, winnerNickname }`

## Server → client

- `joined`: client identity and assigned slot
- `lobby`: room mode, players, phase and remaining wait/countdown time
- `chat`: normalized chat message
- `input`: relayed input with sender client id
- `state`: host snapshot relayed to non-host clients
- `game_start`: authoritative player list and room mode for the match
- `game_over`: normalized winner payload
- `error`: user-visible protocol error

The Go server is authoritative for room capacity and lobby timing. The current game host is authoritative for simulation.

## Mode timing

- `classic`: mandatory 2–4 player `20 s wait → 10 s countdown`, with the countdown starting early when the fourth player joins.
- `ghosts`: same lobby timing as classic; ghost interaction is enabled only after the match starts.
- `coop`: one or more humans; a 10-second countdown starts when the first player joins.
- `teams`: waits for all four humans, then starts a 10-second countdown.
