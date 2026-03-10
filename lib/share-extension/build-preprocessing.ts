import { buildSync } from "esbuild";
import { writeFileSync, existsSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

const result = buildSync({
  entryPoints: [resolve(__dirname, "preprocessing-src.js")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  write: false,
});

const jsCode = result.outputFiles[0].text;
const outPath = resolve(__dirname, "preprocessing.js");

writeFileSync(outPath, jsCode);

// Also copy to the iOS project if it exists (prebuild creates this copy)
const iosCopy = resolve(projectRoot, "ios/jitenShareExtension/preprocessing.js");
if (existsSync(iosCopy)) {
  copyFileSync(outPath, iosCopy);
}

console.log("share extension preprocessing.js built successfully");
