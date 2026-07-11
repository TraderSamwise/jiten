import type { SQLiteDatabase } from "expo-sqlite";

import { getKanjiBatchAsync, getPrimitivesForKanjiAsync } from "@/db/kanji-search";
import type { WrappedUserDb } from "@/db/user-db";
import { dateToSrsEpochDays } from "@/stores/simple-srs";
import type {
  ArenaCard,
  ArenaConfig,
  ArenaPrimitive,
  CardState,
} from "@jiten/kanji-arena-webview/protocol";

export type Mode = NonNullable<ArenaConfig["mode"]>;

// The strokes DB placeholder for kanji with no RTK primitive breakdown — drop it
// so those kanji show a clear "no breakdown" state rather than the sentinel text.
const PRIMITIVE_SENTINEL = "Please consult book.";

interface EntryRow {
  kanjiLiteral: string;
  state: number | null; // FSRS state; null = no srs_cards row (unstudied)
  due: string | null;
  simpleStage: number | null;
  simpleN: number | null;
  lapses: number | null;
}

// Map a card's real jiten SRS reality to the neutral CardState the game scaffolds
// on. FSRS: 0 New, 1 Learning, 2 Review, 3 Relearning. Simple: stage 0 =
// learning/lapsed, 1 = graduated. No srs_cards row (state null) = unstudied.
function cardState(
  flashcardMode: string,
  r: EntryRow,
  nowIso: string,
  todayEpoch: number,
): CardState {
  if (r.state == null) return "new"; // no row yet — never studied
  if (flashcardMode === "simple_srs") {
    if (r.simpleStage == null) return "new";
    if (r.simpleStage === 0) return (r.lapses ?? 0) > 0 ? "lapsed" : "learning";
    return r.simpleN != null && r.simpleN <= todayEpoch ? "due" : "known";
  }
  if (flashcardMode === "srs") {
    if (r.state === 1) return "learning";
    if (r.state === 3) return "lapsed";
    if (r.state === 2) return r.due != null && r.due <= nowIso ? "due" : "known";
    return "new"; // state 0
  }
  return "new"; // add_order / no scheduling
}

function inCohort(st: CardState, mode: Mode): boolean {
  if (mode === "learn") return st === "new" || st === "learning" || st === "lapsed";
  if (mode === "review") return st !== "new";
  return true; // blend — progress-driven default
}

// Narrow an already-built (blend) session to a cohort, client-side — one source
// of truth for the menu's Learn/Review picks. A stateless card defaults to new.
export function filterCohort(cards: ArenaCard[], mode: Mode): ArenaCard[] {
  return cards.filter((c) => inCohort(c.state ?? "new", mode));
}

// Build the game session from a list's kanji — ALL of them, studied or not, so a
// fresh lesson list is playable. Kanji come from list_entries (membership); SRS
// state is left-joined from srs_cards (unstudied → "new"). The `mode` narrows the
// cohort (learn/review) or plays the blend. primitives (RTK decomposition) come
// from the optional strokesDb; the saved mnemonic story and keyword override come
// from user_kanji_notes. Kanji with no keyword to read are skipped.
export async function buildArenaSession(
  userDb: WrappedUserDb,
  dictDb: SQLiteDatabase,
  strokesDb: SQLiteDatabase | null,
  listId: string,
  mode: Mode = "blend",
): Promise<ArenaCard[]> {
  const rows = await userDb.getAllAsync<EntryRow>(
    `SELECT le.kanji_literal as kanjiLiteral, c.state as state, c.due as due,
       c.simple_stage as simpleStage, c.simple_n as simpleN, c.lapses as lapses
     FROM list_entries le
     LEFT JOIN srs_cards c
       ON c.list_id = le.list_id AND c.entry_id = 0
       AND c.kanji_literal = le.kanji_literal AND c.deleted_at IS NULL
     WHERE le.list_id = ? AND le.entry_id = 0
       AND le.kanji_literal IS NOT NULL AND le.deleted_at IS NULL`,
    [listId],
  );
  if (rows.length === 0) return [];

  const list = await userDb.getFirstAsync<{ flashcardMode: string }>(
    `SELECT flashcard_mode as flashcardMode FROM lists WHERE id = ?`,
    [listId],
  );
  const flashcardMode = list?.flashcardMode ?? "add_order";

  const nowIso = new Date().toISOString();
  const todayEpoch = dateToSrsEpochDays(new Date());
  const rank: Record<CardState, number> = { due: 4, lapsed: 3, learning: 2, known: 1, new: 0 };
  const stateByLiteral = new Map<string, CardState>();
  for (const r of rows) {
    const st = cardState(flashcardMode, r, nowIso, todayEpoch);
    const prev = stateByLiteral.get(r.kanjiLiteral);
    if (!prev || rank[st] > rank[prev]) stateByLiteral.set(r.kanjiLiteral, st);
  }
  const literals = [...stateByLiteral.keys()].filter((lit) =>
    inCohort(stateByLiteral.get(lit)!, mode),
  );
  if (literals.length === 0) return [];

  const overrides = new Map<string, string>();
  const storyByLiteral = new Map<string, string>();
  const noteRows = await userDb.getAllAsync<{
    literal: string;
    keyword: string | null;
    mnemonic: string | null;
  }>(`SELECT literal, keyword, mnemonic FROM user_kanji_notes WHERE deleted_at IS NULL`, []);
  for (const n of noteRows) {
    if (n.keyword) overrides.set(n.literal, n.keyword);
    if (n.mnemonic) storyByLiteral.set(n.literal, n.mnemonic);
  }

  const heisig = new Map<string, string>();
  const chars = await getKanjiBatchAsync(dictDb, literals);
  for (const c of chars) if (c.heisigKeyword) heisig.set(c.literal, c.heisigKeyword);

  const primsByLiteral = new Map<string, ArenaPrimitive[]>();
  if (strokesDb) {
    await Promise.all(
      literals.map(async (lit) => {
        try {
          const parts = await getPrimitivesForKanjiAsync(strokesDb, lit);
          const prims = parts
            .filter((p) => p.keyword !== PRIMITIVE_SENTINEL)
            .map((p): ArenaPrimitive | null => {
              // A real Unicode glyph when the primitive is itself a kanji; else
              // the RTK substitute char drawn in the bundled primitive font.
              const glyph = p.glyph && p.glyph.trim() ? p.glyph : undefined;
              const display = !glyph && p.displayGlyph ? p.displayGlyph : undefined;
              const keyword = p.keyword ?? "";
              if (!glyph && !display && !keyword) return null;
              return { keyword, glyph, display };
            })
            .filter((p): p is ArenaPrimitive => p !== null);
          if (prims.length) primsByLiteral.set(lit, prims);
        } catch {
          // primitives are supplemental — a lookup failure must not sink the session
        }
      }),
    );
  }

  const cards: ArenaCard[] = [];
  for (const lit of literals) {
    const keyword = overrides.get(lit) ?? heisig.get(lit);
    if (!keyword) continue;
    cards.push({
      token: lit,
      kanji: lit,
      keyword,
      state: stateByLiteral.get(lit),
      primitives: primsByLiteral.get(lit) ?? [],
      story: storyByLiteral.get(lit),
    });
  }
  return cards;
}
