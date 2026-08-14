import {
  pgTable,
  varchar,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const deadlineOccurrences = pgTable("deadline_occurrences", {
  occurrenceId: varchar("occurrence_id", { length: 128 }).primaryKey(),
  recordVersionId: varchar("record_version_id", { length: 128 }).notNull(),
  occurrenceDate: varchar("occurrence_date", { length: 10 }).notNull(),
  adjustedDate: varchar("adjusted_date", { length: 10 }).notNull(),
  ruleIds: jsonb("rule_ids").notNull(),
  citations: jsonb("citations").notNull(),
  sequenceNumber: integer("sequence_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
