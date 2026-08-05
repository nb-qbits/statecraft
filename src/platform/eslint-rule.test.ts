import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURES = resolve(ROOT, "fixtures/eslint");

function createESLint(): ESLint {
  return new ESLint({
    overrideConfigFile: resolve(ROOT, "eslint.config.js"),
  });
}

describe("no-framework-in-modules (end-to-end)", () => {
  it("errors when a file inside src/modules/ imports fastify or drizzle-orm", async () => {
    const eslint = createESLint();
    const code = readFileSync(
      resolve(FIXTURES, "forbidden-import.ts"),
      "utf-8",
    );

    // Lint with a virtual filename inside src/modules/
    const results = await eslint.lintText(code, {
      filePath: resolve(ROOT, "src/modules/test/forbidden.ts"),
    });

    const messages = results.flatMap((r) => r.messages);
    const ruleHits = messages.filter(
      (m) => m.ruleId === "local-rules/no-framework-in-modules",
    );

    expect(ruleHits.length).toBe(2);
    expect(ruleHits.some((m) => m.message.includes("fastify"))).toBe(true);
    expect(ruleHits.some((m) => m.message.includes("drizzle-orm"))).toBe(true);
  });

  it("passes when a file inside src/modules/ imports only allowed packages", async () => {
    const eslint = createESLint();
    const code = readFileSync(
      resolve(FIXTURES, "allowed-import.ts"),
      "utf-8",
    );

    const results = await eslint.lintText(code, {
      filePath: resolve(ROOT, "src/modules/test/allowed.ts"),
    });

    const ruleHits = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === "local-rules/no-framework-in-modules");

    expect(ruleHits).toHaveLength(0);
  });

  it("does not fire for files outside src/modules/", async () => {
    const eslint = createESLint();
    const code = readFileSync(
      resolve(FIXTURES, "forbidden-import.ts"),
      "utf-8",
    );

    const results = await eslint.lintText(code, {
      filePath: resolve(ROOT, "src/platform/test/infra.ts"),
    });

    const ruleHits = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === "local-rules/no-framework-in-modules");

    expect(ruleHits).toHaveLength(0);
  });
});
