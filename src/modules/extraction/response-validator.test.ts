import { describe, it, expect } from "vitest";
import type { SegmentId } from "../shared/types.js";
import { validateAndRepairResponse, EXTRACTION_RESPONSE_SCHEMA, isBareDateTime, isExternalCitation } from "./response-validator.js";

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

    it("truncates quotedText exceeding 800 chars", () => {
      const longText = "a".repeat(900);
      const parsed = {
        proposals: [
          { segmentId: SEG_ID, quotedText: longText, kind: "duration" },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals[0]!.quotedText).toHaveLength(800);
      expect(result.truncatedCount).toBe(1);
      expect(result.repaired).toBe(true);
    });

    it("repair never adds a value — only nulls, drops, or truncates", () => {
      const parsed = {
        proposals: [
          {
            segmentId: "seg_wrong",
            quotedText: "a".repeat(900),
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
      expect(result.proposals[0]!.quotedText).toHaveLength(800);
      expect(result.droppedCount).toBe(2);
      expect(result.nulledCount).toBe(1);
      expect(result.truncatedCount).toBe(1);

      for (const p of result.proposals) {
        expect(Object.keys(p)).toEqual(["segmentId", "quotedText", "kind", "obligationTitle", "sectionCitation", "actor", "actorQuotedText", "dependsOnQuotedText", "dependsOnDescription"]);
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
      const allowedFields = new Set(["segmentId", "quotedText", "obligationTitle", "kind", "sectionCitation", "actor", "actorQuotedText", "dependsOnQuotedText", "dependsOnDescription"]);
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

  describe("isBareDateTime", () => {
    it("detects full month-day-year date phrases", () => {
      expect(isBareDateTime("July 1, 2025")).toBe(true);
      expect(isBareDateTime("January 15, 2026")).toBe(true);
      expect(isBareDateTime("December 31")).toBe(true);
    });

    it("detects numeric date formats", () => {
      expect(isBareDateTime("2025-07-01")).toBe(true);
      expect(isBareDateTime("7/1/2025")).toBe(true);
      expect(isBareDateTime("01.15.2026")).toBe(true);
    });

    it("detects month-only or month-year tokens", () => {
      expect(isBareDateTime("July 2025")).toBe(true);
      expect(isBareDateTime("Jan 1")).toBe(true);
    });

    it("rejects substantive obligation titles", () => {
      expect(isBareDateTime("Submit strategic plan to Governor")).toBe(false);
      expect(isBareDateTime("File annual audit report")).toBe(false);
      expect(isBareDateTime("Notify Department of Environmental Quality")).toBe(false);
    });

    it("rejects titles that happen to contain dates but describe duties", () => {
      expect(isBareDateTime("Submit report due July 1")).toBe(false);
      expect(isBareDateTime("Complete review within 30 days")).toBe(false);
    });

    it("detects date phrases with leading prepositions", () => {
      expect(isBareDateTime("by July 1, 2025")).toBe(true);
      expect(isBareDateTime("on January 15")).toBe(true);
      expect(isBareDateTime("before December 31, 2026")).toBe(true);
    });
  });

  describe("obligationTitle bare date nulling", () => {
    it("nulls obligationTitle when it is a bare date phrase", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "shall submit by July 1, 2025",
            kind: "obligation_deadline",
            obligationTitle: "July 1, 2025",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.obligationTitle).toBeNull();
      expect(result.repaired).toBe(true);
    });

    it("preserves substantive obligationTitle", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "shall submit by July 1, 2025",
            kind: "obligation_deadline",
            obligationTitle: "Submit strategic plan to Governor",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals[0]!.obligationTitle).toBe("Submit strategic plan to Governor");
    });
  });

  describe("isExternalCitation", () => {
    it("detects U.S.C. references", () => {
      expect(isExternalCitation("42 U.S.C. §16511")).toBe(true);
      expect(isExternalCitation("26 U.S.C. § 45X")).toBe(true);
    });

    it("detects United States Code long form", () => {
      expect(isExternalCitation("section 551 of title 5, United States Code")).toBe(true);
    });

    it("detects Public Law references", () => {
      expect(isExternalCitation("P.L. 117-169")).toBe(true);
      expect(isExternalCitation("Public Law 117-169")).toBe(true);
    });

    it("detects C.F.R. references", () => {
      expect(isExternalCitation("40 C.F.R. Part 60")).toBe(true);
      expect(isExternalCitation("Code of Federal Regulations")).toBe(true);
    });

    it("detects title references", () => {
      expect(isExternalCitation("title 5")).toBe(true);
      expect(isExternalCitation("Title 26")).toBe(true);
    });

    it("detects Statutes at Large", () => {
      expect(isExternalCitation("136 Stat. 1818")).toBe(true);
    });

    it("does not flag internal section references", () => {
      expect(isExternalCitation("§ 56-576")).toBe(false);
      expect(isExternalCitation("Section 3 of this act")).toBe(false);
      expect(isExternalCitation("the effective date of this act")).toBe(false);
    });
  });

  describe("external dependency dropping", () => {
    it("nulls dependency fields when dependsOnQuotedText is an external citation", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "shall comply within 180 days",
            kind: "duration",
            dependsOnQuotedText: "42 U.S.C. §16511",
            dependsOnDescription: "federal loan guarantee program",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.dependsOnQuotedText).toBeNull();
      expect(result.proposals[0]!.dependsOnDescription).toBeNull();
      expect(result.repaired).toBe(true);
    });

    it("preserves dependency fields for internal references", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "within 30 days after the effective date",
            kind: "duration",
            dependsOnQuotedText: "the effective date of this act",
            dependsOnDescription: "effective date",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals[0]!.dependsOnQuotedText).toBe("the effective date of this act");
      expect(result.proposals[0]!.dependsOnDescription).toBe("effective date");
    });

    it("drops P.L. references as dependencies", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "as required by P.L. 117-169",
            kind: "obligation_deadline",
            dependsOnQuotedText: "P.L. 117-169",
            dependsOnDescription: "Inflation Reduction Act",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.proposals[0]!.dependsOnQuotedText).toBeNull();
      expect(result.proposals[0]!.dependsOnDescription).toBeNull();
    });
  });
});
