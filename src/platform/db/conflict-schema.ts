import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentVersions } from "./ingestion-schema.js";
import { registerRecords } from "./review-schema.js";

export const resolutionConflicts = pgTable(
  "resolution_conflicts",
  {
    conflictId: uuid("conflict_id").primaryKey().defaultRandom(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    anchorId: varchar("anchor_id", { length: 128 }).notNull(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => registerRecords.recordId),
    previousStatutoryDate: varchar("previous_statutory_date", { length: 10 }).notNull(),
    previousAdjustedDate: varchar("previous_adjusted_date", { length: 10 }).notNull(),
    newStatutoryDate: varchar("new_statutory_date", { length: 10 }),
    newAdjustedDate: varchar("new_adjusted_date", { length: 10 }),
    newResolved: boolean("new_resolved").notNull(),
    previousGrammarVersion: varchar("previous_grammar_version", { length: 64 }).notNull(),
    newGrammarVersion: varchar("new_grammar_version", { length: 64 }).notNull(),
    previousResolverVersion: varchar("previous_resolver_version", { length: 64 }).notNull(),
    newResolverVersion: varchar("new_resolver_version", { length: 64 }).notNull(),
    status: varchar("conflict_status", { length: 32 })
      .notNull()
      .default("pending_review"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: varchar("resolved_by", { length: 256 }),
  },
  (table) => [
    index("idx_conflicts_dvid").on(table.documentVersionId),
    index("idx_conflicts_record").on(table.recordId),
    index("idx_conflicts_status").on(table.status),
    check(
      "chk_conflict_status",
      sql`${table.status} IN ('pending_review')`,
    ),
  ],
);
