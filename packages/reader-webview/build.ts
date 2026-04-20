import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const result = buildSync({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  write: false,
});

const jsCode = result.outputFiles[0].text;
const cssCode = readFileSync(resolve(__dirname, "reader.css"), "utf-8");

writeFileSync(
  resolve(__dirname, "bundle.ts"),
  `// AUTO-GENERATED — do not edit. Run: yarn build:reader\nexport const readerBundle = ${JSON.stringify(jsCode)};\nexport const readerCss = ${JSON.stringify(cssCode)};\n`,
);

console.log("reader bundle built successfully");
