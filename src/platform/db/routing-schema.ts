import {
  pgTable,
  varchar,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./ingestion-schema.js";

export const laneAssignments = pgTable(
  "lane_assignments",
  {
    anchorId: varchar("anchor_id", { length: 128 }).primaryKey(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    segmentId: varchar("segment_id", { length: 128 }).notNull(),
    lane: varchar("lane", { length: 32 }).notNull(),
    reasons: jsonb("reasons").notNull(),
    routerVersion: varchar("router_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_lane_assignments_lane_dvid").on(
      table.lane,
      table.documentVersionId,
    ),
    index("idx_lane_assignments_dvid").on(table.documentVersionId),
  ],
);

export const routingResults = pgTable("routing_results", {
  documentVersionId: uuid("document_version_id")
    .primaryKey()
    .references(() => documentVersions.documentVersionId),
  routerVersion: varchar("router_version", { length: 64 }).notNull(),
  assignments: jsonb("assignments").notNull(),
  coverage: jsonb("coverage").notNull(),
  laneSummary: jsonb("lane_summary").notNull(),
  totalAssignments: integer("total_assignments").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
