#!/usr/bin/env python3
"""Static source checks for the mandatory bomberman-dom acceptance surface."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        errors.append(f"missing: {rel}")
        return ""
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    app = read("public/js/app.js")
    engine = read("public/js/game/engine.js")
    worker = read("public/js/game/simulation-worker.js")
    network = read("public/js/network.js")
    views = read("public/js/views.js")
    html = read("public/index.html")
    css = read("public/styles.css")
    server = read("server/server.go")
    websocket = read("server/websocket.go")
    main_go = read("main.go")
    lobby = read("server/lobby.go")
    go_mod = read("go.mod")

    browser_source = "\n".join([app, engine, worker, network, views, html, css]).lower()

    require("canvas" not in browser_source, "canvas reference found in browser source")
    require("webgl" not in browser_source, "WebGL reference found in browser source")
    require('framework/pushok/index.js' in app, "application does not import the repository-local PushOK framework")
    require("requestanimationframe" in app.lower(), "requestAnimationFrame render loop is missing")
    require("new worker" in app.lower(), "host simulation is not delegated to a Web Worker")
    require("engine.update" in worker and 'case "tick"' in worker, "simulation worker does not own the server-driven game clock")
    require("setinterval" not in worker.lower() and "settimeout" not in worker.lower(), "simulation worker must not depend on browser timers")
    require('"tick"' in network and '"tick"' in server, "server-driven simulation tick protocol is missing")
    require("new gameengine" not in app.lower(), "GameEngine must not run on the rendering thread")
    require("new websocket" in network.lower(), "WebSocket client is missing")
    require('"chat"' in network and '"chat"' in server, "chat protocol is missing")
    require("maxplayers" in server.lower() and "= 4" in server.lower(), "server-side 4-player cap is missing")
    require("finishedgrace" in lobby.lower() and "resetfinishedifdue" in server.lower(), "post-match room reset is missing")
    require("go:embed all:public" in main_go.lower() and "http.fs" in server.lower(), "public assets are not embedded in the Go binary")
    require("setreaddeadline" in websocket.lower() and "setwritedeadline" in websocket.lower() and "writeping" in websocket.lower(), "WebSocket deadlines/ping handling are missing")

    require("20 * time.second" in lobby.lower(), "20-second lobby wait window is missing")
    require("10 * time.second" in lobby.lower(), "10-second countdown window is missing")

    for token in ("power-bomb", "power-flame", "power-speed"):
        require(token in engine, f"mandatory power-up missing from engine: {token}")
        require(token in css, f"mandatory power-up missing from CSS: {token}")

    require("lives: 3" in engine, "players do not start with 3 lives")
    for token in ("power-bomb-pass", "power-block-pass", "power-life"):
        require(token in engine, f"bonus power-up missing from engine: {token}")
        require(token in css, f"bonus power-up missing from CSS: {token}")
    require("makeCoopBot" in engine and "Bomber AI" in engine, "Solo/Co-op AI mode is missing")
    require('mode === "teams"' in engine, "Team 2v2 mode is missing")
    require('mode === "ghosts"' in engine and "reviveGhosts" in engine, "after-death ghost interaction is missing")
    require("dropPowerOnDeath" in engine, "power-up release after death is missing")
    require("spawn_safe" not in engine.lower() or "SPAWN_SAFE" in engine, "spawn-safe configuration is missing")
    renderer = read("public/js/game/renderer.js")
    require("translate3d" in renderer, "entity movement is not using translate3d")
    require("clientwidth" not in renderer.lower(), "renderer reads layout during gameplay")
    require("will-change: transform" in css, "moving players are not compositor-promoted")
    require(not re.search(r"\.entity\s*\{[^}]*will-change", css, re.S), "static entities should not be compositor-promoted")
    require("container-type: inline-size" in css and "cqi" in css, "power-up labels are not sized relative to their tiles")
    require("state.fps" not in views and "fpsclock" not in app.lower(), "display-refresh FPS must not be exposed as game FPS")
    require("actions.leave" in views and "network.disconnect()" in app and "renderer.reset()" in app, "leave-game session cleanup is missing")
    board_rules = re.findall(r"\.board\s*\{([^}]*)\}", css, re.S)
    require(board_rules and all("vh" not in rule for rule in board_rules), "board sizing must not counter-scale against browser zoom via viewport height")
    require("require (" not in go_mod and "require\n" not in go_mod, "go.mod must not add third-party dependencies")

    # Application code may use framework refs for transform/opacity animation, but should not
    # create or query application DOM nodes directly.
    direct_dom_patterns = [
        r"document\.querySelector",
        r"document\.createElement",
        r"\.appendChild\(",
        r"\.replaceChildren\(",
    ]
    app_sources = "\n".join([app, engine, worker, network, views, renderer])
    for pattern in direct_dom_patterns:
        require(not re.search(pattern, app_sources), f"direct application DOM management found: {pattern}")

    if errors:
        for error in errors:
            print(f"[ERROR] {error}")
        print(f"[FAIL] source checks: {len(errors)} issue(s)")
        return 1

    print("[OK] source checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
