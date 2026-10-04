import type { CardFace, DictEntry, KanjiCharacter } from "@/db/types";

/**
 * What a flashcard shows, and in what order. Lives here rather than inside the
 * study screen so a face can be reasoned about — and tested — without mounting
 * three thousand lines of it.
 */

/** Every face, in the order a card stacks them. */
export const CARD_FACES: readonly CardFace[] = ["kanji", "keyword", "kana", "english", "mnemonic"];

export function isCardFace(value: unknown): value is CardFace {
  return typeof value === "string" && (CARD_FACES as readonly string[]).includes(value);
}

/**
 * Faces as stored — a JSON string or an array — reduced to the ones this build
 * knows. A list configured on a newer build can name a face this one has never
 * heard of; dropping it shows fewer faces, where keeping it showed a blank one,
 * because every lookup past this point assumes the face exists.
 */
export function parseFaces(raw: unknown, fallback: CardFace[]): CardFace[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [...fallback];
    }
  }
  if (!Array.isArray(value)) return [...fallback];
  const faces = value.filter(isCardFace);
  return faces.length > 0 ? faces : [...fallback];
}

/** Unknown faces sort last rather than comparing NaN and scrambling the rest. */
const FACE_RANK: Record<CardFace, number> = {
  kanji: 0,
  keyword: 1,
  kana: 2,
  english: 3,
  mnemonic: 4,
};

export function faceRank(face: string): number {
  return (FACE_RANK as Record<string, number | undefined>)[face] ?? CARD_FACES.length;
}

export function sortFaces(faces: CardFace[]): CardFace[] {
  return [...faces].sort((a, b) => faceRank(a) - faceRank(b));
}

/**
 * The faces a card can actually show, never empty. Every face but `kanji` can
 * come up blank — 9,849 of the 12,849 kanji have no Heisig keyword, and most
 * have no story — and a card whose only face has nothing to render is a card
 * the learner cannot answer, with no way to tell it from a bug.
 */
export function shownFaces(
  faces: CardFace[],
  canRender: (face: CardFace) => boolean,
  /** Tried in order when nothing the learner chose can render. */
  fallbacks: CardFace[] = ["kanji"],
): CardFace[] {
  const shown = faces.filter(canRender);
  if (shown.length > 0) return shown;
  // `kanji` last and unconditionally: it is the only face that always renders,
  // and a card has to show something.
  return [fallbacks.find(canRender) ?? "kanji"];
}

/** The learner's own keyword if they set one, else Heisig's. */
export function resolveKeywordFace(
  userKeyword: string | null | undefined,
  heisigKeyword: string | null | undefined,
): string {
  return userKeyword?.trim() || heisigKeyword?.trim() || "";
}

export function getFaceText(entry: DictEntry, face: CardFace): string {
  switch (face) {
    case "kanji":
      return entry.kanji[0]?.text ?? entry.kana[0]?.text ?? "";
    case "kana":
      return entry.kana[0]?.text ?? "";
    case "english": {
      const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
      const parts = entry.senses.map((sense, i) => {
        const glosses = sense.glosses.filter((g) => g.lang === "eng").map((g) => g.text);
        if (glosses.length === 0) return null;
        const text = glosses.join(", ");
        return entry.senses.length > 1 ? `${CIRCLED[i] ?? `(${i + 1})`} ${text}` : text;
      });
      return parts.filter(Boolean).join(" ");
    }
    // A word has no RTK frame and no story of its own: both are rendered by the
    // screen from the kanji's notes, and neither applies here.
    case "keyword":
    case "mnemonic":
      return "";
  }
}

export function getKanjiFaceText(kanji: KanjiCharacter, face: CardFace): string {
  switch (face) {
    case "kanji":
      return kanji.literal;
    case "kana":
      return [...kanji.readingsOn, ...kanji.readingsKun].join("、");
    case "english":
      return kanji.meanings.join(", ");
    // Heisig's keyword is the fallback; the learner's override reaches the
    // screen through user_kanji_notes, which this row does not carry.
    case "keyword":
      return kanji.heisigKeyword ?? "";
    case "mnemonic":
      return "";
  }
}
