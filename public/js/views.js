import { h } from "../framework/pushok/index.js";

export function viewApp(state, actions, renderer) {
  return h(
    "main",
    { class: "shell" },
    viewHeader(state),
    state.screen === "nickname"
      ? viewNickname(state, actions)
      : state.screen === "lobby"
        ? viewLobby(state, actions)
        : viewGame(state, actions, renderer),
  );
}

function viewHeader(state) {
  return h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, h("span", { class: "brand-bomb" }), h("strong", {}, "Bomberman DOM")),
    h(
      "div",
      { class: "top-stats" },
      h("span", {}, `Players ${state.lobbyPlayers.length}/4`),
      h("span", {}, `FPS ${state.fps}`),
      h("span", { class: `connection ${state.connectionStatus}` }, state.connectionStatus),
    ),
  );
}

function viewNickname(state, actions) {
  return h(
    "section",
    { class: "card nickname-card" },
    h("div", { class: "eyebrow" }, "2–4 player multiplayer"),
    h("h1", {}, "Enter your nickname"),
    h("p", {}, "Join the lobby, chat with the other players, then fight until one bomber remains."),
    h(
      "form",
      { class: "nickname-form", on: { submit: actions.join } },
      h("input", {
        value: state.nicknameDraft,
        maxlength: "18",
        autocomplete: "nickname",
        placeholder: "Nickname",
        autofocus: true,
        on: { input: actions.nicknameInput },
      }),
      h(
        "select",
        { value: state.modeDraft, on: { change: actions.modeInput }, "aria-label": "Game mode" },
        h("option", { value: "classic" }, "Classic multiplayer"),
        h("option", { value: "coop" }, "Solo / Co-op vs AI"),
        h("option", { value: "teams" }, "Team 2v2"),
        h("option", { value: "ghosts" }, "Ghost mode"),
      ),
      h("button", { type: "submit", disabled: state.connectionStatus === "connecting" }, "Join game"),
    ),
    state.error ? h("p", { class: "error" }, state.error) : null,
  );
}

function viewLobby(state, actions) {
  const phaseText = lobbyPhaseText(state);

  return h(
    "section",
    { class: "lobby-layout" },
    h(
      "div",
      { class: "card lobby-main" },
      h("div", { class: "eyebrow" }, `Waiting room · ${modeLabel(state.mode)}`),
      h("h1", {}, `${state.lobbyPlayers.length} / 4 players`),
      h("p", { class: "lobby-status" }, phaseText),
      h(
        "div",
        { class: "player-grid" },
        [0, 1, 2, 3].map((slot) => {
          const player = state.lobbyPlayers.find((item) => item.slot === slot);
          return h(
            "div",
            { class: `player-card slot-${slot} ${player ? "occupied" : ""}`, key: `slot-${slot}` },
            h("span", { class: "player-dot" }),
            h("strong", {}, player ? player.nickname : "Waiting…"),
            h("small", {}, player?.host ? "Host" : `Player ${slot + 1}`),
          );
        }),
      ),
      h(
        "div",
        { class: "timer-panel" },
        state.lobbyPhase === "collecting"
          ? h("strong", {}, `${state.waitRemaining}s`)
          : state.lobbyPhase === "countdown"
            ? h("strong", { class: "countdown-number" }, `${state.countdownRemaining}`)
            : h("strong", {}, state.lobbyPlayers.length < 2 ? "Need 2 players" : "Ready"),
        h(
          "span",
          {},
          state.lobbyPhase === "collecting"
            ? "Waiting for more players"
            : state.lobbyPhase === "countdown"
              ? "Game starts in"
              : "Lobby",
        ),
      ),
      state.error ? h("p", { class: "error" }, state.error) : null,
    ),
    viewChat(state, actions),
  );
}

function viewGame(state, actions, renderer) {
  const game = state.gameState;
  const self = game?.players?.find((player) => player.id === state.selfId);
  const alive = game?.players?.filter((player) => !player.dead && !player.ghost).length ?? state.lobbyPlayers.length;

  return h(
    "section",
    { class: "game-layout" },
    h(
      "div",
      { class: "game-column" },
      h(
        "div",
        { class: "game-hud card" },
        h("span", {}, `You: ${self?.nickname || state.nickname}`),
        h("span", {}, modeLabel(state.mode)),
        h("span", {}, `Lives: ${self?.lives ?? 3}`),
        h("span", {}, `Alive: ${alive}`),
        h(
          "span",
          {},
          self
            ? `${self.ghost ? "Ghost · " : ""}Bombs ${self.bombCapacity} · Flame ${self.flameRange} · Speed ${self.speed.toFixed(1)}${self.team >= 0 ? ` · Team ${self.team === 0 ? "A" : "B"}` : ""}`
            : "Synchronizing…",
        ),
      ),
      game
        ? viewBoard(game, renderer)
        : h("div", { class: "card sync-card" }, h("strong", {}, "Synchronizing game state…")),
      state.screen === "finished"
        ? h(
            "div",
            { class: "result-overlay card" },
            h("h1", {}, state.result?.winnerNickname ? `${state.result.winnerNickname} wins` : "Match ended"),
            h("p", {}, state.result?.reason || "The match is over."),
            h("button", { type: "button", on: { click: actions.reload } }, "New match"),
          )
        : null,
      h("p", { class: "controls-hint" }, "Move: WASD / arrows · Bomb: Space / Enter"),
    ),
    viewChat(state, actions),
  );
}

function viewBoard(game, renderer) {
  const tiles = game.map.flatMap((row, y) =>
    row.map((tile, x) =>
      h("div", {
        class: `tile ${tile}`,
        key: `tile-${x}-${y}`,
        "data-x": x,
        "data-y": y,
      }),
    ),
  );

  const entities = [
    ...game.bombs.map((bomb) =>
      h("div", {
        class: "entity bomb",
        key: bomb.id,
        ref: (node) => renderer.setEntityRef(bomb.id, node),
      }),
    ),
    ...game.players
      .filter((player) => !player.dead)
      .map((player) =>
        h(
          "div",
          {
            class: `entity player player-${player.slot} ${player.bot ? "bot" : ""} ${player.ghost ? "ghost" : ""} ${player.team >= 0 ? `team-${player.team}` : ""}`,
            key: player.id,
            ref: (node) => renderer.setEntityRef(player.id, node),
          },
          h("span", { class: "player-face" }),
          h("span", { class: "player-name" }, player.nickname),
        ),
      ),
    ...game.flames.map((flame) =>
      h("div", {
        class: "entity flame",
        key: flame.id,
        ref: (node) => renderer.setEntityRef(flame.id, node),
      }),
    ),
  ];

  return h(
    "div",
    {
      class: "board",
      ref: (node) => renderer.setBoard(node),
      "aria-label": "Bomberman arena",
    },
    h("div", { class: "tiles" }, tiles),
    h("div", { class: "entities" }, entities),
  );
}

function viewChat(state, actions) {
  return h(
    "aside",
    { class: "card chat" },
    h("div", { class: "chat-head" }, h("strong", {}, "Chat"), h("span", {}, `${state.lobbyPlayers.length} online`)),
    h(
      "div",
      { class: "messages" },
      state.chatMessages.length
        ? state.chatMessages.map((message, index) =>
            h(
              "div",
              { class: `message ${message.id === state.selfId ? "mine" : ""}`, key: `${message.at}-${message.id}-${index}` },
              h("strong", {}, message.nickname),
              h("span", {}, message.text),
            ),
          )
        : h("p", { class: "chat-empty" }, "No messages yet."),
    ),
    h(
      "form",
      { class: "chat-form", on: { submit: actions.sendChat } },
      h("input", {
        value: state.chatDraft,
        maxlength: "240",
        placeholder: "Message",
        autocomplete: "off",
        on: { input: actions.chatInput },
      }),
      h("button", { type: "submit" }, "Send"),
    ),
  );
}

function lobbyPhaseText(state) {
  if (state.mode === "coop") {
    if (state.lobbyPhase === "countdown") return `Co-op battle starts in ${state.countdownRemaining}s.`;
    return "Solo/Co-op mode starts with one or more human players against the Bomber AI.";
  }
  if (state.mode === "teams") {
    if (state.lobbyPlayers.length < 4) return `Team 2v2 needs four players (${state.lobbyPlayers.length}/4).`;
    if (state.lobbyPhase === "countdown") return `Team match starts in ${state.countdownRemaining}s.`;
  }
  if (state.lobbyPlayers.length < 2) return "Waiting for at least one more player.";
  if (state.lobbyPhase === "collecting") {
    return `The match can take up to 4 players. Countdown starts in ${state.waitRemaining}s unless the room fills first.`;
  }
  if (state.lobbyPhase === "countdown") {
    return `Players ready. Starting in ${state.countdownRemaining}s.`;
  }
  return "Waiting for the server.";
}

function modeLabel(mode) {
  if (mode === "coop") return "Solo / Co-op vs AI";
  if (mode === "teams") return "Team 2v2";
  if (mode === "ghosts") return "Ghost mode";
  return "Classic multiplayer";
}
