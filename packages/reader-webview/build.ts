import { buildSync } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
const distDir = resolve(__dirname, "dist");

writeFileSync(
  resolve(__dirname, "bundle.ts"),
  `// AUTO-GENERATED — do not edit. Run: yarn build:reader\nexport const readerBundle = ${JSON.stringify(jsCode)};\nexport const readerCss = ${JSON.stringify(cssCode)};\n`,
);

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
writeFileSync(
  resolve(distDir, "bundle.js"),
  `export const readerBundle = ${JSON.stringify(jsCode)};\nexport const readerCss = ${JSON.stringify(cssCode)};\n`,
);
writeFileSync(
  resolve(distDir, "bundle.d.ts"),
  "export declare const readerBundle: string;\nexport declare const readerCss: string;\n",
);
writeFileSync(resolve(distDir, "index.js"), 'export * from "./bundle.js";\n');
writeFileSync(resolve(distDir, "index.d.ts"), 'export * from "./bundle";\n');

console.log("reader bundle built successfully");
