export function createNetwork(handlers = {}) {
  let socket = null;

  function connect(nickname) {
    disconnect();

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener("open", () => {
      handlers.onStatus?.("connected");
      send("join", { nickname });
    });

    socket.addEventListener("close", () => {
      handlers.onStatus?.("disconnected");
    });

    socket.addEventListener("error", () => {
      handlers.onStatus?.("error");
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      const data = message.data ?? {};
      switch (message.type) {
        case "joined":
          handlers.onJoined?.(data);
          break;
        case "lobby":
          handlers.onLobby?.(data);
          break;
        case "chat":
          handlers.onChat?.(data);
          break;
        case "input":
          handlers.onInput?.(data);
          break;
        case "state":
          handlers.onState?.(data);
          break;
        case "game_start":
          handlers.onGameStart?.(data);
          break;
        case "game_over":
          handlers.onGameOver?.(data);
          break;
        case "error":
          handlers.onError?.(data.message || "Server error");
          break;
      }
    });
  }

  function send(type, data = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, data }));
    return true;
  }

  function disconnect() {
    if (socket) {
      socket.close();
      socket = null;
    }
  }

  function isOpen() {
    return Boolean(socket && socket.readyState === WebSocket.OPEN);
  }

  return { connect, send, disconnect, isOpen };
}
