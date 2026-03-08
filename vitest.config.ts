import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
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
      // user-provider has platform-specific files (.native.tsx / .web.tsx) — use web for tests
      "./user-provider": path.resolve(__dirname, "db/user-provider.web.tsx"),
    },
  },
});
