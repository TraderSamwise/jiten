// Core dungeon geometry. Rooms are single-screen (Isaac-style): a fixed inner
// play area wrapped in a 1-tile wall, with door openings carved at wall centers.
export const TILE = 16;

export const ROOM_INNER_W = 15;
export const ROOM_INNER_H = 9;
export const ROOM_W = ROOM_INNER_W + 2;
export const ROOM_H = ROOM_INNER_H + 2;
export const ROOM_PX_W = ROOM_W * TILE;
export const ROOM_PX_H = ROOM_H * TILE;

// Door opening spans the wall-centre tile ± this many (→ 3 tiles wide).
export const DOOR_HALF = 1;

export const PLAYER_SPEED = 120;

// Combat.
export const PLAYER_MAX_HP = 5;
export const IFRAME_MS = 900;
export const KNOCKBACK = 220;
export const KNOCKBACK_MS = 180;

// Kanji spirits (the enemies you read to banish).
export const SPIRIT_SPEED = 38;
export const SPIRIT_BODY = 22;
export const FOCUS_SLOW = 0.2; // spirit chase-speed multiplier while reading

// The read-wheel (radial verb selector).
export const WHEEL_RADIUS_FRAC = 0.3; // of min(screen w, h)
export const WHEEL_DEADZONE = 0.32; // inner fraction of radius = cancel

// Floor grid + how many rooms to aim for.
export const GRID_COLS = 9;
export const GRID_ROWS = 9;
export const TARGET_ROOMS = 12;

export const BG = "#0d0b14";

// Difficulty controls how many WRONG options a read presents: the primitive
// ring's decoy count and the verb wheel's distractor count. Fewer in easy, more
// in hard; the rest of the wheel's spokes are greyed out and unselectable.
// Mutable singleton toggled at runtime (H); default easy.
export type Difficulty = "easy" | "hard";
export const settings: { difficulty: Difficulty } = { difficulty: "easy" };
export const wrongOptionCount = (): number => (settings.difficulty === "hard" ? 8 : 2);
