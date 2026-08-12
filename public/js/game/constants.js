export const GRID_WIDTH = 15;
export const GRID_HEIGHT = 13;
export const MAX_PLAYERS = 4;

export const BOMB_FUSE_SECONDS = 2.1;
export const FLAME_SECONDS = 0.5;
export const PLAYER_RADIUS = 0.36;
export const BASE_SPEED = 4.4;
export const SPEED_INCREMENT = 0.7;
export const MAX_SPEED = 7.2;
export const SNAPSHOT_INTERVAL = 0.05;

export const SPAWNS = [
  { x: 1, y: 1 },
  { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 },
  { x: GRID_WIDTH - 2, y: 1 },
  { x: 1, y: GRID_HEIGHT - 2 },
];

export const SPAWN_SAFE = [
  [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 1, y: 2 },
  ],
  [
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 },
    { x: GRID_WIDTH - 3, y: GRID_HEIGHT - 2 },
    { x: GRID_WIDTH - 4, y: GRID_HEIGHT - 2 },
    { x: GRID_WIDTH - 5, y: GRID_HEIGHT - 2 },
    { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 3 },
  ],
  [
    { x: GRID_WIDTH - 2, y: 1 },
    { x: GRID_WIDTH - 3, y: 1 },
    { x: GRID_WIDTH - 4, y: 1 },
    { x: GRID_WIDTH - 5, y: 1 },
    { x: GRID_WIDTH - 2, y: 2 },
  ],
  [
    { x: 1, y: GRID_HEIGHT - 2 },
    { x: 2, y: GRID_HEIGHT - 2 },
    { x: 3, y: GRID_HEIGHT - 2 },
    { x: 4, y: GRID_HEIGHT - 2 },
    { x: 1, y: GRID_HEIGHT - 3 },
  ],
];
