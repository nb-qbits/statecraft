import {
  pgTable,
  varchar,
  boolean,
  timestamp,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./ingestion-schema.js";

export const evaluationResults = pgTable("evaluation_results", {
  anchorId: varchar("anchor_id", { length: 128 }).primaryKey(),
  documentVersionId: uuid("document_version_id")
    .notNull()
    .references(() => documentVersions.documentVersionId),
  segmentId: varchar("segment_id", { length: 128 }).notNull(),
  quotedText: varchar("quoted_text", { length: 4096 }).notNull(),
  deterministicPassed: boolean("deterministic_passed").notNull(),
  deterministicChecks: jsonb("deterministic_checks").notNull(),
  evaluatorVerdict: varchar("evaluator_verdict", { length: 32 }),
  supportLevel: varchar("support_level", { length: 32 }).notNull(),
  promptHash: varchar("prompt_hash", { length: 128 }),
  evaluatorVersion: varchar("evaluator_version", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
