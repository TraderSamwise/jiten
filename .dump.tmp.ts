import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "fs";
import { smartLookupWithOffset } from "./packages/japanese-reader/src/lookup";
import type { ReaderSqlDb } from "./packages/japanese-reader/src/backend";
const open = (p: string): ReaderSqlDb => {
  const db = new Database(p, { readonly: true });
  return {
    getAllAsync: async <T>(s: string, q?: unknown[]) =>
      (q ? db.prepare(s).all(...(q as never[])) : db.prepare(s).all()) as T[],
    getFirstAsync: async <T>(s: string, q?: unknown[]) =>
      ((q ? db.prepare(s).get(...(q as never[])) : db.prepare(s).get()) as T) ?? null,
  };
};
async function main() {
  const dict = open("assets/dictionary.db"),
    ext = open("assets/dictionary-extended.db");
  const corpus = readFileSync("test/corpus/bocchan.txt", "utf8").replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < corpus.length; i++) {
    if (/[、。「」『』（）]/.test(corpus[i])) continue;
    const from = Math.max(0, i - 24);
    const h = (await smartLookupWithOffset(corpus.slice(from, i + 24), i - from, dict, ext))[0];
    lines.push(`${i}\t${h?.matchedText ?? ""}\t${h?.entries?.[0]?.id ?? ""}`);
  }
  writeFileSync(process.argv[2], lines.join("\n") + "\n");
  console.log(lines.length, "taps");
}
void main();
