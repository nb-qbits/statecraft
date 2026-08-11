import { describe, it, expect } from "vitest";
import {
  computePromptHash,
  SPAN_PROPOSAL_PROMPT,
  renderUserPrompt,
  getPromptByHash,
  registerPrompt,
} from "./prompt-registry.js";
import type { PromptHash } from "../shared/types.js";

describe("prompt-registry", () => {
  describe("computePromptHash", () => {
    it("produces deterministic hash from system + user template", () => {
      const h1 = computePromptHash("system", "user");
      const h2 = computePromptHash("system", "user");
      expect(h1).toBe(h2);
    });

    it("hash changes when system prompt changes", () => {
      const h1 = computePromptHash("system-v1", "user");
      const h2 = computePromptHash("system-v2", "user");
      expect(h1).not.toBe(h2);
    });

    it("hash changes when user template changes", () => {
      const h1 = computePromptHash("system", "user-v1");
      const h2 = computePromptHash("system", "user-v2");
      expect(h1).not.toBe(h2);
    });

    it("produces a ph_ prefixed string", () => {
      const h = computePromptHash("s", "u");
      expect(h).toMatch(/^ph_[0-9a-f]{64}$/);
    });
  });

  describe("SPAN_PROPOSAL_PROMPT", () => {
    it("has a valid promptHash that matches recomputation", () => {
      const recomputed = computePromptHash(
        SPAN_PROPOSAL_PROMPT.systemPrompt,
        SPAN_PROPOSAL_PROMPT.userTemplate,
      );
      expect(SPAN_PROPOSAL_PROMPT.promptHash).toBe(recomputed);
    });

    it("is retrievable by hash", () => {
      const retrieved = getPromptByHash(SPAN_PROPOSAL_PROMPT.promptHash);
      expect(retrieved).toBeDefined();
      expect(retrieved!.version).toBe("1.0.0");
    });

    it("system prompt instructs no date values", () => {
      expect(SPAN_PROPOSAL_PROMPT.systemPrompt).toContain(
        "Do NOT return dates, computed values, or normalized forms",
      );
    });

    it("user template has segmentId, candidateSummary, and normalizedText placeholders", () => {
      expect(SPAN_PROPOSAL_PROMPT.userTemplate).toContain("{{segmentId}}");
      expect(SPAN_PROPOSAL_PROMPT.userTemplate).toContain("{{candidateSummary}}");
      expect(SPAN_PROPOSAL_PROMPT.userTemplate).toContain("{{normalizedText}}");
    });
  });

  describe("renderUserPrompt", () => {
    it("replaces all template variables", () => {
      const result = renderUserPrompt("Hello {{name}}, your id is {{id}}", {
        name: "test",
        id: "123",
      });
      expect(result).toBe("Hello test, your id is 123");
    });

    it("replaces multiple occurrences of the same variable", () => {
      const result = renderUserPrompt("{{x}} and {{x}}", { x: "y" });
      expect(result).toBe("y and y");
    });
  });

  describe("registerPrompt", () => {
    it("registers and retrieves a custom prompt", () => {
      const hash = computePromptHash("custom-sys", "custom-user");
      registerPrompt({
        promptHash: hash,
        systemPrompt: "custom-sys",
        userTemplate: "custom-user",
        version: "2.0.0",
      });
      const retrieved = getPromptByHash(hash);
      expect(retrieved).toBeDefined();
      expect(retrieved!.version).toBe("2.0.0");
    });

    it("returns undefined for unknown hash", () => {
      const result = getPromptByHash("ph_nonexistent" as PromptHash);
      expect(result).toBeUndefined();
    });
  });
});
