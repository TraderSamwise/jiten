import { deinflect } from "./deinflect";
import type { ReaderSqlDb } from "./backend";

/**
 * Finding set phrases in a slice of text.
 *
 * JMdict holds ~19k multi-token expressions, and a book almost never writes one
 * the way the dictionary spells it: 目の玉が飛び出る appears as 目の玉の飛び出る,
 * 腹が立つ as 腹が立てば, 口に入る as 口へ入れて. Exact-surface lookup misses all
 * of those, which is why tapping inside an idiom lands on one of its words.
 *
 * Every one of those differences is in the *kana*. So:
 *
 *   Stage 1 anchors on kanji. Each expression is indexed by the rarest pair of
 *   adjacent kanji it contains, and a scan hashes each adjacent kanji pair in
 *   the text. Inflection and particle substitution leave the pair intact, so
 *   this is a cheap, recall-first filter — O(kanji in the slice).
 *
 *   Stage 2 verifies exactly. An expression is a sequence of typed slots: a
 *   word slot matches literally or through the deinflector, a particle slot may
 *   swap within its grammatical class, and everything else must appear as
 *   written. Stage 1 is allowed to be loose because stage 2 is strict.
 *
 * Known limit: a phrase whose only remaining kanji is a common one cannot be
 * anchored. 気を持たせる written 気をもたせる leaves just 気, and 気を fires on so
 * much ordinary text that indexing it costs more than the phrase is worth.
 * Reaching those needs an index over readings rather than over kanji.
 */

const ANCHOR_START_SLACK = 2;
const MAX_FALLBACK_BUCKET = 12;
const MAX_INFLECTION_GROWTH = 6;

/**
 * Particles that may stand in for the one the dictionary lists. が/は/も trade
 * places as subject, topic and emphasis; に and へ both mark a goal; and が
 * becomes の on the subject of a relative clause, which is 目の玉が飛び出る
 * appearing as 目の玉の飛び出る. Nothing else substitutes — を, で, と and から
 * change the meaning, and reading の as が produced うちの人 matching うちが人.
 */
const PARTICLE_SWAPS: Record<string, string> = {
  が: "がはもの",
  は: "がはも",
  も: "がはも",
  に: "にへ",
  へ: "にへ",
};

const PARTICLES = new Set(["が", "を", "に", "は", "へ", "の", "と", "で", "も", "や", "か"]);

export function isExpressionKanji(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

type SlotKind = "word" | "particle" | "literal";

interface Slot {
  kind: SlotKind;
  text: string;
  /** Word slots only: the dictionary says this can conjugate. */
  inflects: boolean;
  /** Word slots only: the same word spelled in kana, when the dictionary has it. */
  kana?: string;
}

interface IndexedExpression {
  entryId: number;
  form: string;
  slots: Slot[];
  /** Characters of the phrase before its anchor, bounding where a match may start. */
  charsBeforeAnchor: number;
}

export interface ExpressionIndex {
  byAnchor: Map<string, IndexedExpression[]>;
  size: number;
}

export interface ExpressionMatch {
  /** Character offset into the scanned text. */
  start: number;
  length: number;
  /** The span as the text writes it. */
  surface: string;
  /** The dictionary's spelling. */
  form: string;
  entryId: number;
}

/**
 * Split a dictionary form on its particles. Everything between them is one word
 * slot — 無理もない is 無理 / も / ない, not 無 / 理 / も / ない — and a word slot
 * that the dictionary knows as a verb or adjective is allowed to inflect.
 */
function tokenize(form: string): Slot[] {
  const chars = [...form];
  const slots: Slot[] = [];
  let i = 0;
  while (i < chars.length) {
    if (PARTICLES.has(chars[i])) {
      slots.push({ kind: "particle", text: chars[i], inflects: false });
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && !PARTICLES.has(chars[j])) j++;
    slots.push({ kind: "word", text: chars.slice(i, j).join(""), inflects: false });
    i = j;
  }

  // A particle at either end belongs to the phrase's shape rather than being a
  // slot in it — に in に対する is what makes the phrase, not a swappable role.
  if (slots.length > 0 && slots[0].kind === "particle") slots[0].kind = "literal";
  const last = slots.length - 1;
  if (last > 0 && slots[last].kind === "particle") slots[last].kind = "literal";
  return slots;
}

/**
 * Windows of a kanji followed by a particle that cannot be swapped away. The
 * particle is fixed and the kanji is one character, so this anchor survives a
 * following word being spelled in kana.
 */
function particleAnchorsOf(form: string): { text: string; at: number }[] {
  const chars = [...form];
  const out: { text: string; at: number }[] = [];
  for (let i = 0; i + 1 < chars.length; i++) {
    if (!isExpressionKanji(chars[i])) continue;
    const next = chars[i + 1];
    if (!PARTICLES.has(next) || PARTICLE_SWAPS[next]) continue;
    out.push({ text: chars[i] + next, at: i });
  }
  return out;
}

/**
 * Build the index. One pass over JMdict's multi-token expressions, then one
 * batched query to learn which of their word slots can conjugate.
 */
export async function buildExpressionIndex(dictDb: ReaderSqlDb): Promise<ExpressionIndex> {
  const rows = await dictDb.getAllAsync<{ entry_id: number; text: string }>(
    `SELECT DISTINCT k.entry_id, k.text
     FROM kanji k
     JOIN senses s ON s.entry_id = k.entry_id
     WHERE s.part_of_speech LIKE '%"exp"%' AND LENGTH(k.text) >= 4`,
  );

  const prepared = rows.map((row) => ({
    entryId: row.entry_id,
    form: row.text,
    slots: tokenize(row.text),
    kanji: [...row.text].filter(isExpressionKanji),
  }));

  // Which slot texts are verbs or adjectives, and so may appear inflected.
  const slotTexts = new Set<string>();
  for (const item of prepared) {
    for (const slot of item.slots) if (slot.kind === "word") slotTexts.add(slot.text);
  }
  const inflecting = await loadInflectingForms(dictDb, [...slotTexts]);
  const kanaOf = await loadKanaSpellings(dictDb, [...slotTexts]);
  for (const item of prepared) {
    for (const slot of item.slots) {
      if (slot.kind !== "word") continue;
      slot.inflects = inflecting.has(slot.text);
      const kana = kanaOf.get(slot.text);
      if (kana && kana !== slot.text) slot.kana = kana;
    }
  }

  // Anchor on the rarest two-character window that starts at a kanji. Starting
  // at a kanji keeps the scan cheap — one lookup per kanji in the slice — and
  // taking the window rather than a kanji pair reaches the 4467 expressions
  // with only one kanji in them (あぐらを掻く, あげ足をとる). A window is only
  // usable if neither character can vary: a swappable particle would move, and
  // a second kanji could be written in kana instead.
  const anchorsOf = (form: string): { text: string; at: number }[] => {
    const chars = [...form];
    const kanjiAt: number[] = [];
    for (let i = 0; i < chars.length; i++) if (isExpressionKanji(chars[i])) kanjiAt.push(i);

    // Two kanji, skipping whatever kana lies between them. Kanji do not
    // inflect and particles sit between them, so the pair survives both kinds
    // of variation — 腹が立つ still shows 腹…立 in 腹が立てば and 腹の立つ.
    if (kanjiAt.length >= 2) {
      const out: { text: string; at: number }[] = [];
      for (let i = 0; i + 1 < kanjiAt.length; i++) {
        out.push({ text: chars[kanjiAt[i]] + chars[kanjiAt[i + 1]], at: kanjiAt[i] });
      }
      return out;
    }

    // One kanji: pair it with the character before it, which is fixed kana —
    // あぐらを掻く anchors on を掻, あげ足をとる on げ足. Anchoring on what
    // follows would not work, because that is the verb's own okurigana.
    if (kanjiAt.length === 1) {
      const at = kanjiAt[0];
      if (at > 0 && !PARTICLE_SWAPS[chars[at - 1]]) {
        return [{ text: chars[at - 1] + chars[at], at: at - 1 }];
      }
    }
    return [];
  };

  const anchorFrequency = new Map<string, number>();
  for (const item of prepared) {
    for (const anchor of [...anchorsOf(item.form), ...particleAnchorsOf(item.form)]) {
      anchorFrequency.set(anchor.text, (anchorFrequency.get(anchor.text) ?? 0) + 1);
    }
  }

  const byAnchor = new Map<string, IndexedExpression[]>();
  const rarestOf = (options: { text: string; at: number }[]) => {
    let chosen = options[0];
    let rarest = Number.POSITIVE_INFINITY;
    for (const option of options) {
      const count = anchorFrequency.get(option.text) ?? 0;
      if (count < rarest) {
        rarest = count;
        chosen = option;
      }
    }
    return chosen;
  };

  let size = 0;
  for (const item of prepared) {
    const options = anchorsOf(item.form);
    const anchors = options.length > 0 ? [rarestOf(options)] : [];

    // A kanji anchor is only there if the book spells that word in kanji, and
    // 92% of these phrases contain a word the dictionary also lists in kana —
    // 気を持たせる written 気をもたせる. Add a second anchor pinned to a particle,
    // which cannot be respelled, so those are still reachable.
    const fallback = particleAnchorsOf(item.form);
    if (fallback.length > 0) {
      const pick = rarestOf(fallback);
      // Particles are common in running text, so a crowded particle anchor
      // fires constantly and drags its whole bucket into verification. Past
      // this size it costs more than the recall it buys.
      const crowded = (anchorFrequency.get(pick.text) ?? 0) > MAX_FALLBACK_BUCKET;
      if (!crowded && !anchors.some((a) => a.text === pick.text)) anchors.push(pick);
    }
    if (anchors.length === 0) continue;

    for (const anchor of anchors) {
      const list = byAnchor.get(anchor.text) ?? [];
      list.push({
        entryId: item.entryId,
        form: item.form,
        slots: item.slots,
        charsBeforeAnchor: anchor.at,
      });
      byAnchor.set(anchor.text, list);
    }
    size++;
  }

  return { byAnchor, size };
}

async function loadInflectingForms(dictDb: ReaderSqlDb, texts: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const BATCH = 500;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = await dictDb.getAllAsync<{ text: string }>(
      `SELECT DISTINCT f.text FROM (
         SELECT entry_id, text FROM kanji WHERE text IN (${placeholders})
         UNION ALL
         SELECT entry_id, text FROM kana WHERE text IN (${placeholders})
       ) f
       JOIN senses s ON s.entry_id = f.entry_id
       WHERE s.part_of_speech LIKE '%"v%' OR s.part_of_speech LIKE '%"adj-i%'`,
      [...batch, ...batch],
    );
    for (const row of rows) found.add(row.text);
  }
  return found;
}

/**
 * Japanese pairs an intransitive godan verb with a transitive ichidan one —
 * 入る/入れる, 開く/開ける — and the transitive is spelled exactly like the
 * godan's え-row. So 蝦蟇口へ入れて reaches 入る by the potential rule and
 * satisfies 口に入る; 女をその中に入れた reaches it by the imperative. Both
 * readings exist, but inside a set phrase the transitive one is far commoner,
 * and JMdict lists the genuinely imperative phrases separately (持って来い).
 */
const AMBIGUOUS_WITH_TRANSITIVE = new Set(["potential", "imperative"]);

/**
 * The masu-stem rule turns any verb into itself-plus-one-kana, so a span that
 * needs it is almost always one character too greedy: 馬鹿にされていけない is
 * 馬鹿にされて followed by いけない, but されてい also deinflects to する. A set
 * phrase standing in its masu-stem is rare enough to trade away.
 */
const GREEDY_REASONS = new Set(["masu-stem"]);

function reachesSlot(candidate: string, slot: string): boolean {
  return deinflect(candidate).some(
    (form) =>
      form.word === slot &&
      !form.reasons.some((r) => AMBIGUOUS_WITH_TRANSITIVE.has(r) || GREEDY_REASONS.has(r)),
  );
}

/** The kana spelling of each word, so a slot written in kana still matches. */
async function loadKanaSpellings(
  dictDb: ReaderSqlDb,
  texts: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const BATCH = 500;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = await dictDb.getAllAsync<{ text: string; kana: string }>(
      `SELECT k.text AS text, MIN(ka.text) AS kana
       FROM kanji k
       JOIN kana ka ON ka.entry_id = k.entry_id
       WHERE k.text IN (${placeholders})
       GROUP BY k.text`,
      batch,
    );
    for (const row of rows) if (row.kana) found.set(row.text, row.kana);
  }
  return found;
}

function literalRun(spelling: string, at: number, chars: string[]): number {
  const want = [...spelling];
  if (at + want.length > chars.length) return 0;
  for (let i = 0; i < want.length; i++) if (chars[at + i] !== want[i]) return 0;
  return want.length;
}

/**
 * Match one word slot at `at`, returning how many characters it consumed.
 *
 * A book may write the word in kanji or in kana — 気を持たせる appears as
 * 気をもたせる — so both spellings are tried. The longest span that deinflects
 * wins, with the greedy rules above excluded so it cannot run one kana past
 * the end of the word.
 */
function matchWordSlot(slot: Slot, at: number, chars: string[]): number {
  const spellings = slot.kana && slot.kana !== slot.text ? [slot.text, slot.kana] : [slot.text];

  for (const spelling of spellings) {
    const exact = literalRun(spelling, at, chars);
    if (exact > 0) return exact;
  }
  if (!slot.inflects) return 0;

  for (const spelling of spellings) {
    const want = [...spelling];
    // The stem has to survive, so never shrink past the leading kanji run.
    let stem = 0;
    while (stem < want.length && isExpressionKanji(want[stem])) stem++;
    const shortest = Math.max(1, stem);
    const longest = Math.min(want.length + MAX_INFLECTION_GROWTH, chars.length - at);
    for (let len = longest; len >= shortest; len--) {
      if (reachesSlot(chars.slice(at, at + len).join(""), spelling)) return len;
    }
  }
  return 0;
}

function matchSlots(slots: Slot[], at: number, chars: string[]): number {
  let pos = at;
  for (const slot of slots) {
    if (slot.kind === "particle") {
      if (pos >= chars.length) return 0;
      const allowed = PARTICLE_SWAPS[slot.text] ?? slot.text;
      if (!allowed.includes(chars[pos])) return 0;
      pos++;
      continue;
    }
    if (slot.kind === "literal") {
      const want = [...slot.text];
      if (pos + want.length > chars.length) return 0;
      for (let i = 0; i < want.length; i++) if (chars[pos + i] !== want[i]) return 0;
      pos += want.length;
      continue;
    }
    const consumed = matchWordSlot(slot, pos, chars);
    if (consumed === 0) return 0;
    pos += consumed;
  }
  return pos - at;
}

/**
 * Every expression occurring in `text`. Overlapping matches resolve to the
 * longest; equal lengths resolve to the lower entry id so the result is stable.
 */
export function findExpressions(text: string, index: ExpressionIndex): ExpressionMatch[] {
  const chars = [...text];
  const kanjiAt: number[] = [];
  for (let i = 0; i < chars.length; i++) if (isExpressionKanji(chars[i])) kanjiAt.push(i);

  const matches: ExpressionMatch[] = [];
  for (let k = 0; k < kanjiAt.length; k++) {
    const at = kanjiAt[k];
    const buckets: IndexedExpression[][] = [];
    // A kanji pair, skipping the kana between them.
    if (k + 1 < kanjiAt.length) {
      const pair = index.byAnchor.get(chars[at] + chars[kanjiAt[k + 1]]);
      if (pair) buckets.push(pair);
    }
    // A single kanji with the character before it.
    if (at > 0) {
      const withPrefix = index.byAnchor.get(chars[at - 1] + chars[at]);
      if (withPrefix) buckets.push(withPrefix);
    }
    // A kanji with the particle after it, for phrases whose other words the
    // book spelled in kana.
    if (at + 1 < chars.length) {
      const withSuffix = index.byAnchor.get(chars[at] + chars[at + 1]);
      if (withSuffix) buckets.push(withSuffix);
    }
    if (buckets.length === 0) continue;

    for (const candidate of buckets.flat()) {
      // The phrase's prefix may be spelled differently in the text than in the
      // dictionary, so the anchor's offset within the form only bounds where
      // the phrase can start. Try each start rather than computing one.
      const earliest = Math.max(0, at - candidate.charsBeforeAnchor - ANCHOR_START_SLACK);
      for (let start = at; start >= earliest; start--) {
        // A kanji immediately before the phrase means its first noun is really
        // the tail of a longer compound — 冷汗 read as 汗を流す, 寝小便 as 小便をする.
        if (start > 0 && isExpressionKanji(chars[start - 1])) continue;
        const length = matchSlots(candidate.slots, start, chars);
        if (length === 0) continue;
        matches.push({
          start,
          length,
          surface: chars.slice(start, start + length).join(""),
          form: candidate.form,
          entryId: candidate.entryId,
        });
        break;
      }
    }
  }

  matches.sort((a, b) => b.length - a.length || a.start - b.start || a.entryId - b.entryId);
  const taken: ExpressionMatch[] = [];
  for (const match of matches) {
    const overlaps = taken.some(
      (t) => match.start < t.start + t.length && t.start < match.start + match.length,
    );
    if (!overlaps) taken.push(match);
  }
  return taken.sort((a, b) => a.start - b.start);
}
