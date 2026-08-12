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
const CARDINALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const POWER_TILES = [
  "power-bomb",
  "power-flame",
  "power-speed",
  "power-bomb-pass",
  "power-block-pass",
  "power-life",
];
const COOP_BOT_ID = "coop-bot";
const COOP_BOT_SPAWN = { x: 7, y: 6 };

export class GameEngine {
  constructor(players, options = {}) {
    const mode = options.mode || "classic";
    const actors = players
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((player) => makePlayer(player, mode));

    if (mode === "coop") actors.push(makeCoopBot());

    this.inputs = new Map();
    this.gameOverSent = false;
    this.state = {
      mode,
      running: true,
      winnerId: "",
      winnerNickname: "",
      map: makeMap(mode),
      players: actors,
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
    if (this.state.mode === "ghosts") this.reviveGhosts();
    this.checkWinner();
  }

  updatePlayers(dt) {
    for (const player of this.state.players) {
      if (player.dead) continue;

      player.cooldown = Math.max(0, player.cooldown - dt);
      player.invulnerable = Math.max(0, player.invulnerable - dt);

      if (player.bot) {
        this.updateBot(player, dt);
        continue;
      }

      const input = this.inputs.get(player.id) || EMPTY_INPUT;
      movePlayer(this.state, player, input.x, input.y, dt);

      if (!player.ghost && input.bomb && !player.bombHeld) {
        this.placeBomb(player);
      }
      player.bombHeld = input.bomb;

      if (!player.ghost) this.pickupPower(player);
    }
  }

  updateBot(bot, dt) {
    bot.rethink -= dt;
    const cell = actorCell(bot);
    const inDanger = dangerAt(this.state, cell.x, cell.y, bot.id) > 0;

    if (bot.rethink <= 0 || !canStep(this.state, bot, bot.dirX, bot.dirY)) {
      const target = nearestLivingHuman(this.state, bot);
      const escape = inDanger ? findEscapeDirection(this.state, bot) : null;
      const directions = shuffled(CARDINALS);
      const viable = directions.filter(([dx, dy]) => canStep(this.state, bot, dx, dy));

      if (escape) {
        [bot.dirX, bot.dirY] = escape;
      } else if (viable.length) {
        viable.sort((a, b) => {
          const ad = dangerAt(this.state, Math.round(bot.x + a[0]), Math.round(bot.y + a[1]), bot.id);
          const bd = dangerAt(this.state, Math.round(bot.x + b[0]), Math.round(bot.y + b[1]), bot.id);
          if (ad !== bd) return ad - bd;
          if (!target) return 0;
          return projectedDistance(bot, a, target) - projectedDistance(bot, b, target);
        });
        [bot.dirX, bot.dirY] = viable[0];
      } else {
        bot.dirX = 0;
        bot.dirY = 0;
      }
      bot.rethink = inDanger ? 0.08 : 0.18 + Math.random() * 0.22;
    }

    movePlayer(this.state, bot, bot.dirX, bot.dirY, dt);
    this.pickupPower(bot);

    const target = nearestLivingHuman(this.state, bot);
    if (!target || bot.cooldown > 0 || dangerAt(this.state, Math.round(bot.x), Math.round(bot.y), bot.id) > 0) return;

    const closeEnough = manhattan(bot.x, bot.y, target.x, target.y) <= 2.2;
    const nearBlock = CARDINALS.some(([dx, dy]) => this.state.map[Math.round(bot.y) + dy]?.[Math.round(bot.x) + dx] === "block");
    if ((closeEnough || nearBlock) && hasEscapeDirection(this.state, bot)) {
      this.placeBomb(bot);
      bot.rethink = 0;
    }
  }

  placeBomb(player) {
    if (player.cooldown > 0 || player.ghost) return;

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

    for (const [dx, dy] of CARDINALS) {
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
      this.state.flames.push({
        id: `flame-${this.state.nextId++}`,
        ownerId: bomb.ownerId,
        x: tile.x,
        y: tile.y,
        timer: FLAME_SECONDS,
      });

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

      const x = Math.round(player.x);
      const y = Math.round(player.y);
      const damagingFlame = this.state.flames.find((flame) => {
        if (flame.x !== x || flame.y !== y) return false;
        return canFlameDamage(this.state, flame, player);
      });
      if (!damagingFlame) continue;

      if (player.ghost) {
        player.ghost = false;
        player.dead = true;
        player.permanentDead = true;
        continue;
      }

      player.lives -= 1;
      player.invulnerable = 1.15;
      if (player.lives <= 0) {
        this.dropPowerOnDeath(player);
        if (this.state.mode === "ghosts" && !player.bot) {
          player.lives = 0;
          player.ghost = true;
          player.dead = false;
          player.invulnerable = 0.8;
          player.bombHeld = false;
        } else {
          player.dead = true;
          player.permanentDead = true;
          player.bombHeld = false;
        }
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
    } else if (tile === "power-bomb-pass") {
      player.bombPass = true;
    } else if (tile === "power-block-pass") {
      player.blockPass = true;
    } else if (tile === "power-life") {
      player.lives += 1;
    } else {
      return;
    }

    player.powerUps.push(tile);
    this.state.map[y][x] = "floor";
  }

  dropPowerOnDeath(player) {
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    if (!inBounds(x, y) || this.state.map[y][x] !== "floor") return;

    let drop;
    if (player.powerUps.length) {
      const index = Math.floor(Math.random() * player.powerUps.length);
      [drop] = player.powerUps.splice(index, 1);
    } else {
      drop = POWER_TILES[Math.floor(Math.random() * POWER_TILES.length)];
    }
    this.state.map[y][x] = drop;
  }

  reviveGhosts() {
    const living = this.state.players.filter((player) => !player.dead && !player.ghost && !player.bot);
    for (const ghost of this.state.players.filter((player) => player.ghost && !player.dead)) {
      const touched = living.find((player) => player.id !== ghost.id && euclidean(player, ghost) < 0.62);
      if (!touched) continue;

      ghost.ghost = false;
      ghost.lives = 1;
      ghost.invulnerable = 1.25;
      ghost.bombHeld = true;
    }
  }

  checkWinner() {
    const mode = this.state.mode;

    if (mode === "coop") {
      const bot = this.state.players.find((player) => player.bot);
      const humans = this.state.players.filter((player) => !player.bot);
      if (bot?.dead) {
        this.finish("players", "Players");
      } else if (humans.every((player) => player.dead)) {
        this.finish(bot?.id || "", bot?.nickname || "Bomber AI");
      }
      return;
    }

    if (mode === "teams") {
      const alive = this.state.players.filter((player) => !player.dead);
      const teams = new Set(alive.map((player) => player.team));
      if (teams.size <= 1) {
        const team = alive[0]?.team;
        this.finish(team === 0 ? "team-a" : team === 1 ? "team-b" : "", team === 0 ? "Team A" : team === 1 ? "Team B" : "Draw");
      }
      return;
    }

    if (mode === "ghosts") {
      const recoverable = this.state.players.filter((player) => !player.permanentDead);
      const living = recoverable.filter((player) => !player.ghost && !player.dead);
      if (living.length === 0) {
        this.finish("", "Draw");
      } else if (recoverable.length === 1 && living.length === 1) {
        this.finish(recoverable[0].id, recoverable[0].nickname);
      }
      return;
    }

    const alive = this.state.players.filter((player) => !player.dead);
    if (alive.length <= 1) {
      this.finish(alive[0]?.id || "", alive[0]?.nickname || "Draw");
    }
  }

  finish(winnerId, winnerNickname) {
    this.state.running = false;
    this.state.winnerId = winnerId;
    this.state.winnerNickname = winnerNickname;
  }

  consumeGameOver() {
    if (this.state.running || this.gameOverSent) return null;
    this.gameOverSent = true;
    return {
      winnerId: this.state.winnerId,
      winnerNickname: this.state.winnerNickname,
      reason: this.state.mode === "teams"
        ? "last team standing"
        : this.state.mode === "coop"
          ? "co-op battle finished"
          : "last player standing",
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

function makePlayer(info, mode) {
  const spawn = SPAWNS[info.slot] || SPAWNS[0];
  return {
    id: info.id,
    nickname: info.nickname,
    slot: info.slot,
    team: mode === "teams" ? info.slot % 2 : -1,
    bot: false,
    ghost: false,
    permanentDead: false,
    x: spawn.x,
    y: spawn.y,
    spawnX: spawn.x,
    spawnY: spawn.y,
    lives: 3,
    bombCapacity: 1,
    flameRange: 2,
    speed: BASE_SPEED,
    bombPass: false,
    blockPass: false,
    powerUps: [],
    cooldown: 0,
    invulnerable: 0,
    bombHeld: false,
    dead: false,
  };
}

function makeCoopBot() {
  return {
    id: COOP_BOT_ID,
    nickname: "Bomber AI",
    slot: 4,
    team: 1,
    bot: true,
    ghost: false,
    permanentDead: false,
    x: COOP_BOT_SPAWN.x,
    y: COOP_BOT_SPAWN.y,
    spawnX: COOP_BOT_SPAWN.x,
    spawnY: COOP_BOT_SPAWN.y,
    lives: 3,
    bombCapacity: 2,
    flameRange: 2,
    speed: 3.8,
    bombPass: false,
    blockPass: false,
    powerUps: [],
    cooldown: 0,
    invulnerable: 0,
    bombHeld: false,
    dead: false,
    dirX: 0,
    dirY: 0,
    rethink: 0,
  };
}

function makeMap(mode) {
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

      const safe = isSpawnSafe(x, y) || (mode === "coop" && isCoopSafe(x, y));
      row.push(!safe && Math.random() < 0.45 ? "block" : "floor");
    }
    map.push(row);
  }
  return map;
}

function isSpawnSafe(x, y) {
  return SPAWN_SAFE.some((tiles) => tiles.some((tile) => tile.x === x && tile.y === y));
}

function isCoopSafe(x, y) {
  return Math.abs(x - COOP_BOT_SPAWN.x) + Math.abs(y - COOP_BOT_SPAWN.y) <= 1;
}

function rollPower() {
  if (Math.random() >= 0.4) return "floor";
  return POWER_TILES[Math.floor(Math.random() * POWER_TILES.length)];
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
    if (tile === "wall") return false;
    if (tile === "block" && !player.blockPass && !player.ghost) return false;

    if (player.bombPass || player.ghost) return true;
    return !state.bombs.some((bomb) => {
      if (bomb.x !== gx || bomb.y !== gy) return false;
      return !bomb.passableFor?.includes(player.id);
    });
  });
}

function canStep(state, player, dx, dy) {
  if (!dx && !dy) return false;
  return canStand(state, player, player.x + dx * 0.34, player.y + dy * 0.34);
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

function canFlameDamage(state, flame, player) {
  if (player.ghost) return true;
  if (state.mode !== "teams" || !flame.ownerId || flame.ownerId === player.id) return true;

  const owner = state.players.find((candidate) => candidate.id === flame.ownerId);
  return !owner || owner.team !== player.team;
}

function dangerAt(state, x, y, actorId, extraBomb = null) {
  if (state.flames.some((flame) => flame.x === x && flame.y === y)) return 100;
  let danger = 0;
  const bombs = extraBomb ? [...state.bombs, extraBomb] : state.bombs;
  for (const bomb of bombs) {
    if (!blastTiles(state, bomb).some((tile) => tile.x === x && tile.y === y)) continue;
    if (bomb.ownerId === actorId && bomb.timer > 1.2) danger = Math.max(danger, 25);
    else danger = Math.max(danger, bomb.timer < 0.75 ? 100 : 60);
  }
  return danger;
}

function blastTiles(state, bomb) {
  const result = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of CARDINALS) {
    for (let step = 1; step <= bomb.range; step++) {
      const x = bomb.x + dx * step;
      const y = bomb.y + dy * step;
      if (!inBounds(x, y) || state.map[y][x] === "wall") break;
      result.push({ x, y });
      if (state.map[y][x] === "block") break;
    }
  }
  return result;
}

function isFlameTile(state, x, y) {
  return state.flames.some((flame) => flame.x === x && flame.y === y);
}

function hasEscapeDirection(state, bot) {
  const fakeBomb = {
    id: "preview-bomb",
    ownerId: bot.id,
    x: Math.round(bot.x),
    y: Math.round(bot.y),
    range: bot.flameRange,
    timer: BOMB_FUSE_SECONDS,
  };
  return Boolean(findEscapeDirection(state, bot, fakeBomb));
}

function findEscapeDirection(state, bot, extraBomb = null) {
  const start = actorCell(bot);
  const queue = [{ x: start.x, y: start.y, depth: 0, first: null }];
  const seen = new Set([`${start.x},${start.y}`]);

  while (queue.length) {
    const cell = queue.shift();
    if (cell.depth > 0 && dangerAt(state, cell.x, cell.y, bot.id, extraBomb) === 0) {
      return cell.first;
    }
    if (cell.depth >= 6) continue;

    for (const [dx, dy] of CARDINALS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || !canEnterBotCell(state, bot, x, y, extraBomb)) continue;
      seen.add(key);
      queue.push({
        x,
        y,
        depth: cell.depth + 1,
        first: cell.first || [dx, dy],
      });
    }
  }
  return null;
}

function canEnterBotCell(state, bot, x, y, extraBomb = null) {
  if (!inBounds(x, y)) return false;
  const tile = state.map[y][x];
  if (tile === "wall" || (tile === "block" && !bot.blockPass)) return false;
  const bombs = extraBomb ? [...state.bombs, extraBomb] : state.bombs;
  return !bombs.some((bomb) => bomb.x === x && bomb.y === y && !(bomb.ownerId === bot.id && x === Math.round(bot.x) && y === Math.round(bot.y)));
}

function nearestLivingHuman(state, bot) {
  let best = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.bot || player.dead || player.ghost) continue;
    const distance = manhattan(bot.x, bot.y, player.x, player.y);
    if (distance < bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }
  return best;
}

function projectedDistance(bot, direction, target) {
  return manhattan(bot.x + direction[0], bot.y + direction[1], target.x, target.y);
}

function actorCell(actor) {
  return { x: Math.round(actor.x), y: Math.round(actor.y) };
}

function shuffled(values) {
  const result = values.map((item) => [...item]);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function approach(value, target, amount) {
  if (Math.abs(value - target) <= amount) return target;
  return value + Math.sign(target - value) * amount;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
}
