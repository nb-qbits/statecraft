import {
  pgTable,
  varchar,
  timestamp,
  jsonb,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { documentVersions } from "./ingestion-schema.js";

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
