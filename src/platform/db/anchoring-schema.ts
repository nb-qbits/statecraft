import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const anchorResults = pgTable(
  "anchor_results",
  {
    anchorId: varchar("anchor_id", { length: 128 }).primaryKey(),
    documentVersionId: varchar("document_version_id", { length: 128 }).notNull(),
    segmentId: varchar("segment_id", { length: 128 }).notNull(),
    quotedText: text("quoted_text").notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    anchored: boolean("anchored").notNull(),
    method: varchar("method", { length: 32 }),
    normalizedStart: integer("normalized_start"),
    normalizedEnd: integer("normalized_end"),
    originalStart: integer("original_start"),
    originalEnd: integer("original_end"),
    reason: text("reason"),
    actor: text("actor"),
    actorQuotedText: text("actor_quoted_text"),
    actorAnchored: boolean("actor_anchored"),
    dependsOnQuotedText: text("depends_on_quoted_text"),
    dependsOnDescription: text("depends_on_description"),
    dependsOnAnchored: boolean("depends_on_anchored"),
    anchorerVersion: varchar("anchorer_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chk_anchor_method",
      sql`${table.method} IS NULL OR ${table.method} IN ('exact', 'normalized_exact', 'fuzzy')`,
    ),
  ],
);
