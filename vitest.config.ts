import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { include: ["**/*.test.ts"] },
  resolve: {
    alias: {
      "react-native": path.resolve(__dirname, "test/__mocks__/react-native.ts"),
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "test/__mocks__/async-storage.ts",
      ),
      "@/lib/env": path.resolve(__dirname, "test/__mocks__/env.ts"),
    },
  },
});
