import { createStore, listen, mount } from "../framework/pushok/index.js";
import { createNetwork } from "./network.js";
import { createGameRenderer } from "./game/renderer.js";
import { viewApp } from "./views.js";

const store = createStore({
  screen: "nickname",
  nicknameDraft: "",
  nickname: "",
  modeDraft: "classic",
  mode: "classic",
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

let isHost = false;
let simulationWorker = null;
let hostRenderState = null;
let lastFrame = performance.now();
let inputClock = 0;
let fpsClock = 0;
let fpsFrames = 0;
let bombLatched = false;

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
    const state = store.getState();
    const phase = data.phase || "waiting";
    const selfId = state.selfId;
    isHost = Boolean(data.players?.find((player) => player.id === selfId)?.host);

    const returningToLobby = state.screen === "finished" && phase !== "finished" && phase !== "playing";
    if (returningToLobby) stopHostSimulation();

    store.setState({
      screen: returningToLobby ? "lobby" : state.screen,
      mode: data.mode || "classic",
      lobbyPlayers: data.players || [],
      lobbyPhase: phase,
      waitRemaining: Number(data.waitRemaining) || 0,
      countdownRemaining: Number(data.countdownRemaining) || 0,
      result: returningToLobby ? null : state.result,
      gameState: returningToLobby ? null : state.gameState,
      error: returningToLobby ? "" : state.error,
    });
  },

  onChat(data) {
    store.setState((state) => ({
      chatMessages: [...state.chatMessages, data].slice(-100),
    }));
  },

  onInput(data) {
    if (!isHost || !simulationWorker) return;
    simulationWorker.postMessage({ type: "input", playerId: data.clientId, input: data.input });
  },

  onTick(data) {
    if (!isHost || !simulationWorker) return;
    simulationWorker.postMessage({ type: "tick", at: Number(data.at) || 0 });
  },

  onGameStart(data) {
    const players = data.players || [];
    const mode = data.mode || store.getState().mode || "classic";
    isHost = Boolean(players.find((player) => player.id === store.getState().selfId)?.host);
    pressed.clear();
    bombLatched = false;
    hostRenderState = null;

    store.setState({
      screen: "game",
      mode,
      lobbyPlayers: players,
      gameState: null,
      result: null,
      error: "",
    });

    if (isHost) {
      startHostSimulation(players, mode);
      syncHostInput();
    } else {
      stopHostSimulation();
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
    bombLatched = false;
    stopHostSimulation();
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

  modeInput(event) {
    store.setState({ modeDraft: event.target.value, error: "" });
  },

  join(event) {
    event.preventDefault();
    const nickname = store.getState().nicknameDraft.trim();
    if (!nickname) {
      store.setState({ error: "Enter a nickname." });
      return;
    }

    store.setState({ connectionStatus: "connecting", error: "" });
    network.connect(nickname, store.getState().modeDraft);
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
};

mount({
  store,
  view: (state) => viewApp(state, actions, renderer),
  root: document.getElementById("app"),
});

listen(document, "keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (!isGameplayKey(event.code)) return;

  const wasPressed = pressed.has(event.code);
  pressed.add(event.code);
  if (!wasPressed && isBombKey(event.code)) bombLatched = true;
  if (isHost) syncHostInput();
  event.preventDefault();
});

listen(document, "keyup", (event) => {
  if (!isGameplayKey(event.code)) return;
  pressed.delete(event.code);
  if (isHost) syncHostInput();
  event.preventDefault();
});

listen(window, "blur", () => {
  pressed.clear();
  bombLatched = false;
  if (isHost) syncHostInput();
});

function startHostSimulation(players, mode) {
  stopHostSimulation();
  simulationWorker = new Worker(new URL("./game/simulation-worker.js", import.meta.url), { type: "module" });
  simulationWorker.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "frame") {
      hostRenderState = message.state;
      if (message.snapshot) {
        store.setState((state) => ({
          gameState: message.state,
          gameRevision: state.gameRevision + 1,
        }));
        network.send("state", message.state);
      }
      return;
    }
    if (message.type === "game_over") {
      network.send("game_over", message.data || {});
    }
  });
  simulationWorker.postMessage({ type: "start", players, mode });
}

function stopHostSimulation() {
  if (simulationWorker) {
    simulationWorker.postMessage({ type: "stop" });
    simulationWorker.terminate();
    simulationWorker = null;
  }
  hostRenderState = null;
}

function syncHostInput() {
  const state = store.getState();
  if (!isHost || !simulationWorker || state.screen !== "game") return;
  simulationWorker.postMessage({ type: "input", playerId: state.selfId, input: currentInput() });
  bombLatched = false;
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  const state = store.getState();
  if (state.screen === "game") {
    if (isHost) {
      renderer.renderFrame(hostRenderState || state.gameState, false, dt);
    } else {
      renderer.renderFrame(state.gameState, true, dt);
      inputClock += dt;
      if (inputClock >= 1 / 30) {
        inputClock %= 1 / 30;
        const input = currentInput();
        if (network.send("input", input)) bombLatched = false;
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
    bomb: bombLatched || pressed.has("Space") || pressed.has("Enter"),
  };
}

function isBombKey(code) {
  return code === "Space" || code === "Enter";
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
