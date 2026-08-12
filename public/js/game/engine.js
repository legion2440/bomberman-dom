import {
  BASE_SPEED,
  BOMB_FUSE_SECONDS,
  FLAME_SECONDS,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_SPEED,
  PLAYER_RADIUS,
  SPAWNS,
  SPAWN_SAFE,
  SPEED_INCREMENT,
} from "./constants.js";

const EMPTY_INPUT = Object.freeze({ x: 0, y: 0, bomb: false });

export class GameEngine {
  constructor(players) {
    this.inputs = new Map();
    this.gameOverSent = false;
    this.state = {
      running: true,
      winnerId: "",
      winnerNickname: "",
      map: makeMap(),
      players: players
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((player) => makePlayer(player)),
      bombs: [],
      flames: [],
      nextId: 1,
    };
  }

  setInput(playerId, input) {
    this.inputs.set(playerId, normalizeInput(input));
  }

  update(dt) {
    if (!this.state.running) return;

    this.updatePlayers(dt);
    this.updateBombPassability();
    this.updateBombs(dt);
    this.updateFlames(dt);
    this.damageOnFlames();
    this.checkWinner();
  }

  updatePlayers(dt) {
    for (const player of this.state.players) {
      if (player.dead) continue;

      player.cooldown = Math.max(0, player.cooldown - dt);
      player.invulnerable = Math.max(0, player.invulnerable - dt);

      const input = this.inputs.get(player.id) || EMPTY_INPUT;
      movePlayer(this.state, player, input.x, input.y, dt);

      if (input.bomb && !player.bombHeld) {
        this.placeBomb(player);
      }
      player.bombHeld = input.bomb;

      this.pickupPower(player);
    }
  }

  placeBomb(player) {
    if (player.cooldown > 0) return;

    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const active = this.state.bombs.filter((bomb) => bomb.ownerId === player.id).length;
    if (active >= player.bombCapacity) return;
    if (this.state.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return;

    this.state.bombs.push({
      id: `bomb-${this.state.nextId++}`,
      ownerId: player.id,
      x,
      y,
      range: player.flameRange,
      timer: BOMB_FUSE_SECONDS,
      passableFor: [player.id],
    });
    player.cooldown = 0.2;
  }

  updateBombPassability() {
    for (const bomb of this.state.bombs) {
      if (!bomb.passableFor?.length) continue;
      bomb.passableFor = bomb.passableFor.filter((playerId) => {
        const player = this.state.players.find((item) => item.id === playerId && !item.dead);
        return player && actorOverlapsTile(player, bomb.x, bomb.y);
      });
    }
  }

  updateBombs(dt) {
    for (const bomb of this.state.bombs) {
      bomb.timer -= dt;
      if (isFlameTile(this.state, bomb.x, bomb.y)) {
        bomb.timer = Math.min(bomb.timer, 0.02);
      }
    }

    while (true) {
      const index = this.state.bombs.findIndex((bomb) => bomb.timer <= 0);
      if (index < 0) break;
      const [bomb] = this.state.bombs.splice(index, 1);
      this.explodeBomb(bomb);
    }
  }

  explodeBomb(bomb) {
    const tiles = [{ x: bomb.x, y: bomb.y }];

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let step = 1; step <= bomb.range; step++) {
        const x = bomb.x + dx * step;
        const y = bomb.y + dy * step;
        if (!inBounds(x, y) || this.state.map[y][x] === "wall") break;

        tiles.push({ x, y });
        if (this.state.map[y][x] === "block") {
          this.state.map[y][x] = rollPower();
          break;
        }
      }
    }

    for (const tile of tiles) {
      const existing = this.state.flames.find((flame) => flame.x === tile.x && flame.y === tile.y);
      if (existing) {
        existing.timer = FLAME_SECONDS;
      } else {
        this.state.flames.push({
          id: `flame-${this.state.nextId++}`,
          x: tile.x,
          y: tile.y,
          timer: FLAME_SECONDS,
        });
      }

      for (const chained of this.state.bombs) {
        if (chained.x === tile.x && chained.y === tile.y) {
          chained.timer = Math.min(chained.timer, 0.02);
        }
      }
    }

    this.damageOnFlames();
  }

  updateFlames(dt) {
    for (const flame of this.state.flames) flame.timer -= dt;
    this.state.flames = this.state.flames.filter((flame) => flame.timer > 0);
  }

  damageOnFlames() {
    for (const player of this.state.players) {
      if (player.dead || player.invulnerable > 0) continue;
      if (!isFlameTile(this.state, Math.round(player.x), Math.round(player.y))) continue;

      player.lives -= 1;
      player.invulnerable = 1.15;
      if (player.lives <= 0) {
        player.dead = true;
        player.bombHeld = false;
        continue;
      }

      player.x = player.spawnX;
      player.y = player.spawnY;
    }
  }

  pickupPower(player) {
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const tile = this.state.map[y]?.[x];

    if (tile === "power-bomb") {
      player.bombCapacity += 1;
    } else if (tile === "power-flame") {
      player.flameRange += 1;
    } else if (tile === "power-speed") {
      player.speed = Math.min(MAX_SPEED, player.speed + SPEED_INCREMENT);
    } else {
      return;
    }

    this.state.map[y][x] = "floor";
  }

  checkWinner() {
    const alive = this.state.players.filter((player) => !player.dead);
    if (alive.length > 1) return;

    this.state.running = false;
    if (alive.length === 1) {
      this.state.winnerId = alive[0].id;
      this.state.winnerNickname = alive[0].nickname;
    }
  }

  consumeGameOver() {
    if (this.state.running || this.gameOverSent) return null;
    this.gameOverSent = true;
    return {
      winnerId: this.state.winnerId,
      winnerNickname: this.state.winnerNickname,
      reason: this.state.winnerId ? "last player standing" : "draw",
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

function makePlayer(info) {
  const spawn = SPAWNS[info.slot] || SPAWNS[0];
  return {
    id: info.id,
    nickname: info.nickname,
    slot: info.slot,
    x: spawn.x,
    y: spawn.y,
    spawnX: spawn.x,
    spawnY: spawn.y,
    lives: 3,
    bombCapacity: 1,
    flameRange: 2,
    speed: BASE_SPEED,
    cooldown: 0,
    invulnerable: 0,
    bombHeld: false,
    dead: false,
  };
}

function makeMap() {
  const map = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      const hardWall =
        x === 0 ||
        y === 0 ||
        x === GRID_WIDTH - 1 ||
        y === GRID_HEIGHT - 1 ||
        (x % 2 === 0 && y % 2 === 0);

      if (hardWall) {
        row.push("wall");
        continue;
      }

      const safe = isSpawnSafe(x, y);
      row.push(!safe && Math.random() < 0.45 ? "block" : "floor");
    }
    map.push(row);
  }
  return map;
}

function isSpawnSafe(x, y) {
  return SPAWN_SAFE.some((tiles) => tiles.some((tile) => tile.x === x && tile.y === y));
}

function rollPower() {
  if (Math.random() >= 0.36) return "floor";
  const roll = Math.floor(Math.random() * 3);
  if (roll === 0) return "power-bomb";
  if (roll === 1) return "power-flame";
  return "power-speed";
}

function normalizeInput(input) {
  let x = Math.max(-1, Math.min(1, Number(input?.x) || 0));
  let y = Math.max(-1, Math.min(1, Number(input?.y) || 0));

  if (x && y) {
    const length = Math.hypot(x, y);
    x /= length;
    y /= length;
  }

  return { x, y, bomb: Boolean(input?.bomb) };
}

function movePlayer(state, player, dirX, dirY, dt) {
  if (!dirX && !dirY) return;

  const snap = player.speed * dt * 1.5;
  if (dirX && !dirY) player.y = approach(player.y, Math.round(player.y), snap);
  if (dirY && !dirX) player.x = approach(player.x, Math.round(player.x), snap);

  const nextX = player.x + dirX * player.speed * dt;
  const nextY = player.y + dirY * player.speed * dt;

  if (canStand(state, player, nextX, player.y)) player.x = nextX;
  if (canStand(state, player, player.x, nextY)) player.y = nextY;
}

function canStand(state, player, x, y) {
  const centerX = x + 0.5;
  const centerY = y + 0.5;
  const checks = [
    [centerX - PLAYER_RADIUS, centerY - PLAYER_RADIUS],
    [centerX + PLAYER_RADIUS, centerY - PLAYER_RADIUS],
    [centerX - PLAYER_RADIUS, centerY + PLAYER_RADIUS],
    [centerX + PLAYER_RADIUS, centerY + PLAYER_RADIUS],
  ];

  return checks.every(([cx, cy]) => {
    const gx = Math.floor(cx);
    const gy = Math.floor(cy);
    if (!inBounds(gx, gy)) return false;

    const tile = state.map[gy][gx];
    if (tile === "wall" || tile === "block") return false;

    return !state.bombs.some((bomb) => {
      if (bomb.x !== gx || bomb.y !== gy) return false;
      return !bomb.passableFor?.includes(player.id);
    });
  });
}

function actorOverlapsTile(player, tileX, tileY) {
  const centerX = player.x + 0.5;
  const centerY = player.y + 0.5;
  return (
    centerX + PLAYER_RADIUS > tileX &&
    centerX - PLAYER_RADIUS < tileX + 1 &&
    centerY + PLAYER_RADIUS > tileY &&
    centerY - PLAYER_RADIUS < tileY + 1
  );
}

function isFlameTile(state, x, y) {
  return state.flames.some((flame) => flame.x === x && flame.y === y);
}

function approach(value, target, amount) {
  if (Math.abs(value - target) <= amount) return target;
  return value + Math.sign(target - value) * amount;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
}
