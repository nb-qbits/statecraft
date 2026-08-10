import {
  pgTable,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentVersions } from "./ingestion-schema.js";

export const sourceSegments = pgTable(
  "source_segments",
  {
    segmentId: varchar("segment_id", { length: 128 }).primaryKey(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    structuralPath: varchar("structural_path", { length: 1024 }).notNull(),
    ordinal: integer("ordinal").notNull(),
    rawText: text("raw_text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    offsetMap: jsonb("offset_map").notNull(),
    parserAdapter: varchar("parser_adapter", { length: 64 }).notNull(),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    fidelity: varchar("fidelity", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_segment_identity").on(
      table.documentVersionId,
      table.structuralPath,
      table.contentHash,
      table.ordinal,
    ),
    check(
      "chk_fidelity",
      sql`${table.fidelity} IN ('declared','inferred','none')`,
    ),
  ],
);
