import { describe, it, expect } from "vitest";
import type { SegmentId, DocumentVersionId, ContentHash } from "../shared/types.js";
import type {
  OffsetMap,
  RunProperty,
  ParsedParagraph,
  ParseSuccess,
  ParseFailure,
  SourceSegment,
  NormalizeResult,
} from "./types.js";

describe("parsing domain types", () => {
  it("OffsetMap has two parallel arrays", () => {
    const map: OffsetMap = {
      normalizedToOriginal: [0, 1, 2],
      originalToNormalized: [0, 1, 2],
    };
    expect(map.normalizedToOriginal).toHaveLength(3);
    expect(map.originalToNormalized).toHaveLength(3);
  });

  it("ParseSuccess discriminant is ok: true", () => {
    const result: ParseSuccess = {
      ok: true,
      paragraphs: [],
      parserAdapter: "plain-text",
      parserVersion: "1.0.0",
      fidelity: "none",
    };
    expect(result.ok).toBe(true);
  });

  it("ParseFailure discriminant is ok: false", () => {
    const result: ParseFailure = {
      ok: false,
      reason: "invalid ZIP",
      parserAdapter: "docx",
      parserVersion: "1.0.0",
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid ZIP");
  });

  it("RunProperty captures italic and strikethrough", () => {
    const prop: RunProperty = { italic: true, strikethrough: false };
    expect(prop.italic).toBe(true);
    expect(prop.strikethrough).toBe(false);
  });

  it("ParsedParagraph has structural path and runs", () => {
    const para: ParsedParagraph = {
      structuralPath: "/body/p[0]",
      runs: [
        { text: "hello", properties: { italic: false, strikethrough: false } },
      ],
    };
    expect(para.structuralPath).toBe("/body/p[0]");
    expect(para.runs).toHaveLength(1);
  });

  it("SourceSegment has all required fields", () => {
    const seg: SourceSegment = {
      segmentId: "seg-1" as SegmentId,
      documentVersionId: "dv-1" as DocumentVersionId,
      structuralPath: "/body/section[1]/p[0]",
      ordinal: 0,
      rawText: "raw",
      normalizedText: "normalized",
      contentHash: "abc123" as ContentHash,
      offsetMap: { normalizedToOriginal: [0], originalToNormalized: [0] },
      parserAdapter: "plain-text",
      parserVersion: "1.0.0",
      fidelity: "none",
    };
    expect(seg.segmentId).toBe("seg-1");
    expect(seg.fidelity).toBe("none");
  });

  it("NormalizeResult pairs normalized text with offset map", () => {
    const result: NormalizeResult = {
      normalized: "hello",
      offsetMap: {
        normalizedToOriginal: [0, 1, 2, 3, 4],
        originalToNormalized: [0, 1, 2, 3, 4],
      },
    };
    expect(result.normalized).toBe("hello");
    expect(result.offsetMap.normalizedToOriginal).toHaveLength(5);
  });
});
