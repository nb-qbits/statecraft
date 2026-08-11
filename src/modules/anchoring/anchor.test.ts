import { describe, it, expect } from "vitest";
import { anchorQuote, fuzzySubstringSearch, ANCHORER_VERSION } from "./anchor.js";
import { normalizeForEvidenceMatchV1 } from "../parsing/normalize.js";
import type { OffsetMap } from "../parsing/types.js";


function makeNormalized(text: string): {
  normalizedText: string;
  offsetMap: OffsetMap;
} {
  const { normalized, offsetMap } = normalizeForEvidenceMatchV1(text);
  return { normalizedText: normalized, offsetMap };
}

describe("anchorQuote", () => {
  it("anchors a clean exact match", () => {
    const raw = "The agency shall act within 30 days of receiving the request.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(normalizedText, "within 30 days", offsetMap);

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("exact");
    expect(normalizedText.slice(result.normalizedStart, result.normalizedEnd)).toBe(
      "within 30 days",
    );
    expect(raw.slice(result.originalStart, result.originalEnd)).toBe(
      "within 30 days",
    );
  });

  it("anchors via normalized_exact when quote has smart quotes", () => {
    const raw = 'The "effective date" of this act.';
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      '“effective date”',
      offsetMap,
    );

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("normalized_exact");
    expect(
      normalizedText.slice(result.normalizedStart, result.normalizedEnd),
    ).toBe('"effective date"');
  });

  it("anchors via normalized_exact when quote has ligatures", () => {
    const raw = "The officer shall be notified.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(normalizedText, "The oﬃcer", offsetMap);

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("normalized_exact");
  });

  it("anchors via normalized_exact when quote has soft hyphens", () => {
    const raw = "within one working day of notification.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within one work­ing day",
      offsetMap,
    );

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("normalized_exact");
  });

  it("anchors via normalized_exact when quote has non-breaking spaces", () => {
    const raw = "within 30 days after enactment.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within 30 days",
      offsetMap,
    );

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("normalized_exact");
  });

  it("anchors via normalized_exact when quote has line-break hyphenation", () => {
    const raw = "within one work-\ning day of notification.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(normalizedText, "within one working day", offsetMap);

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("exact");
  });

  it("fails on fabricated quote not in segment", () => {
    const raw = "The agency shall act within one workday of receiving notification.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within five business days of such placement",
      offsetMap,
    );

    expect(result.anchored).toBe(false);
  });

  it("fails on quote from a different segment", () => {
    const raw = "Section 1. Definitions. For purposes of this chapter.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within 30 days of receiving the request",
      offsetMap,
    );

    expect(result.anchored).toBe(false);
  });

  it("fails on empty quote", () => {
    const { normalizedText, offsetMap } = makeNormalized("Some text.");

    expect(anchorQuote(normalizedText, "", offsetMap).anchored).toBe(false);
    expect(anchorQuote(normalizedText, "   ", offsetMap).anchored).toBe(false);
  });

  it("fails on empty segment", () => {
    const offsetMap: OffsetMap = {
      normalizedToOriginal: [],
      originalToNormalized: [],
    };

    expect(anchorQuote("", "some quote", offsetMap).anchored).toBe(false);
  });

  it("short quotes (< 5 chars) require exact match only", () => {
    const { normalizedText, offsetMap } = makeNormalized("The agency shall act.");

    const exact = anchorQuote(normalizedText, "shall", offsetMap);
    expect(exact.anchored).toBe(true);

    const fuzzy = anchorQuote(normalizedText, "shill", offsetMap);
    expect(fuzzy.anchored).toBe(false);
  });

  it("fuzzy match anchors a quote with a minor typo", () => {
    const raw =
      "The commissioner shall submit a report within thirty calendar days of receiving the written complaint.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within thirty calender days of receiving",
      offsetMap,
    );

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;
    expect(result.method).toBe("fuzzy");
  });

  it("fuzzy match fails when distance exceeds ceiling", () => {
    const raw = "within one working day of receiving notification";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(
      normalizedText,
      "within five business days of such placement",
      offsetMap,
    );

    expect(result.anchored).toBe(false);
    if (result.anchored) return;
    expect(result.reason).toBe("fuzzy_ceiling_exceeded");
  });

  it("offset round-trip: originalStart/End extract the correct raw text", () => {
    const raw =
      "Be it enacted: the agency shall act within 30 days after receiving the formal complaint.";
    const { normalizedText, offsetMap } = makeNormalized(raw);

    const result = anchorQuote(normalizedText, "within 30 days", offsetMap);

    expect(result.anchored).toBe(true);
    if (!result.anchored) return;

    const extracted = raw.slice(result.originalStart, result.originalEnd);
    const { normalized: extractedNormalized } =
      normalizeForEvidenceMatchV1(extracted);
    expect(extractedNormalized).toBe("within 30 days");
  });

  it("has a version string", () => {
    expect(ANCHORER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("fuzzySubstringSearch", () => {
  it("finds exact substring at distance 0", () => {
    const match = fuzzySubstringSearch("hello world", "world", 2);
    expect(match).not.toBeNull();
    expect(match!.distance).toBe(0);
    expect(match!.start).toBe(6);
    expect(match!.end).toBe(11);
  });

  it("finds approximate substring within distance", () => {
    const match = fuzzySubstringSearch("hello world", "worle", 2);
    expect(match).not.toBeNull();
    expect(match!.distance).toBeLessThanOrEqual(2);
  });

  it("returns null when distance exceeds maxErrors", () => {
    const match = fuzzySubstringSearch("hello world", "xyzzy", 1);
    expect(match).toBeNull();
  });

  it("returns null for empty inputs", () => {
    expect(fuzzySubstringSearch("", "pattern", 2)).toBeNull();
    expect(fuzzySubstringSearch("text", "", 2)).toBeNull();
  });

  it("finds match at start of text", () => {
    const match = fuzzySubstringSearch("within 30 days after", "within 30 days", 2);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(0);
    expect(match!.distance).toBe(0);
  });

  it("finds match at end of text", () => {
    const match = fuzzySubstringSearch(
      "the agency within 30 days",
      "within 30 days",
      2,
    );
    expect(match).not.toBeNull();
    expect(match!.end).toBe(25);
    expect(match!.distance).toBe(0);
  });
});
