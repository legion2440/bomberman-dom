# Bomberman DOM

A multiplayer DOM Bomberman for the 01-edu `bomberman-dom` assignment. The project builds on the previous `make-your-game` game logic and the PushOK `mini-framework`, adding a server-authoritative lobby, nickname flow, real-time WebSocket chat and synchronized 2–4 player matches.

· [Русская версия](README_RU.md)  
· [School repository](https://01.tomorrow-school.ai/git/nyestaye/bomberman-dom)  
· [01-edu subject](https://github.com/01-edu/public/tree/master/subjects/bomberman-dom)  
· Previous project: [make-your-game](https://01.tomorrow-school.ai/git/nyestaye/make-your-game)  
· Previous project: [mini-framework](https://01.tomorrow-school.ai/git/azhensio/mini-framework)

## 📋 TOC

- [🚀 Quick start](#-quick-start)
- [📝 About](#-about)
- [🎮 Game flow](#-game-flow)
- [💣 Mechanics](#-mechanics)
- [🎁 Bonus coverage](#-bonus-coverage)
- [🌐 Multiplayer and chat](#-multiplayer-and-chat)
- [⚡ Performance](#-performance)
- [🧪 Tests and verification](#-tests-and-verification)
- [📁 Project structure](#-project-structure)
- [⚠️ Notes](#️-notes)
- [🧑‍💻 Authors](#-authors)

## 🚀 Quick start

### Requirements

- Go 1.23 or newer
- a modern browser with WebSocket, Web Worker and ES module support
- Python 3 for repository validation scripts
- Node.js 18+ for the JavaScript engine test

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

The static frontend is embedded into the Go binary, so a built binary can also be started from outside the repository directory.

## 📝 About

The mandatory game is DOM-only: no canvas, WebGL or third-party frontend framework. The UI is rendered with the repository-local PushOK framework from the previous `mini-framework` project.

The Go server owns room membership, the 4-player limit, nickname identities, lobby timing, chat and the simulation clock. The first player is the authoritative game host, but the `GameEngine` runs inside a Web Worker driven by server WebSocket ticks instead of `requestAnimationFrame`. This keeps simulation independent from whether the host tab is currently being painted.

## 🎮 Game flow

1. Enter a nickname.
2. Join the waiting lobby.
3. Chat with connected players in real time.
4. When the second player joins, a 20-second waiting window starts.
5. If four players join before that window ends, the 10-second start countdown begins immediately.
6. Otherwise, with 2–3 players, the 10-second countdown begins after the 20-second window.
7. The match starts with every player in a different corner.
8. The last player with lives remaining wins.
9. Six seconds after a finished match, the same connected clients automatically return to a fresh lobby; closing every tab is not required.

If the room falls below two players before a Classic/Ghost match starts, lobby timing is reset.

## 💣 Mechanics

- 2–4 human players in the mandatory multiplayer flow;
- 3 lives per player;
- fixed hard walls and randomized destructible blocks;
- guaranteed spawn escape corridors long enough to leave the initial `Flame 2` blast radius;
- bombs with four-directional flames and chain reactions;
- destructible blocks may reveal power-ups;
- `Bomb` increases simultaneous bomb capacity;
- `Flame` increases explosion range;
- `Speed` increases movement speed;
- players with zero lives are eliminated in Classic mode.

Controls:

- move: `WASD` or arrow keys;
- place bomb: `Space` or `Enter`.

Short bomb taps from non-host clients are latched until the next network input packet so they are not lost between 30 Hz input samples.

## 🎁 Bonus coverage

**Classic multiplayer remains the default mandatory mode.** Dedicated bonus game rules are selected explicitly on the nickname screen, while extra power-ups and death drops are also available during Classic play so they can be demonstrated without changing modes.

- **Solo / Co-op vs AI** — one to four human players fight a synchronized Bomber AI. The human side wins when the AI is defeated.
- **Extra power-ups** — Bomb Pass lets a player walk through bombs, Block Pass lets a player walk through destructible blocks, and 1UP adds one life.
- **Power-up release after death** — final death releases one owned power-up; a player with no collected power-ups releases a random one.
- **Team 2v2** — four players are split into Team A (slots 1 and 3) and Team B (slots 2 and 4). Friendly fire does not damage the other teammate, while a player's own bomb still can.
- **Ghost mode** — a player at zero lives becomes a ghost. Touching another living player restores the ghost with one life; touching a flame as a ghost eliminates that player permanently.

## 🌐 Multiplayer and chat

The browser uses one WebSocket connection for lobby events, chat, player input, server simulation ticks and authoritative state snapshots.

The server controls:

- room mode selected by the first player;
- nickname validation;
- player slots and the 4-player room cap;
- player counter;
- 20-second wait timer;
- 10-second game countdown;
- automatic post-match room reset;
- 60 Hz simulation tick delivery to the current host;
- chat fan-out;
- host identity;
- WebSocket ping/deadline handling.

The host Worker simulates the authoritative game state. Remote clients send input and interpolate visual positions between snapshots. If the host disconnects during a running match, the server ends that match instead of silently migrating authority without state ownership.

## ⚡ Performance

The game targets the subject's 60 FPS requirement.

Key choices:

- `requestAnimationFrame` is used only for visual rendering;
- the authoritative game clock is server-driven and processed in a Web Worker;
- PushOK uses keyed DOM nodes for players, bombs and flames;
- frame-level movement updates only `transform`/`opacity`;
- transforms use tile-relative percentages, so gameplay performs no `clientWidth`/layout reads;
- newly created entities stay hidden until their first transform is applied, preventing a one-frame flash at `(0, 0)`;
- detached entity references are pruned from renderer maps;
- only moving players use `will-change: transform`; static bombs/flames are not pre-promoted;
- static board tiles are not rebuilt every animation frame;
- no canvas or WebGL.

Use the browser Performance panel to verify FPS, frame drops, paint and promoted layers on the evaluator machine.

## 🧪 Tests and verification

Run all automated checks:

```bash
go test ./...
node tests/game-engine.mjs
python scripts/validate_agent_contracts.py
python scripts/check_source.py
```

Build and vet:

```bash
go vet ./...
go build ./...
```

Format check:

```bash
test -z "$(gofmt -l .)"
```

The JavaScript engine test includes repeated random-map checks that verify every starting corner has a reachable safe tile outside the player's initial bomb blast.

### Manual audit

Use at least two browser sessions and then repeat with four:

- nickname screen appears;
- lobby counter increments;
- chat reaches every connected player;
- two players trigger `20 s → 10 s → start`;
- fourth player triggers the 10-second countdown early;
- after a match finishes, connected clients return to a new lobby automatically;
- switching away from the host tab does not stop game simulation;
- every client sees the whole map;
- movement and bombs synchronize;
- bomb damage removes one of three lives;
- zero lives eliminates the player in Classic mode;
- blocks are destroyed;
- Bomb, Flame and Speed power-ups can appear;
- bonus pass/life power-ups, co-op AI, death drops, 2v2 and ghost behavior work;
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
│   │   ├── game/
│   │   │   ├── constants.js
│   │   │   ├── engine.js
│   │   │   ├── renderer.js
│   │   │   └── simulation-worker.js
│   │   ├── app.js
│   │   ├── network.js
│   │   └── views.js
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
├── tests/
│   └── game-engine.mjs
├── AGENTS.md
├── README.md
├── README_RU.md
├── go.mod
└── main.go
```

## ⚠️ Notes

- Classic multiplayer is the default mandatory flow. Co-op AI, 2v2 and Ghost rules require explicit mode selection; extra bonus power-ups and death drops can also appear in Classic.
- The browser still owns authoritative game simulation through the host Worker; the Go server owns its clock and networking, not Bomberman physics.
- Browser performance depends on the evaluator machine; use DevTools Performance for the final manual proof.

## 🧑‍💻 Authors

- Nazar Yestayev (@nyestaye)
- Azamat Zhenisov (@azhensio)
- Kuanysh Karimov (@kukarimov)
- Muhammadabdulloh Nozimjonov (@mnozimjo)
