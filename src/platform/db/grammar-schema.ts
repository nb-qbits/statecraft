import {
  pgTable,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./ingestion-schema.js";

export const grammarResults = pgTable("grammar_results", {
  anchorId: varchar("anchor_id", { length: 128 }).primaryKey(),
  documentVersionId: uuid("document_version_id")
    .notNull()
    .references(() => documentVersions.documentVersionId),
  segmentId: varchar("segment_id", { length: 128 }).notNull(),
  inputText: varchar("input_text", { length: 4096 }).notNull(),
  parsed: boolean("parsed").notNull(),
  expression: jsonb("expression"),
  failureReason: varchar("failure_reason", { length: 1024 }),
  failurePosition: integer("failure_position"),
  grammarVersion: varchar("grammar_version", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
