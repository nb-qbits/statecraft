import { createHash } from "node:crypto";
import type { ContentHash, DocumentVersionId, SegmentId } from "../shared/types.js";

export function computeSegmentId(
  documentVersionId: DocumentVersionId,
  structuralPath: string,
  contentHash: ContentHash,
  ordinal: number,
): SegmentId {
  const input = `${documentVersionId}:${structuralPath}:${contentHash}:${ordinal}`;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `seg_${hash}` as SegmentId;
}

export function computeContentHash(rawText: string): ContentHash {
  return createHash("sha256").update(rawText, "utf-8").digest("hex") as ContentHash;
}

export interface OrdinalGroup {
  readonly structuralPath: string;
  readonly contentHash: ContentHash;
}

export function assignOrdinals(groups: readonly OrdinalGroup[]): number[] {
  return groups.map((_, i) => i);
}
