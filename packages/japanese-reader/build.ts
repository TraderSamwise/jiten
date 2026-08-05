import { copyFile, rm } from "fs/promises";
import { build } from "esbuild";

const external = [
  "@tradersamwise/japanese-reader-core",
  "@tradersamwise/reader-webview",
  "react",
  "react-native",
  "react-native-webview",
  "wanakana",
];

const shared = {
  bundle: true,
  format: "esm" as const,
  platform: "neutral" as const,
  target: "es2020",
  external,
};

await rm("dist", { recursive: true, force: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: [
      "src/index.ts",
      "src/backend.ts",
      "src/furigana.ts",
      "src/furigana-types.ts",
      "src/types.ts",
    ],
    outdir: "dist",
  }),
  build({
    ...shared,
    entryPoints: ["src/reader-view.web.tsx"],
    outfile: "dist/reader-view.web.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/reader-view.native.tsx"],
    outfile: "dist/reader-view.native.js",
  }),
]);

await copyFile("src/reader-view.d.ts", "dist/reader-view.d.ts");
