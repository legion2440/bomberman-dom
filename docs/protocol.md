# WebSocket protocol

Messages use JSON objects with a `type` field and optional `data`.

## Client → server

- `join`: `{ nickname }`
- `chat`: `{ text }`
- `input`: `{ x, y, bomb }`
- `state`: authoritative host game snapshot
- `game_over`: `{ winnerId, winnerNickname }`

## Server → client

- `joined`: client identity and assigned slot
- `lobby`: players, phase and remaining wait/countdown time
- `chat`: normalized chat message
- `input`: relayed input with sender client id
- `state`: host snapshot relayed to non-host clients
- `game_start`: authoritative player list for the match
- `game_over`: normalized winner payload
- `error`: user-visible protocol error

The Go server is authoritative for room capacity and lobby timing. The current game host is authoritative for simulation.
