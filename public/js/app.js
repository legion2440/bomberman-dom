import { createStore, listen, mount } from "../framework/pushok/index.js";
import { createNetwork } from "./network.js";
import { GameEngine } from "./game/engine.js";
import { SNAPSHOT_INTERVAL } from "./game/constants.js";
import { createGameRenderer } from "./game/renderer.js";
import { viewApp } from "./views.js";

const store = createStore({
  screen: "nickname",
  nicknameDraft: "",
  nickname: "",
  selfId: "",
  selfSlot: -1,
  lobbyPlayers: [],
  lobbyPhase: "waiting",
  waitRemaining: 0,
  countdownRemaining: 0,
  chatMessages: [],
  chatDraft: "",
  connectionStatus: "offline",
  error: "",
  gameState: null,
  gameRevision: 0,
  result: null,
  fps: 60,
});

const renderer = createGameRenderer();
const pressed = new Set();

let engine = null;
let isHost = false;
let lastFrame = performance.now();
let snapshotClock = 0;
let inputClock = 0;
let fpsClock = 0;
let fpsFrames = 0;

const network = createNetwork({
  onStatus(status) {
    const mapped = status === "connected" ? "online" : status === "disconnected" ? "offline" : status;
    store.setState({ connectionStatus: mapped });
  },

  onJoined(data) {
    store.setState((state) => ({
      selfId: data.id,
      selfSlot: data.slot,
      nickname: state.nicknameDraft.trim(),
      screen: "lobby",
      error: "",
    }));
  },

  onLobby(data) {
    const selfId = store.getState().selfId;
    isHost = Boolean(data.players?.find((player) => player.id === selfId)?.host);
    store.setState({
      lobbyPlayers: data.players || [],
      lobbyPhase: data.phase || "waiting",
      waitRemaining: Number(data.waitRemaining) || 0,
      countdownRemaining: Number(data.countdownRemaining) || 0,
    });
  },

  onChat(data) {
    store.setState((state) => ({
      chatMessages: [...state.chatMessages, data].slice(-100),
    }));
  },

  onInput(data) {
    if (!isHost || !engine) return;
    engine.setInput(data.clientId, data.input);
  },

  onGameStart(data) {
    const players = data.players || [];
    isHost = Boolean(players.find((player) => player.id === store.getState().selfId)?.host);
    pressed.clear();

    if (isHost) {
      engine = new GameEngine(players);
      const gameState = engine.state;
      store.setState((state) => ({
        screen: "game",
        lobbyPlayers: players,
        gameState,
        gameRevision: state.gameRevision + 1,
        result: null,
      }));
      network.send("state", engine.snapshot());
    } else {
      engine = null;
      store.setState({
        screen: "game",
        lobbyPlayers: players,
        gameState: null,
        result: null,
      });
    }
  },

  onState(data) {
    if (isHost) return;
    store.setState((state) => ({
      gameState: data,
      gameRevision: state.gameRevision + 1,
    }));
  },

  onGameOver(data) {
    pressed.clear();
    store.setState({
      screen: "finished",
      result: data,
    });
  },

  onError(message) {
    store.setState({ error: message, connectionStatus: "error" });
  },
});

const actions = {
  nicknameInput(event) {
    store.setState({ nicknameDraft: event.target.value, error: "" });
  },

  join(event) {
    event.preventDefault();
    const nickname = store.getState().nicknameDraft.trim();
    if (!nickname) {
      store.setState({ error: "Enter a nickname." });
      return;
    }

    store.setState({ connectionStatus: "connecting", error: "" });
    network.connect(nickname);
  },

  chatInput(event) {
    store.setState({ chatDraft: event.target.value });
  },

  sendChat(event) {
    event.preventDefault();
    const text = store.getState().chatDraft.trim();
    if (!text) return;
    if (network.send("chat", { text })) {
      store.setState({ chatDraft: "" });
    }
  },

  reload() {
    location.reload();
  },
};

mount({
  store,
  view: (state) => viewApp(state, actions, renderer),
  root: document.getElementById("app"),
});

listen(document, "keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (!isGameplayKey(event.code)) return;

  pressed.add(event.code);
  event.preventDefault();
});

listen(document, "keyup", (event) => {
  if (!isGameplayKey(event.code)) return;
  pressed.delete(event.code);
  event.preventDefault();
});

listen(window, "blur", () => pressed.clear());
listen(window, "resize", () => renderer.resize());

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  const state = store.getState();
  if (state.screen === "game") {
    const input = currentInput();

    if (isHost && engine) {
      engine.setInput(state.selfId, input);
      engine.update(dt);
      renderer.renderFrame(engine.state, false, dt);

      snapshotClock += dt;
      if (snapshotClock >= SNAPSHOT_INTERVAL) {
        snapshotClock %= SNAPSHOT_INTERVAL;
        store.setState((current) => ({
          gameState: engine.state,
          gameRevision: current.gameRevision + 1,
        }));
        network.send("state", engine.snapshot());
      }

      const gameOver = engine.consumeGameOver();
      if (gameOver) network.send("game_over", gameOver);
    } else {
      renderer.renderFrame(state.gameState, true, dt);
      inputClock += dt;
      if (inputClock >= 1 / 30) {
        inputClock %= 1 / 30;
        network.send("input", input);
      }
    }
  }

  fpsFrames += 1;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    const fps = Math.round(fpsFrames / fpsClock);
    fpsFrames = 0;
    fpsClock = 0;
    store.setState({ fps });
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function currentInput() {
  let x = 0;
  let y = 0;
  if (pressed.has("KeyA") || pressed.has("ArrowLeft")) x -= 1;
  if (pressed.has("KeyD") || pressed.has("ArrowRight")) x += 1;
  if (pressed.has("KeyW") || pressed.has("ArrowUp")) y -= 1;
  if (pressed.has("KeyS") || pressed.has("ArrowDown")) y += 1;

  if (x && y) {
    const length = Math.hypot(x, y);
    x /= length;
    y /= length;
  }

  return {
    x,
    y,
    bomb: pressed.has("Space") || pressed.has("Enter"),
  };
}

function isGameplayKey(code) {
  return [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "Enter",
  ].includes(code);
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || target?.isContentEditable;
}
