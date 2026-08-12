export function createGameRenderer() {
  const entityNodes = new Map();
  const visualPlayers = new Map();

  function setEntityRef(id, node) {
    if (!node) return;
    if (entityNodes.get(id) !== node) node.style.visibility = "hidden";
    entityNodes.set(id, node);
  }

  function renderFrame(gameState, smoothRemote = false, dt = 0) {
    if (!gameState) return;

    const liveIds = new Set();

    for (const player of gameState.players || []) {
      if (player.dead) continue;
      liveIds.add(player.id);
      const node = entityNodes.get(player.id);
      if (!node) continue;

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
      liveIds.add(bomb.id);
      const node = entityNodes.get(bomb.id);
      if (node) place(node, bomb.x, bomb.y);
    }

    for (const flame of gameState.flames || []) {
      liveIds.add(flame.id);
      const node = entityNodes.get(flame.id);
      if (node) place(node, flame.x, flame.y);
    }

    for (const id of entityNodes.keys()) {
      if (!liveIds.has(id)) entityNodes.delete(id);
    }
    for (const id of visualPlayers.keys()) {
      if (!liveIds.has(id)) visualPlayers.delete(id);
    }
  }

  function place(node, x, y) {
    node.style.transform = `translate3d(${(x * 100).toFixed(2)}%, ${(y * 100).toFixed(2)}%, 0)`;
    if (node.style.visibility) node.style.visibility = "";
  }

  return {
    setEntityRef,
    renderFrame,
  };
}
