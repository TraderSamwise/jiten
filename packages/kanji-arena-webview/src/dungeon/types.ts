export type Dir = "N" | "E" | "S" | "W";

export const DIRS: Dir[] = ["N", "E", "S", "W"];

export const DELTA: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = { N: "S", S: "N", E: "W", W: "E" };

export type RoomType = "start" | "normal" | "boss" | "treasure" | "shrine" | "shop";

export interface Room {
  gx: number;
  gy: number;
  type: RoomType;
  doors: Set<Dir>;
}

export interface Floor {
  rooms: Map<string, Room>;
  start: Room;
  cols: number;
  rows: number;
}

export const key = (gx: number, gy: number): string => `${gx},${gy}`;
