/**
 * Extract the official "Remembering the Kanji" iOS app Core Data SQLite into a
 * normalized JSON used by the jiten dictionary build (primitive decomposition +
 * keywords + RTK frame numbers).
 *
 * The raw app DB is proprietary and NOT committed. This script reads it locally
 * and emits data/rtk-primitives.json (the committed, derived artifact).
 *
 * Usage: yarn build:rtk   (RTK_APP_DB overrides the default DB path)
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DB_PATH =
  process.env.RTK_APP_DB || "/Applications/Kanji.app/Wrapper/Heisig.app/Heisig3.17.sqlite";
const OUT_PATH = path.join(PROJECT_ROOT, "data", "rtk-primitives.json");

// A "real kanji" = a Unicode unified ideograph (renders in normal fonts and can
// deep-link to jiten's kanji page). Excludes PUA substitute glyphs (E000-F8FF)
// the RTK app uses for invented primitives.
function isRealKanji(ch) {
  if (!ch || [...ch].length !== 1) return false;
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ffff)
  );
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`RTK app DB not found at: ${DB_PATH}\nSet RTK_APP_DB to override.`);
  process.exit(1);
}

// Query via the sqlite3 CLI in JSON mode — avoids native-module ABI coupling to
// the running Node version.
function q(sql) {
  let out;
  try {
    out = execFileSync("sqlite3", ["-json", "-readonly", DB_PATH, sql], {
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error("`sqlite3` CLI not found on PATH — install it to run this extractor.");
      process.exit(1);
    }
    throw err;
  }
  const s = out.toString().trim();
  return s ? JSON.parse(s) : [];
}

const glyphByPk = new Map();
for (const g of q("SELECT Z_PK, ZDISPLAY_GLYPH, ZPRIMITIVE, ZSTROKECOUNT FROM ZGLYPH")) {
  glyphByPk.set(g.Z_PK, {
    display: g.ZDISPLAY_GLYPH,
    primitiveId: g.ZPRIMITIVE ?? null,
    strokes: g.ZSTROKECOUNT ?? null,
  });
}

const mainKw = new Map();
for (const k of q("SELECT ZGLYPH, ZKEYWORD FROM ZKEYWORD WHERE ZIS_MAIN = 1")) {
  mainKw.set(k.ZGLYPH, k.ZKEYWORD);
}

const frameByPk = new Map();
for (const f of q(
  "SELECT ZGLYPH, ZFRAME_NUMBER FROM ZFRAME WHERE ZEDITION = 1 AND ZFRAME_TYPE = 0",
)) {
  frameByPk.set(f.ZGLYPH, f.ZFRAME_NUMBER);
}

const decompByParent = new Map();
for (const d of q(
  `SELECT ZGLYPH, ZDECOMPOSITION_NUMBER, ZSOURCE_GLYPH, ZFONT_TYPE, ZDISPLAY_GLYPH, ZKEYWORD
   FROM ZDECOMPOSITION ORDER BY ZGLYPH, ZDECOMPOSITION_NUMBER`,
)) {
  const src = d.ZSOURCE_GLYPH != null ? glyphByPk.get(d.ZSOURCE_GLYPH) : null;
  const primitiveId = src ? src.primitiveId : null;
  const isPrimitive = d.ZFONT_TYPE === 2 || primitiveId != null;
  // Only ZFONT_TYPE 2 uses substitute codepoints (e.g. 屆 rendering as 宀) that
  // display in the app's private font only — null those and label by keyword.
  // ZFONT_TYPE 1 is a real Unicode glyph even when it doubles as a primitive, so
  // keep it (still linkable via primitiveId).
  const glyph =
    d.ZFONT_TYPE === 2
      ? null
      : src && isRealKanji(src.display)
        ? src.display
        : isRealKanji(d.ZDISPLAY_GLYPH)
          ? d.ZDISPLAY_GLYPH
          : null;
  const entry = { keyword: d.ZKEYWORD || null, glyph, primitiveId, isPrimitive };
  if (!decompByParent.has(d.ZGLYPH)) decompByParent.set(d.ZGLYPH, []);
  decompByParent.get(d.ZGLYPH).push(entry);
}

const primitives = {};
for (const [pk, g] of glyphByPk) {
  if (g.primitiveId == null) continue;
  // Primitive display glyphs are private-font substitutes, not reliably real
  // Unicode — keep the substitute for reference but do not treat it as
  // renderable. A curated primitive→radical map can supply realGlyph later.
  primitives[g.primitiveId] = {
    keyword: mainKw.get(pk) ?? null,
    displayGlyph: g.display,
    realGlyph: null,
    strokes: g.strokes,
  };
}

// Many real kanji have TWO ZGLYPH rows: the kanji (frame-bearing, ZPRIMITIVE
// null) and a same-glyph primitive row (no frame). Pick the best row per literal
// so a primitive row never clobbers the real kanji: prefer a non-primitive row,
// then a frame-bearing one.
const bestByLiteral = new Map();
const rank = (pk, g) => (g.primitiveId == null ? 2 : 0) + (frameByPk.has(pk) ? 1 : 0);
for (const [pk, g] of glyphByPk) {
  if (!isRealKanji(g.display)) continue;
  const cur = bestByLiteral.get(g.display);
  if (!cur || rank(pk, g) > rank(cur.pk, cur.g)) bestByLiteral.set(g.display, { pk, g });
}

const kanji = {};
for (const [display, { pk, g }] of bestByLiteral) {
  kanji[display] = {
    keyword: mainKw.get(pk) ?? null,
    frame: frameByPk.get(pk) ?? null,
    strokes: g.strokes,
    primitives: decompByParent.get(pk) ?? [],
  };
}

const out = {
  _source: "Remembering the Kanji iOS app (Heisig) Core Data DB — proprietary, derived",
  _generated: "run `yarn build:rtk` to regenerate from a local RTK app install",
  kanjiCount: Object.keys(kanji).length,
  primitiveCount: Object.keys(primitives).length,
  kanji,
  primitives,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 0));

// ── Validation ──
const sen = kanji["宣"];
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`VALIDATION FAILED: ${msg}`);
    process.exit(1);
  }
};
assert(sen, "宣 missing");
assert(sen.keyword === "proclaim", `宣 keyword = ${sen && sen.keyword}`);
assert(sen.frame === 200, `宣 frame = ${sen && sen.frame}`);
assert(sen.primitives.map((p) => p.keyword).join(",") === "house,span", "宣 primitives wrong");
// Regression: 乳 has both a real-kanji row (milk, frame 786) and a same-glyph
// primitive row (human legs) — the real kanji must win.
const milk = kanji["乳"];
assert(milk && milk.keyword === "milk", `乳 keyword = ${milk && milk.keyword}`);
assert(milk && milk.frame === 786, `乳 frame = ${milk && milk.frame}`);
assert(Object.keys(kanji).length >= 2200, `only ${Object.keys(kanji).length} kanji`);
assert(Object.keys(primitives).length >= 240, `only ${Object.keys(primitives).length} primitives`);

console.log(
  `Wrote ${OUT_PATH}\n  kanji: ${out.kanjiCount}  primitives: ${out.primitiveCount}\n  宣 -> ${sen.keyword} [${sen.primitives.map((p) => `${p.glyph ?? "·"}=${p.keyword}`).join(", ")}]`,
);
