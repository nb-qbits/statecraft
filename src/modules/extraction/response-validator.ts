import type { SegmentId } from "../shared/types.js";
import { SpanProposalKind } from "./types.js";
import type { SpanProposal } from "./types.js";

const VALID_KINDS = new Set(Object.values(SpanProposalKind));

const LEADING_PREPOSITION = /^(?:on|before|after|by|within|no later than)\s+/i;

const MONTH_NAMES = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)$/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE = /^\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?$/;
const MONTH_DAY_YEAR = /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?$/i;

export function isBareDateTime(title: string): boolean {
  const trimmed = title.trim();
  const stripped = trimmed.replace(LEADING_PREPOSITION, "");
  if (ISO_DATE.test(stripped)) return true;
  if (SLASH_DATE.test(stripped)) return true;
  if (MONTH_DAY_YEAR.test(stripped)) return true;
  const words = stripped.split(/\s+/);
  if (words.length <= 3) {
    const dateTokens = words.filter(w =>
      /^\d{1,4}[,.]?$/.test(w) || MONTH_NAMES.test(w)
    );
    if (dateTokens.length === words.length) return true;
  }
  return false;
}

const EXTERNAL_INSTRUMENT_MARKERS = [
  /\bU\.?\s*S\.?\s*C\.?\b/i,
  /\bUnited\s+States\s+Code\b/i,
  /\bP\.?\s*L\.?\s+\d/i,
  /\bPublic\s+Law\b/i,
  /\bC\.?\s*F\.?\s*R\.?\b/i,
  /\bCode\s+of\s+Federal\s+Regulations\b/i,
  /\btitle\s+\d+\b/i,
  /\b\d+\s+Stat\.\s+\d/i,
  /\bI\.?\s*R\.?\s*C\.?\s/i,
  /\bInternal\s+Revenue\s+Code\b/i,
];

export function isExternalCitation(text: string): boolean {
  return EXTERNAL_INSTRUMENT_MARKERS.some(pattern => pattern.test(text));
}

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
    if (finalQuotedText.length > 800) {
      finalQuotedText = finalQuotedText.slice(0, 800);
      truncatedCount++;
      repaired = true;
    }

    const rawObligationTitle = item["obligationTitle"];
    let obligationTitle = typeof rawObligationTitle === "string" && rawObligationTitle.trim().length > 0
      ? rawObligationTitle.trim().slice(0, 120)
      : null;
    if (obligationTitle && isBareDateTime(obligationTitle)) {
      obligationTitle = null;
      repaired = true;
    }

    const rawSectionCitation = item["sectionCitation"];
    const sectionCitation = typeof rawSectionCitation === "string" && rawSectionCitation.trim().length > 0
      ? rawSectionCitation.trim()
      : null;

    const rawActor = item["actor"];
    const rawActorQuotedText = item["actorQuotedText"];
    const actor = typeof rawActor === "string" && rawActor.trim().length > 0
      ? rawActor.trim()
      : null;
    const actorQuotedText = typeof rawActorQuotedText === "string" && rawActorQuotedText.trim().length > 0
      ? rawActorQuotedText.trim()
      : null;

    const rawDependsOnQuotedText = item["dependsOnQuotedText"];
    const rawDependsOnDescription = item["dependsOnDescription"];
    let dependsOnQuotedText = typeof rawDependsOnQuotedText === "string" && rawDependsOnQuotedText.trim().length > 0
      ? rawDependsOnQuotedText.trim()
      : null;
    let dependsOnDescription = typeof rawDependsOnDescription === "string" && rawDependsOnDescription.trim().length > 0
      ? rawDependsOnDescription.trim()
      : null;

    if (dependsOnQuotedText && isExternalCitation(dependsOnQuotedText)) {
      dependsOnQuotedText = null;
      dependsOnDescription = null;
      repaired = true;
    }

    validProposals.push({
      segmentId: finalSegmentId,
      quotedText: finalQuotedText,
      kind: kind as SpanProposalKind,
      obligationTitle,
      sectionCitation,
      actor,
      actorQuotedText,
      dependsOnQuotedText,
      dependsOnDescription,
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
          obligationTitle: { type: ["string", "null"] },
          kind: {
            type: "string",
            enum: Object.values(SpanProposalKind),
          },
          sectionCitation: { type: ["string", "null"] },
          actor: { type: ["string", "null"] },
          actorQuotedText: { type: ["string", "null"] },
          dependsOnQuotedText: { type: ["string", "null"] },
          dependsOnDescription: { type: ["string", "null"] },
        },
        required: ["segmentId", "quotedText", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
} as const;
