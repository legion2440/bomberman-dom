# Bomberman DOM

A multiplayer DOM Bomberman for the 01-edu `bomberman-dom` assignment. The project builds on the previous `make-your-game` game logic and the PushOK `mini-framework`, adding a server-authoritative lobby, nickname flow, real-time WebSocket chat and synchronized 2–4 player matches.

· [School repository](https://01.tomorrow-school.ai/git/nyestaye/bomberman-dom)  
· [01-edu subject](https://github.com/01-edu/public/tree/master/subjects/bomberman-dom)  
· Previous project: [make-your-game](https://01.tomorrow-school.ai/git/nyestaye/make-your-game)  
· Previous project: [mini-framework](https://01.tomorrow-school.ai/git/azhensio/mini-framework)

## 📋 TOC

- [🚀 Quick start](#-quick-start)
- [📝 About](#-about)
- [🎮 Game flow](#-game-flow)
- [💣 Mechanics](#-mechanics)
- [🌐 Multiplayer and chat](#-multiplayer-and-chat)
- [⚡ Performance](#-performance)
- [🧪 Tests and verification](#-tests-and-verification)
- [📁 Project structure](#-project-structure)
- [⚠️ Notes](#️-notes)
- [🧑‍💻 Authors](#-authors)

## 🚀 Quick start

### Requirements

- Go 1.23 or newer
- a modern browser with WebSocket and ES module support
- Python 3 for repository validation scripts

### Clone

```bash
git clone https://01.tomorrow-school.ai/git/nyestaye/bomberman-dom
cd bomberman-dom
```

### Run

```bash
go run .
```

Open:

```text
http://localhost:8080
```

For extra players, open the same address in another browser/private window. Devices on the same network can use the LAN address printed by the server.

## 📝 About

The mandatory game is intentionally DOM-only: no canvas, WebGL or third-party frontend framework. The UI is rendered with the repository-local PushOK framework from the previous `mini-framework` project.

The Go server uses only the standard library. It owns room membership, the 4-player limit, nickname identities, lobby timing and chat. The first player is the authoritative game host and simulates the match for all connected clients.

## 🎮 Game flow

1. Enter a nickname.
2. Join the waiting lobby.
3. Chat with connected players in real time.
4. When the second player joins, a 20-second waiting window starts.
5. If four players join before that window ends, the 10-second start countdown begins immediately.
6. Otherwise, with 2–3 players, the 10-second countdown begins after the 20-second window.
7. The match starts with every player in a different corner.
8. The last player with lives remaining wins.

If the room falls below two players before the match starts, lobby timing is reset.

## 💣 Mechanics

- 2–4 human players;
- 3 lives per player;
- fixed hard walls and randomized destructible blocks;
- spawn-safe tiles around all four corners;
- bombs with four-directional flames;
- destructible blocks may reveal a power-up;
- `Bomb` power-up increases simultaneous bomb capacity;
- `Flame` power-up increases explosion range;
- `Speed` power-up increases movement speed;
- players with zero lives are eliminated from the match.

Controls:

- move: `WASD` or arrow keys;
- place bomb: `Space` or `Enter`.

## 🌐 Multiplayer and chat

The browser uses one WebSocket connection for lobby events, chat, player input and authoritative state snapshots.

The server controls:

- nickname validation;
- player slots and the 4-player room cap;
- player counter;
- 20-second wait timer;
- 10-second game countdown;
- chat fan-out;
- host identity.

The host controls only simulation. Remote clients send input and interpolate between authoritative snapshots for smooth motion.

## ⚡ Performance

The game targets the subject's 60 FPS requirement.

Key choices:

- one `requestAnimationFrame` loop for visual movement;
- entity DOM nodes are keyed and created by PushOK;
- frame-level movement updates only `transform`;
- static board tiles are not rebuilt every frame;
- game snapshots are sent at a lower fixed rate than rendering;
- moving entities use compositor-friendly transforms;
- no canvas or WebGL.

Use the browser Performance panel to verify FPS, frame drops, paint and promoted layers on the evaluator machine.

## 🧪 Tests and verification

Run all automated checks:

```bash
go test ./...
python scripts/validate_agent_contracts.py
python scripts/check_source.py
```

Build:

```bash
go build ./...
```

Format check:

```bash
gofmt -w .
```

### Manual audit

Use at least two browser sessions and then repeat with four:

- nickname screen appears;
- lobby counter increments;
- chat reaches every connected player;
- two players trigger `20 s → 10 s → start`;
- fourth player triggers the 10-second countdown early;
- every client sees the whole map;
- movement and bombs synchronize;
- bomb damage removes one of three lives;
- zero lives eliminates the player;
- blocks are destroyed;
- Bomb, Flame and Speed power-ups can appear;
- Performance tooling stays around 60 FPS without obvious frame drops;
- paint/layer activity remains limited during movement.

## 📁 Project structure

```text
bomberman-dom/
├── agent/
│   ├── modules/
│   ├── schemas/
│   ├── dependency-graph.json
│   ├── methodology.json
│   └── module-index.json
├── docs/
│   ├── architecture.md
│   └── protocol.md
├── public/
│   ├── framework/pushok/
│   ├── js/
│   │   └── game/
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── check_source.py
│   └── validate_agent_contracts.py
├── server/
│   ├── lobby.go
│   ├── lobby_test.go
│   ├── server.go
│   └── websocket.go
├── AGENTS.md
├── README.md
├── go.mod
└── main.go
```

## ⚠️ Notes

- The default flow is the mandatory multiplayer assignment; bonus AI modes from `make-your-game` are intentionally kept out of the core lobby.
- The host is authoritative for game simulation. If the host disconnects during a running match, the server ends that match instead of pretending another client has authoritative state it never owned.
- Browser performance depends on the evaluator machine; use DevTools Performance for the final manual proof.

## 🧑‍💻 Authors

- Nazar Yestayev (@nyestaye)
- Azamat Zhenisov (@azhensio)
- Kuanysh Karimov (@kukarimov)
- Muhammadabdulloh Nozimjonov (@mnozimjo)
