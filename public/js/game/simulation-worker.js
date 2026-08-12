import { SNAPSHOT_INTERVAL } from "./constants.js";
import { GameEngine } from "./engine.js";

const FIXED_STEP = 1 / 60;
const MAX_CATCH_UP = 1;

let engine = null;
let lastServerTime = 0;
let accumulator = 0;
let snapshotClock = 0;

self.addEventListener("message", (event) => {
  const message = event.data || {};

  switch (message.type) {
    case "start":
      engine = new GameEngine(message.players || [], { mode: message.mode || "classic" });
      lastServerTime = 0;
      accumulator = 0;
      snapshotClock = 0;
      publishFrame(true);
      break;
    case "input":
      engine?.setInput(message.playerId, message.input);
      break;
    case "tick":
      advanceTo(Number(message.at) || 0);
      break;
    case "stop":
      engine = null;
      lastServerTime = 0;
      accumulator = 0;
      snapshotClock = 0;
      break;
  }
});

function advanceTo(serverTime) {
  if (!engine || !engine.state.running || !serverTime) return;

  const elapsed = lastServerTime
    ? Math.min(MAX_CATCH_UP, Math.max(0, (serverTime - lastServerTime) / 1000))
    : FIXED_STEP;
  lastServerTime = serverTime;
  accumulator += elapsed;
  snapshotClock += elapsed;

  let stepped = false;
  let steps = 0;
  const maxSteps = Math.ceil(MAX_CATCH_UP / FIXED_STEP);
  while (accumulator >= FIXED_STEP && steps < maxSteps) {
    engine.update(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
    stepped = true;
  }
  if (steps === maxSteps && accumulator >= FIXED_STEP) accumulator = 0;

  if (stepped) {
    const shouldSnapshot = snapshotClock >= SNAPSHOT_INTERVAL;
    if (shouldSnapshot) snapshotClock %= SNAPSHOT_INTERVAL;
    publishFrame(shouldSnapshot);
  }

  const gameOver = engine.consumeGameOver();
  if (gameOver) {
    publishFrame(true);
    self.postMessage({ type: "game_over", data: gameOver });
  }
}

function publishFrame(snapshot) {
  if (!engine) return;
  self.postMessage({
    type: "frame",
    state: engine.snapshot(),
    snapshot,
  });
}
