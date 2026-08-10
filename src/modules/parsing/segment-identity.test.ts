import { describe, it, expect } from "vitest";
import type { ContentHash, DocumentVersionId } from "../shared/types.js";
import { computeSegmentId, computeContentHash, assignOrdinals } from "./segment-identity.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;

describe("computeSegmentId", () => {
  it("produces a deterministic ID", () => {
    const hash = "abc123" as ContentHash;
    const id1 = computeSegmentId(dvId, "/body/p[0]", hash, 0);
    const id2 = computeSegmentId(dvId, "/body/p[0]", hash, 0);
    expect(id1).toBe(id2);
  });

  it("starts with seg_ prefix", () => {
    const id = computeSegmentId(dvId, "/body/p[0]", "abc" as ContentHash, 0);
    expect(id).toMatch(/^seg_[0-9a-f]{32}$/);
  });

  it("different structural paths produce different IDs", () => {
    const hash = "same" as ContentHash;
    const id1 = computeSegmentId(dvId, "/body/p[0]", hash, 0);
    const id2 = computeSegmentId(dvId, "/body/p[1]", hash, 0);
    expect(id1).not.toBe(id2);
  });

  it("different ordinals produce different IDs", () => {
    const hash = "same" as ContentHash;
    const id1 = computeSegmentId(dvId, "/body/p[0]", hash, 0);
    const id2 = computeSegmentId(dvId, "/body/p[0]", hash, 1);
    expect(id1).not.toBe(id2);
  });

  it("different document versions produce different IDs", () => {
    const hash = "same" as ContentHash;
    const dvId2 = "dv-00000000-0000-0000-0000-000000000002" as DocumentVersionId;
    const id1 = computeSegmentId(dvId, "/body/p[0]", hash, 0);
    const id2 = computeSegmentId(dvId2, "/body/p[0]", hash, 0);
    expect(id1).not.toBe(id2);
  });
});

describe("computeContentHash", () => {
  it("produces deterministic SHA-256 hex", () => {
    const h1 = computeContentHash("hello");
    const h2 = computeContentHash("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different text produces different hashes", () => {
    const h1 = computeContentHash("hello");
    const h2 = computeContentHash("world");
    expect(h1).not.toBe(h2);
  });
});

describe("assignOrdinals", () => {
  it("assigns 0 to unique groups", () => {
    const groups = [
      { structuralPath: "/body/p[0]", contentHash: "h1" as ContentHash },
      { structuralPath: "/body/p[1]", contentHash: "h2" as ContentHash },
    ];
    expect(assignOrdinals(groups)).toEqual([0, 0]);
  });

  it("assigns sequential ordinals to identical groups", () => {
    const groups = [
      { structuralPath: "/body/p[0]", contentHash: "same" as ContentHash },
      { structuralPath: "/body/p[0]", contentHash: "same" as ContentHash },
      { structuralPath: "/body/p[0]", contentHash: "same" as ContentHash },
    ];
    expect(assignOrdinals(groups)).toEqual([0, 1, 2]);
  });

  it("groups by (structuralPath, contentHash) jointly", () => {
    const groups = [
      { structuralPath: "/body/p[0]", contentHash: "h1" as ContentHash },
      { structuralPath: "/body/p[1]", contentHash: "h1" as ContentHash },
      { structuralPath: "/body/p[0]", contentHash: "h1" as ContentHash },
    ];
    expect(assignOrdinals(groups)).toEqual([0, 0, 1]);
  });

  it("returns empty array for empty input", () => {
    expect(assignOrdinals([])).toEqual([]);
  });
});
