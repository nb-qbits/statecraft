import { describe, it, expect } from "vitest";
import type { SegmentId } from "../shared/types.js";
import { validateAndRepairResponse, EXTRACTION_RESPONSE_SCHEMA } from "./response-validator.js";

const SEG_ID = "seg_abc123" as SegmentId;

describe("response-validator", () => {
  describe("validateAndRepairResponse", () => {
    it("accepts a valid response with correct proposals", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "within 30 days",
            kind: "duration",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(1);
      expect(result.repaired).toBe(false);
      expect(result.droppedCount).toBe(0);
    });

    it("accepts an empty proposals array", () => {
      const parsed = { proposals: [] };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(0);
      expect(result.repaired).toBe(false);
    });

    it("accepts a bare array as proposals", () => {
      const parsed = [
        { segmentId: SEG_ID, quotedText: "July 1, 2025", kind: "obligation_deadline" },
      ];
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(1);
    });

    it("rejects null response", () => {
      const result = validateAndRepairResponse(null, SEG_ID);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toContain("null");
    });

    it("rejects non-object response", () => {
      const result = validateAndRepairResponse("not an object", SEG_ID);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toContain("not an object");
    });

    it("rejects response with no proposals array", () => {
      const result = validateAndRepairResponse({ foo: "bar" }, SEG_ID);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toContain("no proposals array");
    });

    it("INV-1: drops proposal containing a date field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "July 1, 2025",
            kind: "obligation_deadline",
            date: "2025-07-01",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
      expect(result.repaired).toBe(true);
    });

    it("INV-1: drops proposal containing normalizedDate field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "July 1, 2025",
            kind: "obligation_deadline",
            normalizedDate: "2025-07-01",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("INV-1: drops proposal containing computedDate field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "within 30 days",
            kind: "duration",
            computedDate: "2025-08-01",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("INV-1: drops proposal containing value field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "within 30 days",
            kind: "duration",
            value: 30,
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("INV-1: drops proposal containing normalizedValue field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "two business days",
            kind: "duration",
            normalizedValue: "P2BD",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("INV-1: drops proposal with any forbidden field from the full list", () => {
      const forbiddenFields = [
        "date", "normalizedDate", "computedDate", "resolvedDate",
        "value", "normalizedValue", "dateValue", "timestamp",
        "isoDate", "parsedDate", "effectiveDate", "deadline",
        "dueDate", "startDate", "endDate",
      ];

      for (const field of forbiddenFields) {
        const parsed = {
          proposals: [
            {
              segmentId: SEG_ID,
              quotedText: "some text",
              kind: "duration",
              [field]: "anything",
            },
          ],
        };
        const result = validateAndRepairResponse(parsed, SEG_ID);
        expect(result.proposals).toHaveLength(0);
        expect(result.droppedCount).toBe(1);
      }
    });

    it("drops proposal with empty quotedText", () => {
      const parsed = {
        proposals: [
          { segmentId: SEG_ID, quotedText: "", kind: "duration" },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops proposal with invalid kind", () => {
      const parsed = {
        proposals: [
          { segmentId: SEG_ID, quotedText: "some text", kind: "unknown_kind" },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops null proposals in array", () => {
      const parsed = {
        proposals: [
          null,
          { segmentId: SEG_ID, quotedText: "within 30 days", kind: "duration" },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(1);
      expect(result.droppedCount).toBe(1);
      expect(result.repaired).toBe(true);
    });

    it("repairs mismatched segmentId by substituting expected", () => {
      const parsed = {
        proposals: [
          {
            segmentId: "seg_wrong_id",
            quotedText: "within 30 days",
            kind: "duration",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.segmentId).toBe(SEG_ID);
      expect(result.nulledCount).toBe(1);
      expect(result.repaired).toBe(true);
    });

    it("truncates quotedText exceeding 500 chars", () => {
      const longText = "a".repeat(600);
      const parsed = {
        proposals: [
          { segmentId: SEG_ID, quotedText: longText, kind: "duration" },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals[0]!.quotedText).toHaveLength(500);
      expect(result.truncatedCount).toBe(1);
      expect(result.repaired).toBe(true);
    });

    it("repair never adds a value — only nulls, drops, or truncates", () => {
      const parsed = {
        proposals: [
          {
            segmentId: "seg_wrong",
            quotedText: "a".repeat(600),
            kind: "duration",
          },
          {
            segmentId: SEG_ID,
            quotedText: "valid proposal",
            kind: "obligation_deadline",
            date: "2025-07-01",
          },
          null,
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.repaired).toBe(true);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.segmentId).toBe(SEG_ID);
      expect(result.proposals[0]!.quotedText).toHaveLength(500);
      expect(result.droppedCount).toBe(2);
      expect(result.nulledCount).toBe(1);
      expect(result.truncatedCount).toBe(1);

      for (const p of result.proposals) {
        expect(Object.keys(p)).toEqual(["segmentId", "quotedText", "kind", "actor", "actorQuotedText", "dependsOnQuotedText", "dependsOnDescription"]);
      }
    });

    it("accepts all valid SpanProposalKind values", () => {
      const kinds = [
        "obligation_deadline",
        "effective_date",
        "duration",
        "temporal_constraint",
      ];
      for (const kind of kinds) {
        const parsed = {
          proposals: [
            { segmentId: SEG_ID, quotedText: "some text", kind },
          ],
        };
        const result = validateAndRepairResponse(parsed, SEG_ID);
        expect(result.proposals).toHaveLength(1);
      }
    });
  });

  describe("EXTRACTION_RESPONSE_SCHEMA", () => {
    it("has no field for date, value, or computed anything", () => {
      const itemProps = (
        EXTRACTION_RESPONSE_SCHEMA.properties.proposals.items as {
          properties: Record<string, unknown>;
        }
      ).properties;
      const allowedFields = new Set(["segmentId", "quotedText", "kind", "actor", "actorQuotedText", "dependsOnQuotedText", "dependsOnDescription"]);
      for (const key of Object.keys(itemProps)) {
        expect(allowedFields.has(key)).toBe(true);
      }
    });

    it("disallows additional properties", () => {
      expect(
        (
          EXTRACTION_RESPONSE_SCHEMA.properties.proposals.items as {
            additionalProperties: boolean;
          }
        ).additionalProperties,
      ).toBe(false);
    });
  });
});
