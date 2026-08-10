import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/main.ts",
        "src/platform/db/client.ts",
        "src/platform/db/migrate.ts",
        "src/platform/db/ingestion-schema.ts",
        "src/platform/db/ingestion-repository.ts",
        "src/platform/db/schema.ts",
        "src/platform/storage/check.ts",
        "src/platform/storage/storage.ts",
        "src/platform/server/routes/upload.ts",
        "src/platform/db/parsing-schema.ts",
        "src/platform/db/parsing-repository.ts",
        "src/platform/server/routes/parse.ts",
        "src/modules/parsing/types.ts",
      ],
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
