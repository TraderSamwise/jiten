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
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "coverage/**",
        "scripts/**",
        "test/**",
        "lib/reader/build.ts",
        "lib/reader/bundle.ts",
        "lib/share-extension/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "") + "/",
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
