// The ONLY coupling surface between the kanji-arena game and its host app.
// The game imports nothing host-side; the host adapts to these types. Payloads
// are plain data — `token` is opaque to the game, which echoes it back on
// results so the host can map a read to its own SRS card without the game ever
// knowing what a "card" means in the host.

export type CardState = "new" | "learning" | "due" | "lapsed" | "known";

// One RTK primitive of a kanji. `glyph` is a real Unicode glyph when the
// primitive is itself a kanji; `display` is the RTK substitute char to draw in
// the bundled RtkPrimitives font when the primitive is an invented shape (no
// real glyph). At most one is set; `keyword` is the primitive's name.
export interface ArenaPrimitive {
  keyword: string;
  glyph?: string;
  display?: string;
}

export interface ArenaCard {
  token: string; // opaque host handle, round-tripped untouched
  kanji: string;
  keyword: string;
  primitives?: ArenaPrimitive[];
  story?: string; // the user's saved mnemonic for this kanji, if any
  state?: CardState;
}

export interface ArenaConfig {
  mode?: "blend" | "learn" | "review"; // cohort filter; blend (default) is progress-driven
  practice?: boolean; // ungraded free-play vs graded review
}

// Host → Game
export type HostMessage =
  | { type: "session"; cards: ArenaCard[]; config?: ArenaConfig }
  | { type: "story"; token: string; text: string }; // host delivers an AI/edited story (P4)

// Game → Host
export type GameMessage =
  | { type: "ready" }
  | { type: "result"; token: string; correct: boolean }
  | { type: "taught"; token: string } // study alcove taught a new kanji → host enrolls it (new→learning)
  | { type: "sessionEnd"; summary: { reads: number; hits: number } }
  | { type: "requestStory"; token: string; kanji: string; keyword: string; primitives: string[] }
  | { type: "editStory"; token: string; current: string };
