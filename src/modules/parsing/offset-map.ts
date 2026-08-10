import type { OffsetMap, CompressedOffsetMap, OffsetRun } from "./types.js";

export function compressOffsetMap(map: OffsetMap): CompressedOffsetMap {
  return {
    n2o: compressArray(map.normalizedToOriginal),
    o2n: compressArray(map.originalToNormalized),
  };
}

export function expandOffsetMap(compressed: CompressedOffsetMap): OffsetMap {
  return {
    normalizedToOriginal: expandRuns(compressed.n2o),
    originalToNormalized: expandRuns(compressed.o2n),
  };
}

export function isCompressedOffsetMap(value: unknown): value is CompressedOffsetMap {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj["n2o"]) && Array.isArray(obj["o2n"]);
}

function compressArray(arr: readonly number[]): OffsetRun[] {
  if (arr.length === 0) return [];

  const runs: OffsetRun[] = [];
  let runStart = 0;
  let runMapped = arr[0]!;

  for (let i = 1; i < arr.length; i++) {
    const expected = runMapped + (i - runStart);
    if (arr[i] !== expected) {
      runs.push([runStart, runMapped, i - runStart]);
      runStart = i;
      runMapped = arr[i]!;
    }
  }

  runs.push([runStart, runMapped, arr.length - runStart]);
  return runs;
}

function expandRuns(runs: readonly OffsetRun[]): number[] {
  if (runs.length === 0) return [];

  const lastRun = runs[runs.length - 1]!;
  const totalLength = lastRun[0] + lastRun[2];
  const result = new Array<number>(totalLength);

  for (const [start, mappedStart, length] of runs) {
    for (let i = 0; i < length; i++) {
      result[start + i] = mappedStart + i;
    }
  }

  return result;
}
