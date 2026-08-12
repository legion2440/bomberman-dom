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
    network = read("public/js/network.js")
    views = read("public/js/views.js")
    html = read("public/index.html")
    css = read("public/styles.css")
    server = read("server/server.go")
    lobby = read("server/lobby.go")
    go_mod = read("go.mod")

    browser_source = "\n".join([app, engine, network, views, html, css]).lower()

    require("canvas" not in browser_source, "canvas reference found in browser source")
    require("webgl" not in browser_source, "WebGL reference found in browser source")
    require('framework/pushok/index.js' in app, "application does not import the repository-local PushOK framework")
    require("requestanimationframe" in app.lower(), "requestAnimationFrame loop is missing")
    require("new websocket" in network.lower(), "WebSocket client is missing")
    require('"chat"' in network and '"chat"' in server, "chat protocol is missing")
    require("maxplayers" in server.lower() and "= 4" in server.lower(), "server-side 4-player cap is missing")

    require("20 * time.second" in lobby.lower(), "20-second lobby wait window is missing")
    require("10 * time.second" in lobby.lower(), "10-second countdown window is missing")

    for token in ("power-bomb", "power-flame", "power-speed"):
        require(token in engine, f"mandatory power-up missing from engine: {token}")
        require(token in css, f"mandatory power-up missing from CSS: {token}")

    require("lives: 3" in engine, "players do not start with 3 lives")
    require("spawn_safe" not in engine.lower() or "SPAWN_SAFE" in engine, "spawn-safe configuration is missing")
    require("translate3d" in read("public/js/game/renderer.js"), "entity movement is not using translate3d")
    require("will-change: transform" in css, "moving entities are not compositor-promoted")
    require("require (" not in go_mod and "require\n" not in go_mod, "go.mod must not add third-party dependencies")

    # Application code may use framework refs for transform/opacity animation, but should not
    # create or query application DOM nodes directly.
    direct_dom_patterns = [
        r"document\.querySelector",
        r"document\.createElement",
        r"\.appendChild\(",
        r"\.replaceChildren\(",
    ]
    app_sources = "\n".join([app, engine, network, views, read("public/js/game/renderer.js")])
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
