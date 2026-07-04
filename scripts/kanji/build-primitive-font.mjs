/**
 * Build the bundled RTK primitive font: subset the proprietary "Remembering the
 * Kanji" iOS app font (KanjiBooks.ttf) down to just the ~244 substitute codepoints
 * that render as invented-primitive shapes (e.g. U+5C46 屆 → 宀 "house").
 *
 * The full font is proprietary and NOT committed. This script reads it locally and
 * emits assets/fonts/RtkPrimitives.ttf (the small, committed subset). Primitives are
 * rendered at runtime by drawing `primitives.display_glyph` in this font.
 *
 * Usage: yarn build:primitive-font   (RTK_BOOKS_FONT overrides the source font path)
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SRC_FONT =
  process.env.RTK_BOOKS_FONT || "/Applications/Kanji.app/Wrapper/Heisig.app/KanjiBooks.ttf";
const PRIMS_JSON = path.join(PROJECT_ROOT, "data", "rtk-primitives.json");
const OUT_FONT = path.join(PROJECT_ROOT, "assets", "fonts", "RtkPrimitives.ttf");

if (!fs.existsSync(SRC_FONT)) {
  console.error(`Source font not found at: ${SRC_FONT}\nSet RTK_BOOKS_FONT to override.`);
  process.exit(1);
}

// Every distinct codepoint across all substitute glyphs (a few are multi-char, e.g.
// a base glyph plus a positioning dot — iterate code points, don't assume one each).
const prims = JSON.parse(fs.readFileSync(PRIMS_JSON, "utf8")).primitives;
const codepoints = new Set();
for (const p of Object.values(prims)) {
  for (const ch of p.displayGlyph || "") codepoints.add(ch.codePointAt(0));
}
const unicodes = [...codepoints].map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`);

fs.mkdirSync(path.dirname(OUT_FONT), { recursive: true });

// pyftsubset silently omits codepoints the source lacks (2 of 244 are absent from
// KanjiBooks) rather than erroring — exactly what we want.
execFileSync(
  "python3",
  ["-m", "fontTools.subset", SRC_FONT, `--unicodes=${unicodes.join(",")}`, `--output-file=${OUT_FONT}`],
  { stdio: ["ignore", "ignore", "inherit"] },
);

// The subset must preserve every codepoint the source font actually has (a few of
// the 244 are absent from KanjiBooks upstream — gate on that, not a magic constant).
const coverageOf = (font) =>
  Number(
    execFileSync("python3", [
      "-c",
      `from fontTools.ttLib import TTFont;import sys;cm=TTFont(sys.argv[1]).getBestCmap();` +
        `cps=[${[...codepoints].join(",")}];print(sum(1 for c in cps if c in cm))`,
      font,
    ])
      .toString()
      .trim(),
  );

const total = codepoints.size;
const srcCov = coverageOf(SRC_FONT);
const outCov = coverageOf(OUT_FONT);
const sizeKb = (fs.statSync(OUT_FONT).size / 1024).toFixed(1);
if (outCov < srcCov) {
  console.error(`VALIDATION FAILED: subset dropped glyphs (${outCov}/${srcCov} the source has)`);
  process.exit(1);
}
console.log(
  `Wrote ${OUT_FONT}\n  ${sizeKb} KB  coverage ${outCov}/${total} codepoints (source provides ${srcCov})`,
);
