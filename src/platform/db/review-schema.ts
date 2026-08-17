import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentVersions } from "./ingestion-schema.js";

export const projects = pgTable("projects", {
  projectId: uuid("project_id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 512 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyses = pgTable(
  "analyses",
  {
    analysisId: uuid("analysis_id").primaryKey().defaultRandom(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    configHash: varchar("config_hash", { length: 128 }).notNull(),
    stageVersions: jsonb("stage_versions"),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_analysis_dvid_config").on(
      table.documentVersionId,
      table.configHash,
    ),
    check(
      "chk_analysis_status",
      sql`${table.status} IN ('pending','running','completed','failed')`,
    ),
  ],
);

export const proposals = pgTable(
  "proposals",
  {
    proposalId: uuid("proposal_id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.analysisId),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    anchorId: varchar("anchor_id", { length: 128 }).notNull(),
    segmentId: varchar("segment_id", { length: 128 }).notNull(),
    quotedText: text("quoted_text").notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    normalizedStart: integer("normalized_start").notNull(),
    normalizedEnd: integer("normalized_end").notNull(),
    originalStart: integer("original_start").notNull(),
    originalEnd: integer("original_end").notNull(),
    anchoringMethod: varchar("anchoring_method", { length: 32 }).notNull(),
    parsedExpression: jsonb("parsed_expression"),
    resolved: boolean("resolved").notNull(),
    statutoryDate: varchar("statutory_date", { length: 10 }),
    adjustedDate: varchar("adjusted_date", { length: 10 }),
    ruleIds: jsonb("rule_ids").notNull(),
    citations: jsonb("citations").notNull(),
    packVersion: varchar("pack_version", { length: 64 }),
    rrule: varchar("rrule", { length: 512 }),
    actor: text("actor"),
    actorQuotedText: text("actor_quoted_text"),
    dependsOnDescription: text("depends_on_description"),
    supportLevel: varchar("support_level", { length: 32 }).notNull(),
    lane: varchar("lane", { length: 32 }).notNull(),
    laneReasons: jsonb("lane_reasons").notNull(),
    status: varchar("proposal_status", { length: 32 })
      .notNull()
      .default("pending_review"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_proposal_analysis_anchor").on(
      table.analysisId,
      table.anchorId,
    ),
    index("idx_proposals_dvid").on(table.documentVersionId),
    index("idx_proposals_status").on(table.status),
    check(
      "chk_proposal_status",
      sql`${table.status} IN ('pending_review','accepted','rejected','split')`,
    ),
  ],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").references(() => proposals.proposalId),
    action: varchar("action", { length: 32 }).notNull(),
    reviewerId: varchar("reviewer_id", { length: 256 }).notNull(),
    beforeValues: jsonb("before_values"),
    afterValues: jsonb("after_values").notNull(),
    diff: jsonb("diff").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_review_event_idempotency").on(table.idempotencyKey),
    index("idx_review_events_proposal").on(table.proposalId),
    check(
      "chk_review_action",
      sql`${table.action} IN ('accept','edit_and_accept','reject','split','manual_add')`,
    ),
  ],
);

export const registerRecords = pgTable(
  "register_records",
  {
    recordId: uuid("record_id").primaryKey().defaultRandom(),
    recordVersionId: uuid("record_version_id").notNull().unique(),
    proposalId: uuid("proposal_id").references(() => proposals.proposalId),
    reviewEventId: uuid("review_event_id")
      .notNull()
      .references(() => reviewEvents.eventId),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    anchorId: varchar("anchor_id", { length: 128 }),
    segmentId: varchar("segment_id", { length: 128 }),
    quotedText: text("quoted_text"),
    kind: varchar("kind", { length: 64 }).notNull(),
    deadlineDate: varchar("deadline_date", { length: 10 }).notNull(),
    adjustedDate: varchar("adjusted_date", { length: 10 }).notNull(),
    ruleIds: jsonb("rule_ids").notNull(),
    citations: jsonb("citations").notNull(),
    packVersion: varchar("pack_version", { length: 64 }),
    deliverable: text("deliverable"),
    actor: text("actor"),
    conditions: text("conditions"),
    rrule: varchar("rrule", { length: 512 }),
    dateProvenance: varchar("date_provenance", { length: 32 }).notNull(),
    status: varchar("record_status", { length: 32 })
      .notNull()
      .default("active"),
    splitFromRecordId: uuid("split_from_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_register_records_dvid").on(table.documentVersionId),
    index("idx_register_records_status").on(table.status),
    index("idx_register_records_proposal").on(table.proposalId),
    check(
      "chk_record_status",
      sql`${table.status} IN ('active','superseded')`,
    ),
    check(
      "chk_date_provenance",
      sql`${table.dateProvenance} IN ('computed','generic_default','reviewer_asserted','verbatim_from_instrument')`,
    ),
  ],
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar("key", { length: 256 }).primaryKey(),
  endpoint: varchar("endpoint", { length: 512 }).notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
