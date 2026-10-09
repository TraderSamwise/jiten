import { describe, expect, it } from "vitest";
import { deinflect } from "./deinflect";

function bases(word: string): string[] {
  return deinflect(word).map((c) => c.word);
}

// ～ぬ is the ～ない of literary prose and the table only had ～ず. 広げた風呂敷を
// 畳まぬ therefore resolved nothing: the tap answered the mat 畳/たたみ and the
// furigana wrote じょう, the counter, over a verb.
describe("negative ～ぬ", () => {
  it("recovers godan dictionary forms", () => {
    expect(bases("畳まぬ")).toContain("畳む");
    expect(bases("知らぬ")).toContain("知る");
    expect(bases("言わぬ")).toContain("言う");
    expect(bases("書かぬ")).toContain("書く");
    expect(bases("急がぬ")).toContain("急ぐ");
    expect(bases("出さぬ")).toContain("出す");
    expect(bases("待たぬ")).toContain("待つ");
    expect(bases("死なぬ")).toContain("死ぬ");
    expect(bases("呼ばぬ")).toContain("呼ぶ");
  });

  it("recovers ichidan, suru and kuru dictionary forms", () => {
    expect(bases("見ぬ")).toContain("見る");
    expect(bases("消えぬ")).toContain("消える");
    expect(bases("せぬ")).toContain("する");
    expect(bases("来ぬ")).toContain("来る");
  });

  it("labels the reason", () => {
    expect(deinflect("畳まぬ").find((c) => c.word === "畳む")?.reasons).toEqual(["negative"]);
  });

  // 死ぬ is itself a ぬ-verb, so the te-form rule んで→ぬ hands these rules a
  // word that already ends in ぬ. Without RAW a second pass strips the ending
  // the first one produced and たくさんで comes back as 託す.
  it("fires on the text as written, never on another rule's output", () => {
    // The te-form rule んで→ぬ types these as ぬ-verbs; without RAW the negative
    // rules strip the ending it just produced. たくす is the word 託す is
    // spelled with, and asserting on 託す instead would be unfailable —
    // deinflect only ever returns the script it was handed.
    expect(bases("たくさんで")).not.toContain("たくす");
    expect(bases("飲んで")).not.toContain("飲る");
    expect(bases("読んで")).not.toContain("読る");
    expect(bases("言われたんだ")).not.toContain("言われつ");
    // ANY includes RAW, so a rule that emits it used to hand the next one a
    // surface that was never written: よぎなくさせる reached 余儀る three rules
    // deep, through the suru-noun strip.
    expect(bases("よぎなくさせる")).not.toContain("よぎる");
    // 死る is the ichidan rule reading 死 as a stem. No dictionary holds it, so
    // it costs a lookup and nothing else; 死ぬ keeps answering as itself.
    expect(bases("死ぬ")).toEqual(["死ぬ", "死る"]);
  });

  // These rules are guesses: 弛まぬ, でなく and いななく are themselves entries,
  // and a manufactured verb must not be allowed to answer them.
  it("marks what it produces as a guess", () => {
    const guessed = (word: string, base: string) =>
      deinflect(word).find((c) => c.word === base)?.guessed;
    expect(guessed("畳まぬ", "畳む")).toBe(true);
    expect(guessed("誘わなく", "誘う")).toBe(true);
    // でる, not 出る: deinflect returns the script it was handed.
    expect(guessed("でなく", "でる")).toBe(true);
    // The path that does not guess keeps its standing.
    expect(guessed("でなく", "でない")).toBe(false);
    expect(guessed("せわしなく", "せわしない")).toBe(false);
    expect(guessed("畳まぬ", "畳まぬ")).toBe(false);
  });
});

// 誘わなくなった had no path at all: the adjective rule く→い reaches 誘わない,
// which nothing spells, and types it ADJ so no verb rule can follow.
describe("negative adverbial ～なく and ～なくて", () => {
  it("recovers the verb the negative was built on", () => {
    expect(bases("誘わなく")).toContain("誘う");
    expect(bases("出なく")).toContain("出る");
    expect(bases("聞かなく")).toContain("聞く");
    expect(bases("心配しなく")).toContain("心配する");
    expect(bases("来なく")).toContain("来る");
  });

  it("handles the te-form of the negative", () => {
    expect(bases("誘わなくて")).toContain("誘う");
    expect(bases("鳴らなくて")).toContain("鳴る");
    expect(bases("食べなくて")).toContain("食べる");
  });

  it("labels the reason", () => {
    expect(deinflect("誘わなく").find((c) => c.word === "誘う")?.reasons).toEqual(["negative"]);
    expect(deinflect("誘わなくて").find((c) => c.word === "誘う")?.reasons).toEqual([
      "negative te-form",
    ]);
  });

  // お小遣い**が**なくて is a particle and ない, not a verb: が is あ-row and
  // cannot be an ichidan stem, so the bare rule must not reach がる.
  it("refuses a stem that cannot be an ichidan one", () => {
    expect(bases("お小遣いがなくて")).not.toContain("お小遣いがる");
    expect(bases("がなく")).not.toContain("がる");
    expect(bases("時間がなくて")).not.toContain("時間がる");
  });
});
