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

// Purple-haze atmosphere: camera post-FX (colour grade + vignette + bloom) plus
// additive violet light layers. Dims the icy tileset into a violet-lit dungeon
// without touching the art. All values here are tuning knobs.
export const ATMOSPHERE = {
  saturate: -0.08,
  brightness: 0.86, // gently dim walls + hero for cohesion (floor is tinted below)
  floorGrade: 0x5a4f92, // multiply tint recolouring the icy floor into deep violet
  wallGrade: 0x4a4276, // multiply tint darkening the walls to match
  vignette: { radius: 0.7, strength: 0.6 },
  bloom: { blur: 1.0, strength: 0.34 },
  haze: { color: 0x7a58d8, alpha: 0.13, scale: 13 }, // faint ambient violet fog
  playerLight: { color: 0x9a6bff, alpha: 0.12, scale: 3.0 },
  spirit: {
    haze: { color: 0x9a6bff, alpha: 0.09, scale: 1.4 }, // wide shared violet
    core: { alpha: 0.3, scale: 0.72 }, // tight verb-coloured centre
    pulse: { alpha: 0.28, ms: 1150 }, // breathing glow — pulses the haze's intensity
  },
};

// Difficulty controls how many WRONG options a read presents: the primitive
// ring's decoy count and the verb wheel's distractor count. Fewer in easy, more
// in hard; the rest of the wheel's spokes are greyed out and unselectable.
// Mutable singleton toggled at runtime (H); default easy.
export type Difficulty = "easy" | "hard";
export const settings: { difficulty: Difficulty } = { difficulty: "easy" };
export const wrongOptionCount = (): number => (settings.difficulty === "hard" ? 8 : 2);
