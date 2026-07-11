import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundle the Phaser game to a single self-contained IIFE. PNG spritesheets are
// inlined as data URIs so the bundle needs no network or asset files; minify to
// keep the (Phaser-inclusive) string down. Output is a JS string the host
// inlines into the WebView HTML.
const result = buildSync({
  entryPoints: [resolve(__dirname, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  loader: { ".png": "dataurl", ".json": "json" },
  write: false,
});

const jsCode = result.outputFiles[0].text;

writeFileSync(
  resolve(__dirname, "bundle.ts"),
  `// AUTO-GENERATED — do not edit. Run: yarn build:arena\nexport const arenaBundle = ${JSON.stringify(jsCode)};\n`,
);

console.log(`arena bundle built successfully (${(jsCode.length / 1024).toFixed(0)} KB)`);

// Embed the RTK primitive font so the sandboxed game HTML can draw invented
// primitive shapes (via displayGlyph) — the game never inherits the host app's
// loaded fonts. Emitted as base64 for a data-URI @font-face in arena-html.ts.
const fontB64 = readFileSync(resolve(__dirname, "../../assets/fonts/RtkPrimitives.ttf")).toString(
  "base64",
);
writeFileSync(
  resolve(__dirname, "src/font-data.ts"),
  `// AUTO-GENERATED — do not edit. Run: yarn build:arena\nexport const rtkPrimitivesBase64 = ${JSON.stringify(fontB64)};\n`,
);
console.log(`rtk primitive font embedded (${(fontB64.length / 1024).toFixed(0)} KB base64)`);
