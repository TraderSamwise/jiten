/**
 * Faces are stored as JSON in `lists.front_faces` / `back_faces` and those rows
 * SYNC, so a list configured on a newer build reaches an older one naming a
 * face it has never heard of. Before `parseFaces` existed, that face survived
 * into FACE_ORDER (undefined → a NaN comparator) and into both face-text
 * switches (which fell through and returned undefined) — a silently blank card.
 */
import { describe, expect, it } from "vitest";

import type { DictEntry, KanjiCharacter } from "@/db/types";
import {
  CARD_FACES,
  shownFaces,
  faceRank,
  getFaceText,
  getKanjiFaceText,
  isCardFace,
  parseFaces,
  resolveKeywordFace,
  sortFaces,
} from "./card-faces";

const kanji = {
  literal: "日",
  readingsOn: ["ニチ", "ジツ"],
  readingsKun: ["ひ", "-び"],
  meanings: ["day", "sun", "Japan", "counter for days"],
  heisigKeyword: "day",
} as KanjiCharacter;

const word = {
  kanji: [{ text: "日曜日" }],
  kana: [{ text: "にちようび" }],
  senses: [{ glosses: [{ lang: "eng", text: "Sunday" }] }],
} as DictEntry;

describe("reading stored faces", () => {
  it("parses the JSON a list row holds", () => {
    expect(parseFaces('["keyword","mnemonic"]', ["kanji"])).toEqual(["keyword", "mnemonic"]);
  });

  it("takes an array as given", () => {
    expect(parseFaces(["kana"], ["kanji"])).toEqual(["kana"]);
  });

  it("drops a face this build has never heard of", () => {
    // The whole point: a newer build's face must not reach a lookup.
    expect(parseFaces('["kanji","holographic"]', ["kanji"])).toEqual(["kanji"]);
  });

  it("falls back rather than showing a card with no faces at all", () => {
    expect(parseFaces('["holographic"]', ["english"])).toEqual(["english"]);
    expect(parseFaces("[]", ["kanji"])).toEqual(["kanji"]);
    expect(parseFaces(null, ["kanji"])).toEqual(["kanji"]);
    expect(parseFaces("not json", ["kanji"])).toEqual(["kanji"]);
    expect(parseFaces(7, ["kanji"])).toEqual(["kanji"]);
  });

  it("keeps the order a list stored, not the canonical one", () => {
    expect(parseFaces('["english","kanji"]', ["kanji"])).toEqual(["english", "kanji"]);
  });

  it("leaves a duplicate alone rather than deciding for the caller", () => {
    expect(parseFaces('["kanji","kanji"]', ["english"])).toEqual(["kanji", "kanji"]);
  });

  it("never hands back the fallback array itself", () => {
    const fallback: ("kanji" | "english")[] = ["kanji"];
    const parsed = parseFaces("[]", fallback);
    parsed.push("english");
    expect(fallback).toEqual(["kanji"]);
  });

  it("knows which strings are faces", () => {
    expect(isCardFace("keyword")).toBe(true);
    expect(isCardFace("holographic")).toBe(false);
    expect(isCardFace(undefined)).toBe(false);
  });
});

describe("ordering faces", () => {
  it("stacks the prompt above the readings and the gloss", () => {
    expect(sortFaces(["mnemonic", "english", "keyword", "kana", "kanji"])).toEqual([
      "kanji",
      "keyword",
      "kana",
      "english",
      "mnemonic",
    ]);
  });

  it("ranks every face it knows", () => {
    for (const face of CARD_FACES) expect(faceRank(face)).toBeLessThan(CARD_FACES.length);
  });

  it("sorts an unknown face last instead of scrambling the rest", () => {
    const faces = ["english", "holographic", "kanji"] as Parameters<typeof sortFaces>[0];
    expect(sortFaces(faces)).toEqual(["kanji", "english", "holographic"]);
  });
});

describe("the keyword face", () => {
  it("prefers the learner's own keyword", () => {
    expect(resolveKeywordFace("sunrise", "day")).toBe("sunrise");
  });

  it("falls back to Heisig's", () => {
    expect(resolveKeywordFace(null, "day")).toBe("day");
    expect(resolveKeywordFace("   ", "day")).toBe("day");
  });

  it("is empty when neither exists", () => {
    expect(resolveKeywordFace(null, null)).toBe("");
  });

  it("shows Heisig's keyword, not the dictionary's meanings", () => {
    // The bug this face exists for: a graduated 日 was asked as
    // "day, sun, Japan, counter for days".
    expect(getKanjiFaceText(kanji, "keyword")).toBe("day");
    expect(getKanjiFaceText(kanji, "english")).toBe("day, sun, Japan, counter for days");
  });

  it("has nothing to say about a word card", () => {
    expect(getFaceText(word, "keyword")).toBe("");
  });
});

describe("the other faces, unchanged", () => {
  it("renders a kanji card", () => {
    expect(getKanjiFaceText(kanji, "kanji")).toBe("日");
    expect(getKanjiFaceText(kanji, "kana")).toBe("ニチ、ジツ、ひ、-び");
    expect(getKanjiFaceText(kanji, "mnemonic")).toBe("");
  });

  it("renders a word card", () => {
    expect(getFaceText(word, "kanji")).toBe("日曜日");
    expect(getFaceText(word, "kana")).toBe("にちようび");
    expect(getFaceText(word, "english")).toBe("Sunday");
  });

  it("numbers the senses of a word with more than one", () => {
    const many = {
      kanji: [{ text: "明日" }],
      kana: [{ text: "あした" }],
      senses: [
        { glosses: [{ lang: "eng", text: "tomorrow" }] },
        { glosses: [{ lang: "eng", text: "near future" }] },
      ],
    } as DictEntry;
    expect(getFaceText(many, "english")).toBe("① tomorrow ② near future");
  });
});

describe("what a card can actually show", () => {
  const can = (faces: string[]) => (face: string) => faces.includes(face);

  it("drops the faces that have nothing to render", () => {
    expect(shownFaces(["kanji", "keyword"], can(["kanji"]))).toEqual(["kanji"]);
  });

  it("falls back to the character rather than showing a blank card", () => {
    // 9,849 of 12,849 kanji have no Heisig keyword. A front of ["keyword"] on
    // one of those used to render nothing at all — unanswerable, and
    // indistinguishable from a bug.
    expect(shownFaces(["keyword"], can([]))).toEqual(["kanji"]);
    expect(shownFaces(["mnemonic"], can([]))).toEqual(["kanji"]);
  });

  it("keeps a renderable face rather than reaching for the fallback", () => {
    expect(shownFaces(["keyword", "english"], can(["english"]))).toEqual(["english"]);
  });

  it("takes the first fallback that can render, for the answer side", () => {
    // The back of a card is the answer: the keyword beats the character, which
    // would otherwise appear under itself and read as a bug.
    expect(
      shownFaces(["mnemonic"], can(["keyword", "kanji"]), ["keyword", "english", "kanji"]),
    ).toEqual(["keyword"]);
    expect(
      shownFaces(["mnemonic"], can(["english", "kanji"]), ["keyword", "english", "kanji"]),
    ).toEqual(["english"]);
  });

  it("falls back to the character when no preference can render", () => {
    expect(shownFaces(["mnemonic"], can([]), ["keyword", "english"])).toEqual(["kanji"]);
    expect(shownFaces([], can([]))).toEqual(["kanji"]);
  });

  it("keeps every renderable face, in order", () => {
    expect(shownFaces(["kanji", "kana", "english"], can(["kanji", "kana", "english"]))).toEqual([
      "kanji",
      "kana",
      "english",
    ]);
  });
});
