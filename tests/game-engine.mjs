import assert from "node:assert/strict";
import { GameEngine } from "../public/js/game/engine.js";

function players(count = 4) {
  return Array.from({ length: count }, (_, slot) => ({
    id: `p${slot + 1}`,
    nickname: `P${slot + 1}`,
    slot,
    host: slot === 0,
  }));
}

function flameAt(engine, player, ownerId = "p2") {
  engine.state.flames = [{
    id: "test-flame",
    ownerId,
    x: Math.round(player.x),
    y: Math.round(player.y),
    timer: 0.4,
  }];
}

{
  const engine = new GameEngine(players(2), { mode: "classic" });
  assert.equal(engine.state.players.length, 2);
  assert.equal(engine.state.players[0].lives, 3);
}

{
  const engine = new GameEngine(players(1), { mode: "coop" });
  const bot = engine.state.players.find((player) => player.bot);
  assert.ok(bot, "co-op mode must include an AI opponent");
  assert.equal(bot.nickname, "Bomber AI");
}

{
  const engine = new GameEngine(players(4), { mode: "teams" });
  assert.deepEqual(engine.state.players.map((player) => player.team), [0, 1, 0, 1]);

  const teammate = engine.state.players[2];
  flameAt(engine, teammate, "p1");
  engine.damageOnFlames();
  assert.equal(teammate.lives, 3, "friendly fire must not hurt the other teammate");
}

{
  const engine = new GameEngine(players(2), { mode: "classic" });
  const player = engine.state.players[0];
  const x = Math.round(player.x);
  const y = Math.round(player.y);

  for (const power of ["power-bomb-pass", "power-block-pass", "power-life"]) {
    engine.state.map[y][x] = power;
    const beforeLives = player.lives;
    engine.pickupPower(player);
    assert.equal(engine.state.map[y][x], "floor");
    if (power === "power-bomb-pass") assert.equal(player.bombPass, true);
    if (power === "power-block-pass") assert.equal(player.blockPass, true);
    if (power === "power-life") assert.equal(player.lives, beforeLives + 1);
  }
}

{
  const engine = new GameEngine(players(2), { mode: "classic" });
  const player = engine.state.players[0];
  player.lives = 1;
  player.powerUps = ["power-speed"];
  flameAt(engine, player);
  engine.damageOnFlames();
  assert.equal(player.dead, true);
  assert.equal(engine.state.map[Math.round(player.y)][Math.round(player.x)], "power-speed", "death must release a power-up");
}

{
  const engine = new GameEngine(players(2), { mode: "ghosts" });
  const ghost = engine.state.players[0];
  const other = engine.state.players[1];

  ghost.lives = 1;
  flameAt(engine, ghost, other.id);
  engine.damageOnFlames();
  assert.equal(ghost.ghost, true, "zero lives must create a ghost in ghost mode");
  assert.equal(ghost.dead, false);

  engine.state.flames = [];
  ghost.x = other.x;
  ghost.y = other.y;
  ghost.invulnerable = 0;
  engine.reviveGhosts();
  assert.equal(ghost.ghost, false, "touching a living player must revive the ghost");
  assert.equal(ghost.lives, 1);

  ghost.ghost = true;
  ghost.lives = 0;
  ghost.invulnerable = 0;
  flameAt(engine, ghost, other.id);
  engine.damageOnFlames();
  assert.equal(ghost.permanentDead, true, "a flame must permanently eliminate a ghost");
  assert.equal(ghost.dead, true);
}

console.log("[OK] game engine tests");
