import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 10,
        branches: 8,
        functions: 8,
        lines: 10,
      },
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "db/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "packages/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "coverage/**",
        "scripts/**",
        "test/**",
        "packages/reader-webview/build.ts",
        "packages/reader-webview/bundle.ts",
        "lib/share-extension/**",
      ],
    },
  },
  resolve: {
    alias: {
      // More specific than the "@/" prefix below, so it must come first. user-provider
      // is platform-specific (.native.tsx / .web.tsx) — resolve to web for tests.
      "@/db/user-provider": path.resolve(__dirname, "db/user-provider.web.tsx"),
      "@/": path.resolve(__dirname, "") + "/",
      "@tradersamwise/japanese-reader": path.resolve(
        __dirname,
        "packages/japanese-reader/src/index.ts",
      ),
      "@tradersamwise/japanese-reader/furigana-types": path.resolve(
        __dirname,
        "packages/japanese-reader/src/furigana-types.ts",
      ),
      "@tradersamwise/japanese-reader/":
        path.resolve(__dirname, "packages/japanese-reader/src") + "/",
      "@tradersamwise/japanese-reader-core": path.resolve(
        __dirname,
        "packages/japanese-reader-core/src/index.ts",
      ),
      "@tradersamwise/japanese-reader-core/":
        path.resolve(__dirname, "packages/japanese-reader-core/src") + "/",
      "@tradersamwise/reader-webview/": path.resolve(__dirname, "packages/reader-webview") + "/",
      "react-native": path.resolve(__dirname, "test/__mocks__/react-native.ts"),
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "test/__mocks__/async-storage.ts",
      ),
      "@/lib/env": path.resolve(__dirname, "test/__mocks__/env.ts"),
      "@/lib/confirm": path.resolve(__dirname, "lib/confirm.web.ts"),
      "@sentry/react-native": path.resolve(__dirname, "test/__mocks__/sentry.ts"),
      // user-provider has platform-specific files (.native.tsx / .web.tsx) — use web for tests
      "./user-provider": path.resolve(__dirname, "db/user-provider.web.tsx"),
    },
  },
});
