import {
  pgTable,
  varchar,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { sourceSegments } from "./parsing-schema.js";
import { documentVersions } from "./ingestion-schema.js";

export const scanCandidates = pgTable(
  "scan_candidates",
  {
    candidateId: varchar("candidate_id", { length: 128 }).primaryKey(),
    segmentId: varchar("segment_id", { length: 128 })
      .notNull()
      .references(() => sourceSegments.segmentId),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    kind: varchar("kind", { length: 64 }).notNull(),
    ruleId: varchar("rule_id", { length: 128 }).notNull(),
    matchedText: text("matched_text").notNull(),
    matchStart: integer("match_start").notNull(),
    matchEnd: integer("match_end").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    scannerVersion: varchar("scanner_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_scan_candidates_segment").on(table.segmentId),
    index("idx_scan_candidates_version").on(table.documentVersionId),
  ],
);
