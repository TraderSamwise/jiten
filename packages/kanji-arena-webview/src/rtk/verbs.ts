// The ~16 semantic verbs the combat wheel is built from. Reading a kanji tells
// you which verb "speaks its nature"; each maps to a colour + icon used by the
// wheel, the spirit aura, and the bind effect. Colours mirror the pitch deck.

export type VerbId =
  | "burn"
  | "douse"
  | "cut"
  | "strike"
  | "stop"
  | "open"
  | "block"
  | "grow"
  | "rise"
  | "fall"
  | "rush"
  | "reveal"
  | "hide"
  | "heal"
  | "harm"
  | "charm";

export interface Verb {
  id: VerbId;
  label: string;
  color: number;
  glyph: string;
}

export const VERBS: Verb[] = [
  { id: "burn", label: "burn", color: 0xff6b3d, glyph: "🔥" },
  { id: "douse", label: "douse", color: 0x46c6ef, glyph: "💧" },
  { id: "cut", label: "cut", color: 0xc2ccd6, glyph: "🗡" },
  { id: "strike", label: "strike", color: 0xffb43d, glyph: "💥" },
  { id: "stop", label: "stop", color: 0xa97be6, glyph: "✋" },
  { id: "open", label: "open", color: 0x57e0a0, glyph: "🔓" },
  { id: "block", label: "block", color: 0x8492a6, glyph: "🛡" },
  { id: "grow", label: "grow", color: 0xffd24d, glyph: "🌱" },
  { id: "rise", label: "rise", color: 0x7ad6ff, glyph: "⬆" },
  { id: "fall", label: "fall", color: 0x7681d6, glyph: "⬇" },
  { id: "rush", label: "rush", color: 0xff8f5a, glyph: "💨" },
  { id: "reveal", label: "reveal", color: 0xffe27a, glyph: "👁" },
  { id: "hide", label: "hide", color: 0x7a749a, glyph: "🌑" },
  { id: "heal", label: "heal", color: 0x6be089, glyph: "✚" },
  { id: "harm", label: "harm", color: 0xe2493b, glyph: "☠" },
  { id: "charm", label: "charm", color: 0xff8bcf, glyph: "❤" },
];

export const VERB_MAP: Record<VerbId, Verb> = Object.fromEntries(
  VERBS.map((v) => [v.id, v]),
) as Record<VerbId, Verb>;

// The bind-burst motion enacts the verb's meaning: fire/growth rise, water/weight
// sink, blades throw sharp shards, love blooms, secrets puff out small.
export interface BurstProfile {
  gravityY: number;
  speedMin: number;
  speedMax: number;
  quantity: number;
  lifespan: number;
  scale: number;
  angleMin?: number;
  angleMax?: number;
}
const FLOAT_UP: BurstProfile = {
  gravityY: -190,
  speedMin: 25,
  speedMax: 90,
  quantity: 16,
  lifespan: 640,
  scale: 0.7,
};
const SINK: BurstProfile = {
  gravityY: 240,
  speedMin: 25,
  speedMax: 90,
  quantity: 16,
  lifespan: 560,
  scale: 0.7,
};
const SHARP: BurstProfile = {
  gravityY: 0,
  speedMin: 130,
  speedMax: 260,
  quantity: 10,
  lifespan: 300,
  scale: 0.55,
};
const BLOOM: BurstProfile = {
  gravityY: -30,
  speedMin: 40,
  speedMax: 130,
  quantity: 22,
  lifespan: 660,
  scale: 0.85,
};
const PUFF: BurstProfile = {
  gravityY: 0,
  speedMin: 15,
  speedMax: 65,
  quantity: 12,
  lifespan: 380,
  scale: 0.6,
};
const STREAK: BurstProfile = {
  gravityY: 0,
  speedMin: 150,
  speedMax: 250,
  quantity: 14,
  lifespan: 360,
  scale: 0.6,
  angleMin: -25,
  angleMax: 25,
};

const BURST_BY_VERB: Record<VerbId, BurstProfile> = {
  burn: FLOAT_UP,
  grow: FLOAT_UP,
  rise: FLOAT_UP,
  heal: FLOAT_UP,
  douse: SINK,
  fall: SINK,
  cut: SHARP,
  strike: SHARP,
  harm: SHARP,
  charm: BLOOM,
  reveal: BLOOM,
  open: BLOOM,
  stop: PUFF,
  block: PUFF,
  hide: PUFF,
  rush: STREAK,
};

export function burstProfile(id: VerbId): BurstProfile {
  return BURST_BY_VERB[id];
}

// Clockwise layout order for the radial wheel (index 0 at the top). Sorted
// alphabetically by label so the wheel reads predictably and a verb is always
// in the same place.
export const WHEEL_ORDER: VerbId[] = VERBS.map((v) => v.id).sort((a, b) =>
  VERB_MAP[a].label.localeCompare(VERB_MAP[b].label),
);
