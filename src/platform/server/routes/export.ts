import type { FastifyInstance } from "fastify";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { ReviewRepository } from "../../db/review-repository.js";
import type { RegisterRecord } from "../../../modules/review/types.js";

export interface ExportDeps {
  reviewRepository: ReviewRepository;
  logger: Logger;
}

function escapeIcs(text: string): string {
  return text.replace(/[\\;,\n]/g, (c) => {
    if (c === "\n") return "\\n";
    return `\\${c}`;
  });
}

function formatIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildSummary(record: RegisterRecord): string {
  if (record.deliverable) {
    return record.deliverable;
  }
  if (record.quotedText) {
    return `Deadline: ${record.quotedText}`;
  }
  return `Deadline: ${record.adjustedDate}`;
}

function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf-8") <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(current + ch, "utf-8") > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join("\r\n");
}

export function registerExportRoutes(
  app: FastifyInstance,
  deps: ExportDeps,
): void {
  const { reviewRepository, logger } = deps;

  app.get<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/export/ics",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      try {
        const records = await reviewRepository.getRegisterRecordsByVersion(dvId);
        if (records.length === 0) {
          return reply.status(404).send({
            error: { code: "NO_RECORDS", message: "No register records found for this document version" },
          });
        }

        const lines: string[] = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//PolicyAction//Deadline Register//EN",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
        ];

        for (const record of records) {
          const summary = buildSummary(record);

          const isEstimated = record.dateProvenance === "generic_default";

          const descParts: string[] = [];
          if (isEstimated) {
            descParts.push("⚠ ESTIMATED — not verified for this jurisdiction");
          }
          descParts.push(`Statutory date: ${record.deadlineDate}`);
          descParts.push(`Adjusted date: ${record.adjustedDate}`);
          if (record.deadlineDate !== record.adjustedDate) {
            descParts.push(
              `Adjustment: statutory date adjusted per ${record.citations.find((c) => c.includes("§ 1-210")) ?? record.ruleIds.join(", ")}`,
            );
          }
          if (record.deliverable) descParts.push(`Deliverable: ${record.deliverable}`);
          if (record.actor) descParts.push(`Actor: ${record.actor}`);
          descParts.push(`Rules: ${record.ruleIds.join(", ")}`);
          descParts.push(`Citations: ${record.citations.join(", ")}`);
          const description = descParts.join("\n");

          const summaryText = isEstimated ? `[ESTIMATED] ${summary}` : summary;

          lines.push("BEGIN:VEVENT");
          lines.push(`UID:${record.recordVersionId}@policyaction`);
          lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(record.adjustedDate)}`);
          lines.push(`DTEND;VALUE=DATE:${formatIcsDate(nextDay(record.adjustedDate))}`);
          lines.push(foldLine(`SUMMARY:${escapeIcs(summaryText)}`));
          lines.push(foldLine(`DESCRIPTION:${escapeIcs(description)}`));
          lines.push("TRANSP:TRANSPARENT");

          if (record.rrule) {
            lines.push(`RRULE:${record.rrule}`);

            const occurrences = await reviewRepository.getOccurrencesByRecord(
              record.recordVersionId,
            );
            for (const occ of occurrences) {
              if (occ.occurrenceDate !== occ.adjustedDate) {
                lines.push(`EXDATE;VALUE=DATE:${formatIcsDate(occ.occurrenceDate)}`);
                lines.push(`RDATE;VALUE=DATE:${formatIcsDate(occ.adjustedDate)}`);
              }
            }
          }

          lines.push("END:VEVENT");
        }

        lines.push("END:VCALENDAR");

        const icsContent = lines.join("\r\n") + "\r\n";
        reply.header("Content-Type", "text/calendar; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="deadlines-${dvId.slice(0, 8)}.ics"`);
        return reply.send(icsContent);
      } catch (err) {
        logger.error({ err, dvId }, "ICS export failed");
        return reply.status(500).send({
          error: { code: "EXPORT_FAILED", message: "ICS export failed" },
        });
      }
    },
  );

  app.get<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/export/csv",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      try {
        const records = await reviewRepository.getRegisterRecordsByVersion(dvId);
        if (records.length === 0) {
          return reply.status(404).send({
            error: { code: "NO_RECORDS", message: "No register records found for this document version" },
          });
        }

        const csvLines: string[] = [
          "record_version_id,kind,quoted_text,statutory_date,adjusted_date,rrule,occurrence_seq,rule_ids,citations,deliverable,actor,date_provenance",
        ];

        for (const record of records) {
          csvLines.push(csvRow([
            record.recordVersionId,
            record.kind,
            record.quotedText ?? "",
            record.deadlineDate,
            record.adjustedDate,
            record.rrule ?? "",
            "",
            record.ruleIds.join("; "),
            record.citations.join("; "),
            record.deliverable ?? "",
            record.actor ?? "",
            record.dateProvenance,
          ]));

          if (record.rrule) {
            const occurrences = await reviewRepository.getOccurrencesByRecord(
              record.recordVersionId,
            );
            for (const occ of occurrences) {
              csvLines.push(csvRow([
                record.recordVersionId,
                "recurrence_occurrence",
                record.quotedText ?? "",
                occ.occurrenceDate,
                occ.adjustedDate,
                record.rrule,
                String(occ.sequenceNumber),
                occ.ruleIds.join("; "),
                occ.citations.join("; "),
                record.deliverable ?? "",
                record.actor ?? "",
                record.dateProvenance,
              ]));
            }
          }
        }

        const csvContent = csvLines.join("\n") + "\n";
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="deadlines-${dvId.slice(0, 8)}.csv"`);
        return reply.send(csvContent);
      } catch (err) {
        logger.error({ err, dvId }, "CSV export failed");
        return reply.status(500).send({
          error: { code: "EXPORT_FAILED", message: "CSV export failed" },
        });
      }
    },
  );
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvEscape).join(",");
}
