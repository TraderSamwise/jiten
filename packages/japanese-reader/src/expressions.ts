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
 */

const MAX_KANA_BETWEEN_ANCHORS = 4;
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
}

interface IndexedExpression {
  entryId: number;
  form: string;
  slots: Slot[];
  /** How many kanji of the phrase precede the anchor pair. */
  kanjiBeforeAnchor: number;
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
  for (const item of prepared) {
    for (const slot of item.slots) {
      if (slot.kind === "word") slot.inflects = inflecting.has(slot.text);
    }
  }

  // Anchor on the rarest adjacent kanji pair, so a common leading kanji like 気
  // or 事 does not drag its whole bucket into every verification.
  const pairFrequency = new Map<string, number>();
  for (const item of prepared) {
    for (let i = 0; i + 1 < item.kanji.length; i++) {
      const pair = item.kanji[i] + item.kanji[i + 1];
      pairFrequency.set(pair, (pairFrequency.get(pair) ?? 0) + 1);
    }
  }

  const byAnchor = new Map<string, IndexedExpression[]>();
  let size = 0;
  for (const item of prepared) {
    if (item.kanji.length < 2) continue;
    let anchorIndex = 0;
    let rarest = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < item.kanji.length; i++) {
      const count = pairFrequency.get(item.kanji[i] + item.kanji[i + 1]) ?? 0;
      if (count < rarest) {
        rarest = count;
        anchorIndex = i;
      }
    }
    const anchor = item.kanji[anchorIndex] + item.kanji[anchorIndex + 1];
    const list = byAnchor.get(anchor) ?? [];
    list.push({
      entryId: item.entryId,
      form: item.form,
      slots: item.slots,
      kanjiBeforeAnchor: anchorIndex,
    });
    byAnchor.set(anchor, list);
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

function reachesSlot(candidate: string, slot: string): boolean {
  return deinflect(candidate).some(
    (form) => form.word === slot && !form.reasons.some((r) => AMBIGUOUS_WITH_TRANSITIVE.has(r)),
  );
}

/** Match one word slot at `at`, returning how many characters it consumed. */
function matchWordSlot(slot: Slot, at: number, chars: string[]): number {
  const want = [...slot.text];
  if (at + want.length <= chars.length) {
    let same = true;
    for (let i = 0; i < want.length; i++) {
      if (chars[at + i] !== want[i]) {
        same = false;
        break;
      }
    }
    if (same) return want.length;
  }
  if (!slot.inflects) return 0;

  // The stem has to survive, so never shrink past the leading non-kana run.
  let stem = 0;
  while (stem < want.length && isExpressionKanji(want[stem])) stem++;
  const shortest = Math.max(1, stem);
  for (
    let len = Math.min(want.length + MAX_INFLECTION_GROWTH, chars.length - at);
    len >= shortest;
    len--
  ) {
    const candidate = chars.slice(at, at + len).join("");
    if (candidate === slot.text) return len;
    if (reachesSlot(candidate, slot.text)) return len;
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
  for (let k = 0; k + 1 < kanjiAt.length; k++) {
    if (kanjiAt[k + 1] - kanjiAt[k] - 1 > MAX_KANA_BETWEEN_ANCHORS) continue;
    const bucket = index.byAnchor.get(chars[kanjiAt[k]] + chars[kanjiAt[k + 1]]);
    if (!bucket) continue;

    for (const candidate of bucket) {
      const anchorKanji = k - candidate.kanjiBeforeAnchor;
      if (anchorKanji < 0) continue;
      const start = kanjiAt[anchorKanji];
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
