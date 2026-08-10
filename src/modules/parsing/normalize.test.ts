import { describe, it, expect } from "vitest";
import { normalizeForEvidenceMatchV1 } from "./normalize.js";

describe("normalizeForEvidenceMatchV1", () => {
  it("returns empty for empty string", () => {
    const result = normalizeForEvidenceMatchV1("");
    expect(result.normalized).toBe("");
    expect(result.offsetMap.normalizedToOriginal).toHaveLength(0);
    expect(result.offsetMap.originalToNormalized).toHaveLength(0);
  });

  it("identity on clean ASCII text", () => {
    const input = "hello world";
    const result = normalizeForEvidenceMatchV1(input);
    expect(result.normalized).toBe("hello world");
    expect(result.offsetMap.normalizedToOriginal).toHaveLength(11);
    for (let i = 0; i < 11; i++) {
      expect(result.offsetMap.normalizedToOriginal[i]).toBe(i);
    }
  });

  describe("NFKC normalization", () => {
    it("normalizes ligature fi → fi", () => {
      const input = "oﬃce";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("office");
    });

    it("normalizes ﬀ → ff", () => {
      const input = "eﬀect";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("effect");
    });

    it("normalizes single-char NFKC replacement (e.g. ℃ → °C)", () => {
      const input = "100℃";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toContain("C");
    });

    it("handles superscript digits via NFKC (² → 2)", () => {
      const input = "x²";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("x2");
    });
  });

  describe("soft hyphen removal", () => {
    it("removes soft hyphens", () => {
      const input = "leg­is­la­tion";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("legislation");
    });

    it("offset maps back past soft hyphens", () => {
      const input = "ab­cd";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("abcd");
      expect(result.offsetMap.normalizedToOriginal[0]).toBe(0); // a
      expect(result.offsetMap.normalizedToOriginal[1]).toBe(1); // b
      expect(result.offsetMap.normalizedToOriginal[2]).toBe(3); // c (skipped soft hyphen at 2)
      expect(result.offsetMap.normalizedToOriginal[3]).toBe(4); // d
    });
  });

  describe("line-break hyphenation rejoining", () => {
    it("rejoins word-\\nword → wordword", () => {
      const input = "legis-\nlation";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("legislation");
    });

    it("does not rejoin hyphen without newline", () => {
      const input = "well-known";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("well-known");
    });
  });

  describe("smart quotes → ASCII", () => {
    it("replaces left/right double quotes", () => {
      const input = "“hello”";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe('"hello"');
    });

    it("replaces left/right single quotes", () => {
      const input = "‘don’t’";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("'don't'");
    });

    it("replaces guillemets", () => {
      const input = "«text»";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe('"text"');
    });
  });

  describe("non-breaking space → regular space", () => {
    it("replaces NBSP with regular space", () => {
      const input = "§ 1-210";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("§ 1-210");
    });
  });

  describe("whitespace collapse", () => {
    it("collapses multiple spaces to one", () => {
      const input = "hello    world";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("hello world");
    });

    it("collapses tabs and newlines", () => {
      const input = "hello\t\n\r\n  world";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("hello world");
    });

    it("trims leading and trailing whitespace", () => {
      const input = "  hello world  ";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("hello world");
    });
  });

  describe("combined transformations (adversarial)", () => {
    it("handles all transformations in a single string", () => {
      const input = "  “Leg­is-\nlative”  Act  ";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe('"Legislative" Act');
    });

    it("handles repeated identical text", () => {
      const input = "Section 1.\n\nSection 1.";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("Section 1. Section 1.");
    });
  });

  describe("offset map round-tripping", () => {
    it("normalizedToOriginal length matches normalized string length", () => {
      const input = "hello world­!";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.offsetMap.normalizedToOriginal).toHaveLength(result.normalized.length);
    });

    it("originalToNormalized length matches original string length", () => {
      const input = "hello world­!";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.offsetMap.originalToNormalized).toHaveLength(input.length);
    });

    it("round-trips: original[n2o[i]] gives the source character", () => {
      const input = "ab cd";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("ab cd");
      for (let i = 0; i < result.normalized.length; i++) {
        const origIdx = result.offsetMap.normalizedToOriginal[i]!;
        expect(origIdx).toBeGreaterThanOrEqual(0);
        expect(origIdx).toBeLessThan(input.length);
      }
    });

    it("normalizedToOriginal is monotonically non-decreasing", () => {
      const input = "  “leg­is-\nlative”  act  ";
      const result = normalizeForEvidenceMatchV1(input);
      const n2o = result.offsetMap.normalizedToOriginal;
      for (let i = 1; i < n2o.length; i++) {
        expect(n2o[i]).toBeGreaterThanOrEqual(n2o[i - 1]!);
      }
    });

    it("range mapping: a normalized span maps to a contiguous original span", () => {
      const input = "§ 1-210(E)";
      const result = normalizeForEvidenceMatchV1(input);
      expect(result.normalized).toBe("§ 1-210(E)");
      // "§ 1-210(E)" normalized is same chars. Input: §(0) NBSP(1) 1(2) -(3) 2(4) 1(5) 0(6) ((7) E(8) )(9)
      const nStart = 2; // "1" in normalized
      const nEnd = 6;   // "0" in normalized
      const oStart = result.offsetMap.normalizedToOriginal[nStart]!;
      const oEnd = result.offsetMap.normalizedToOriginal[nEnd]!;
      expect(oStart).toBe(2);
      expect(oEnd).toBe(6);
    });
  });
});
