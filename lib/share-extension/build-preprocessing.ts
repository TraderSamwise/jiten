import { buildSync } from "esbuild";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const result = buildSync({
  entryPoints: [resolve(__dirname, "preprocessing-src.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  write: false,
});

const jsCode = result.outputFiles[0].text;

writeFileSync(resolve(__dirname, "preprocessing.js"), jsCode);

console.log("share extension preprocessing.js built successfully");
