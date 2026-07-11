import type Phaser from "phaser";
import { DELTA, DIRS, Floor, key, Room } from "./types";

type Rng = Phaser.Math.RandomDataGenerator;

// Isaac-style floor gen: flood out from the centre, only adding a cell that
// touches at most one existing room (keeps the layout tree-ish with dead-ends),
// with a coin-flip per candidate. Retried until it reaches a reasonable size.
export function generateFloor(cols: number, rows: number, target: number, rng: Rng): Floor {
  let rooms: Map<string, Room>;
  let start: Room;
  let attempt = 0;
  do {
    ({ rooms, start } = placeRooms(cols, rows, target, rng));
    attempt++;
  } while (rooms.size < Math.min(target, 8) && attempt < 40);

  for (const room of rooms.values()) {
    for (const d of DIRS) {
      if (rooms.has(key(room.gx + DELTA[d].dx, room.gy + DELTA[d].dy))) room.doors.add(d);
    }
  }

  assignSpecialRooms(rooms, start);
  return { rooms, start, cols, rows };
}

function placeRooms(cols: number, rows: number, target: number, rng: Rng) {
  const rooms = new Map<string, Room>();
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const start: Room = { gx: cx, gy: cy, type: "start", doors: new Set() };
  rooms.set(key(cx, cy), start);

  const queue: Room[] = [start];
  const filledNeighbors = (x: number, y: number) =>
    DIRS.reduce((n, d) => n + (rooms.has(key(x + DELTA[d].dx, y + DELTA[d].dy)) ? 1 : 0), 0);

  while (queue.length && rooms.size < target) {
    const room = queue.shift()!;
    for (const d of DIRS) {
      if (rooms.size >= target) break;
      const nx = room.gx + DELTA[d].dx;
      const ny = room.gy + DELTA[d].dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (rooms.has(key(nx, ny))) continue;
      if (filledNeighbors(nx, ny) > 1) continue;
      if (rng.frac() < 0.4) continue;
      const nr: Room = { gx: nx, gy: ny, type: "normal", doors: new Set() };
      rooms.set(key(nx, ny), nr);
      queue.push(nr);
    }
  }
  return { rooms, start };
}

// Boss = farthest dead-end from start; treasure = nearest other dead-end.
function assignSpecialRooms(rooms: Map<string, Room>, start: Room) {
  const dist = new Map<string, number>([[key(start.gx, start.gy), 0]]);
  const q: Room[] = [start];
  while (q.length) {
    const r = q.shift()!;
    const dc = dist.get(key(r.gx, r.gy))!;
    for (const d of r.doors) {
      const k = key(r.gx + DELTA[d].dx, r.gy + DELTA[d].dy);
      const nr = rooms.get(k);
      if (nr && !dist.has(k)) {
        dist.set(k, dc + 1);
        q.push(nr);
      }
    }
  }

  const deadEnds = [...rooms.values()].filter((r) => r.type === "normal" && r.doors.size === 1);
  deadEnds.sort((a, b) => (dist.get(key(b.gx, b.gy)) ?? 0) - (dist.get(key(a.gx, a.gy)) ?? 0));
  if (deadEnds[0]) deadEnds[0].type = "boss";
  if (deadEnds.length > 1) {
    deadEnds[deadEnds.length - 1].type = "treasure";
    // Spare dead-ends (neither boss nor treasure) become an optional shrine and
    // an optional shop — whichever ones are still available on this floor.
    const spare = deadEnds.find((r) => r.type === "normal");
    if (spare) spare.type = "shrine";
    const shopSpare = deadEnds.find((r) => r.type === "normal");
    if (shopSpare) shopSpare.type = "shop";
  } else {
    // Path floor with start at an endpoint → the lone dead-end became the boss.
    // Promote the farthest remaining normal room so every floor keeps a study alcove.
    const alt = [...rooms.values()]
      .filter((r) => r.type === "normal")
      .sort((a, b) => (dist.get(key(b.gx, b.gy)) ?? 0) - (dist.get(key(a.gx, a.gy)) ?? 0))[0];
    if (alt) alt.type = "treasure";
  }
}
