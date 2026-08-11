import type { SegmentId } from "../shared/types.js";
import { SpanProposalKind } from "./types.js";
import type { SpanProposal } from "./types.js";

const VALID_KINDS = new Set(Object.values(SpanProposalKind));

const FORBIDDEN_FIELDS = new Set([
  "date",
  "normalizedDate",
  "computedDate",
  "resolvedDate",
  "value",
  "normalizedValue",
  "dateValue",
  "timestamp",
  "isoDate",
  "parsedDate",
  "effectiveDate",
  "deadline",
  "dueDate",
  "startDate",
  "endDate",
]);

export interface ValidationResult {
  readonly valid: boolean;
  readonly proposals: readonly SpanProposal[];
  readonly repaired: boolean;
  readonly droppedCount: number;
  readonly truncatedCount: number;
  readonly nulledCount: number;
  readonly rejectionReason: string | null;
}

export function validateAndRepairResponse(
  parsed: unknown,
  expectedSegmentId: SegmentId,
): ValidationResult {
  if (parsed === null || parsed === undefined) {
    return {
      valid: false,
      proposals: [],
      repaired: false,
      droppedCount: 0,
      truncatedCount: 0,
      nulledCount: 0,
      rejectionReason: "Response is null or undefined",
    };
  }

  if (typeof parsed !== "object") {
    return {
      valid: false,
      proposals: [],
      repaired: false,
      droppedCount: 0,
      truncatedCount: 0,
      nulledCount: 0,
      rejectionReason: `Response is not an object (got ${typeof parsed})`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  let rawProposals: unknown[];

  if (Array.isArray(obj)) {
    rawProposals = obj;
  } else if (Array.isArray(obj["proposals"])) {
    rawProposals = obj["proposals"] as unknown[];
  } else {
    return {
      valid: false,
      proposals: [],
      repaired: false,
      droppedCount: 0,
      truncatedCount: 0,
      nulledCount: 0,
      rejectionReason: "Response has no proposals array",
    };
  }

  const validProposals: SpanProposal[] = [];
  let droppedCount = 0;
  let truncatedCount = 0;
  let nulledCount = 0;
  let repaired = false;

  for (const raw of rawProposals) {
    if (raw === null || raw === undefined || typeof raw !== "object") {
      droppedCount++;
      repaired = true;
      continue;
    }

    const item = raw as Record<string, unknown>;

    if (hasForbiddenFields(item)) {
      droppedCount++;
      repaired = true;
      continue;
    }

    const segmentId = item["segmentId"];
    const quotedText = item["quotedText"];
    const kind = item["kind"];

    if (typeof quotedText !== "string" || quotedText.trim().length === 0) {
      droppedCount++;
      repaired = true;
      continue;
    }

    if (typeof kind !== "string" || !VALID_KINDS.has(kind as SpanProposalKind)) {
      droppedCount++;
      repaired = true;
      continue;
    }

    let finalSegmentId: SegmentId;
    if (typeof segmentId === "string" && segmentId === expectedSegmentId) {
      finalSegmentId = segmentId as SegmentId;
    } else {
      finalSegmentId = expectedSegmentId;
      nulledCount++;
      repaired = true;
    }

    let finalQuotedText = quotedText;
    if (finalQuotedText.length > 500) {
      finalQuotedText = finalQuotedText.slice(0, 500);
      truncatedCount++;
      repaired = true;
    }

    validProposals.push({
      segmentId: finalSegmentId,
      quotedText: finalQuotedText,
      kind: kind as SpanProposalKind,
    });
  }

  return {
    valid: true,
    proposals: validProposals,
    repaired,
    droppedCount,
    truncatedCount,
    nulledCount,
    rejectionReason: null,
  };
}

function hasForbiddenFields(item: Record<string, unknown>): boolean {
  for (const key of Object.keys(item)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      return true;
    }
  }
  return false;
}

export const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          segmentId: { type: "string" },
          quotedText: { type: "string" },
          kind: {
            type: "string",
            enum: Object.values(SpanProposalKind),
          },
        },
        required: ["segmentId", "quotedText", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
} as const;
