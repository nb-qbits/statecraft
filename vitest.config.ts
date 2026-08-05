import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/main.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 80,
        branches: 91,
        functions: 76,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@modules": new URL("./src/modules", import.meta.url).pathname,
      "@platform": new URL("./src/platform", import.meta.url).pathname,
    },
  },
});
