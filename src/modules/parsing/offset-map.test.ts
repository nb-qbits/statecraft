import { describe, it, expect } from "vitest";
import { compressOffsetMap, expandOffsetMap, isCompressedOffsetMap } from "./offset-map.js";
import type { OffsetMap } from "./types.js";

describe("offset map compression", () => {
  it("round-trips an identity mapping", () => {
    const map: OffsetMap = {
      normalizedToOriginal: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      originalToNormalized: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    };

    const compressed = compressOffsetMap(map);
    expect(compressed.n2o).toEqual([[0, 0, 10]]);
    expect(compressed.o2n).toEqual([[0, 0, 10]]);

    const expanded = expandOffsetMap(compressed);
    expect(expanded.normalizedToOriginal).toEqual(map.normalizedToOriginal);
    expect(expanded.originalToNormalized).toEqual(map.originalToNormalized);
  });

  it("compresses a large identity mapping to a single run", () => {
    const n = 10000;
    const arr = Array.from({ length: n }, (_, i) => i);
    const map: OffsetMap = {
      normalizedToOriginal: arr,
      originalToNormalized: arr,
    };

    const compressed = compressOffsetMap(map);
    expect(compressed.n2o).toHaveLength(1);
    expect(compressed.o2n).toHaveLength(1);
    expect(JSON.stringify(compressed).length).toBeLessThan(100);
  });

  it("round-trips a mapping with a gap (deleted character)", () => {
    const map: OffsetMap = {
      normalizedToOriginal: [0, 1, 3, 4, 5],
      originalToNormalized: [0, 1, 2, 2, 3, 4],
    };

    const compressed = compressOffsetMap(map);
    expect(compressed.n2o).toEqual([[0, 0, 2], [2, 3, 3]]);

    const expanded = expandOffsetMap(compressed);
    expect(expanded.normalizedToOriginal).toEqual([...map.normalizedToOriginal]);
    expect(expanded.originalToNormalized).toEqual([...map.originalToNormalized]);
  });

  it("round-trips a mapping with expansion (ligature)", () => {
    const map: OffsetMap = {
      normalizedToOriginal: [0, 1, 2, 2, 2, 3, 4],
      originalToNormalized: [0, 1, 2, 5, 6],
    };

    const compressed = compressOffsetMap(map);
    const expanded = expandOffsetMap(compressed);
    expect(expanded.normalizedToOriginal).toEqual([...map.normalizedToOriginal]);
    expect(expanded.originalToNormalized).toEqual([...map.originalToNormalized]);
  });

  it("handles empty arrays", () => {
    const map: OffsetMap = {
      normalizedToOriginal: [],
      originalToNormalized: [],
    };

    const compressed = compressOffsetMap(map);
    expect(compressed.n2o).toEqual([]);
    expect(compressed.o2n).toEqual([]);

    const expanded = expandOffsetMap(compressed);
    expect(expanded.normalizedToOriginal).toEqual([]);
    expect(expanded.originalToNormalized).toEqual([]);
  });

  it("isCompressedOffsetMap detects compressed format", () => {
    expect(isCompressedOffsetMap({ n2o: [], o2n: [] })).toBe(true);
    expect(isCompressedOffsetMap({ n2o: [[0, 0, 5]], o2n: [[0, 0, 5]] })).toBe(true);
  });

  it("isCompressedOffsetMap rejects uncompressed format", () => {
    expect(isCompressedOffsetMap({
      normalizedToOriginal: [0, 1, 2],
      originalToNormalized: [0, 1, 2],
    })).toBe(false);
  });

  it("isCompressedOffsetMap rejects non-objects", () => {
    expect(isCompressedOffsetMap(null)).toBe(false);
    expect(isCompressedOffsetMap("string")).toBe(false);
    expect(isCompressedOffsetMap(42)).toBe(false);
  });
});
