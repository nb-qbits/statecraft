import {
  pgTable,
  varchar,
  boolean,
  timestamp,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./ingestion-schema.js";

export const resolutionResults = pgTable("resolution_results", {
  anchorId: varchar("anchor_id", { length: 128 }).primaryKey(),
  documentVersionId: uuid("document_version_id")
    .notNull()
    .references(() => documentVersions.documentVersionId),
  segmentId: varchar("segment_id", { length: 128 }).notNull(),
  inputText: varchar("input_text", { length: 4096 }).notNull(),
  expressionKind: varchar("expression_kind", { length: 64 }).notNull(),
  expression: jsonb("expression").notNull(),
  resolved: boolean("resolved").notNull(),
  statutoryDate: varchar("statutory_date", { length: 10 }),
  adjustedDate: varchar("adjusted_date", { length: 10 }),
  ruleIds: jsonb("rule_ids"),
  citations: jsonb("citations"),
  packVersion: varchar("pack_version", { length: 64 }),
  warnings: jsonb("warnings").notNull(),
  reason: varchar("reason", { length: 1024 }),
  missingInputs: jsonb("missing_inputs"),
  resolutionInputs: jsonb("resolution_inputs").notNull(),
  resolverVersion: varchar("resolver_version", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
