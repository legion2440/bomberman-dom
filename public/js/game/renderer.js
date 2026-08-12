import { GRID_WIDTH } from "./constants.js";

export function createGameRenderer() {
  const entityNodes = new Map();
  const visualPlayers = new Map();
  let boardNode = null;
  let tilePixels = 0;

  function setBoard(node) {
    boardNode = node;
    resize();
  }

  function setEntityRef(id, node) {
    if (node) entityNodes.set(id, node);
  }

  function resize() {
    if (!boardNode) return;
    tilePixels = boardNode.clientWidth / GRID_WIDTH;
  }

  function renderFrame(gameState, smoothRemote = false, dt = 0) {
    if (!gameState || !tilePixels) return;

    for (const player of gameState.players || []) {
      const node = entityNodes.get(player.id);
      if (!node || player.dead) continue;

      let x = player.x;
      let y = player.y;

      if (smoothRemote) {
        const visual = visualPlayers.get(player.id) || { x, y };
        const alpha = Math.min(1, Math.max(0.12, dt * 18));
        visual.x += (x - visual.x) * alpha;
        visual.y += (y - visual.y) * alpha;
        visualPlayers.set(player.id, visual);
        x = visual.x;
        y = visual.y;
      } else {
        visualPlayers.set(player.id, { x, y });
      }

      place(node, x, y);
      node.style.opacity = player.invulnerable > 0 ? "0.48" : "1";
    }

    for (const bomb of gameState.bombs || []) {
      const node = entityNodes.get(bomb.id);
      if (node) place(node, bomb.x, bomb.y);
    }

    for (const flame of gameState.flames || []) {
      const node = entityNodes.get(flame.id);
      if (node) place(node, flame.x, flame.y);
    }
  }

  function place(node, x, y) {
    node.style.transform = `translate3d(${(x * tilePixels).toFixed(2)}px, ${(y * tilePixels).toFixed(2)}px, 0)`;
  }

  return {
    setBoard,
    setEntityRef,
    resize,
    renderFrame,
  };
}
