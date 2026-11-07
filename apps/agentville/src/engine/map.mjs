// Grid queries and BFS pathfinding over the ASCII town map.
import { MAP_HEIGHT, MAP_ROWS, MAP_WIDTH, ZONES } from '../catalog/world.mjs';

const WALKABLE = /[.,a-z]/;

export function tileAt(x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return '#';
  return MAP_ROWS[y][x];
}

export const isWalkable = (x, y) => WALKABLE.test(tileAt(x, y));

export function zoneAt(x, y) {
  return ZONES.find(({ rect: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.id ?? 'hall';
}

const spotCache = new Map();
export function spotsOf(letter) {
  if (!spotCache.has(letter)) {
    const spots = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) if (MAP_ROWS[y][x] === letter) spots.push({ x, y });
    }
    spotCache.set(letter, spots);
  }
  return spotCache.get(letter);
}

export function walkableTiles() {
  return [...spotsOf('.'), ...spotsOf(',')];
}

const key = (x, y) => y * MAP_WIDTH + x;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Returns the list of tiles after `from` up to and including `to`, or null.
export function findPath(from, to) {
  if (!isWalkable(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const previous = new Map([[key(from.x, from.y), null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const [dx, dy] of STEPS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nextKey = key(nx, ny);
      if (previous.has(nextKey) || !isWalkable(nx, ny)) continue;
      previous.set(nextKey, current);
      if (nx === to.x && ny === to.y) {
        const path = [];
        let node = { x: nx, y: ny };
        while (node && !(node.x === from.x && node.y === from.y)) {
          path.unshift(node);
          node = previous.get(key(node.x, node.y));
        }
        return path;
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

export function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Free walkable neighbour of a tile (used to stand next to someone to chat).
export function neighbourOf(target, taken = new Set()) {
  for (const [dx, dy] of STEPS) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (isWalkable(x, y) && !taken.has(key(x, y))) return { x, y };
  }
  return null;
}

export const tileKey = (point) => key(Math.round(point.x), Math.round(point.y));
