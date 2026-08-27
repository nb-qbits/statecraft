import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sourceDocuments = pgTable(
  "source_documents",
  {
    documentId: uuid("document_id").primaryKey().defaultRandom(),
    jurisdiction: varchar("jurisdiction", { length: 255 }).notNull(),
    session: varchar("session", { length: 64 }).notNull(),
    instrumentType: varchar("instrument_type", { length: 32 }).notNull(),
    number: varchar("number", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_source_document_legal_identity").on(
      table.jurisdiction,
      table.session,
      table.instrumentType,
      table.number,
      table.stage,
    ),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    documentVersionId: uuid("document_version_id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => sourceDocuments.documentId),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    legalIdentity: jsonb("legal_identity").notNull(),
    legislativeStatus: varchar("legislative_status", { length: 32 })
      .notNull()
      .default("unknown"),
    statusProvenance: varchar("status_provenance", { length: 32 })
      .notNull()
      .default("default_unknown"),
    parseStatus: varchar("parse_status", { length: 32 })
      .notNull()
      .default("unparsed"),
    scanStatus: varchar("scan_status", { length: 32 })
      .notNull()
      .default("unscanned"),
    scannerVersion: varchar("scanner_version", { length: 64 }),
    extractionStatus: varchar("extraction_status", { length: 32 })
      .notNull()
      .default("unextracted"),
    extractorVersion: varchar("extractor_version", { length: 64 }),
    anchoringStatus: varchar("anchoring_status", { length: 32 })
      .notNull()
      .default("unanchored"),
    anchorerVersion: varchar("anchorer_version", { length: 64 }),
    grammarStatus: varchar("grammar_status", { length: 32 })
      .notNull()
      .default("unparsed_grammar"),
    grammarVersion: varchar("grammar_version", { length: 64 }),
    resolutionStatus: varchar("resolution_status", { length: 32 })
      .notNull()
      .default("unresolved_resolver"),
    resolverVersion: varchar("resolver_version", { length: 64 }),
    evaluationStatus: varchar("evaluation_status", { length: 32 })
      .notNull()
      .default("unevaluated"),
    evaluatorVersion: varchar("evaluator_version", { length: 64 }),
    routingStatus: varchar("routing_status", { length: 32 })
      .notNull()
      .default("unrouted"),
    routerVersion: varchar("router_version", { length: 64 }),
    nonBodyContent: jsonb("non_body_content"),
    authoritativeSource: varchar("authoritative_source", { length: 2048 }),
    asOfDate: varchar("as_of_date", { length: 10 }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_document_version_content_hash").on(
      table.documentId,
      table.contentHash,
    ),
    check(
      "chk_legislative_status",
      sql`${table.legislativeStatus} IN ('introduced','engrossed','enrolled','enacted','vetoed','failed','unknown')`,
    ),
    check(
      "chk_status_provenance",
      sql`${table.statusProvenance} IN ('caller_asserted','metadata_source','default_unknown')`,
    ),
    check(
      "chk_parse_status",
      sql`${table.parseStatus} IN ('unparsed','parsed','parse_failed')`,
    ),
    check(
      "chk_scan_status",
      sql`${table.scanStatus} IN ('unscanned','scanned')`,
    ),
    check(
      "chk_extraction_status",
      sql`${table.extractionStatus} IN ('unextracted','extracted','extraction_failed')`,
    ),
    check(
      "chk_anchoring_status",
      sql`${table.anchoringStatus} IN ('unanchored','anchored','anchoring_failed')`,
    ),
    check(
      "chk_grammar_status",
      sql`${table.grammarStatus} IN ('unparsed_grammar','parsed_grammar')`,
    ),
    check(
      "chk_resolution_status",
      sql`${table.resolutionStatus} IN ('unresolved_resolver','resolved_resolver')`,
    ),
    check(
      "chk_evaluation_status",
      sql`${table.evaluationStatus} IN ('unevaluated','evaluated')`,
    ),
    check(
      "chk_routing_status",
      sql`${table.routingStatus} IN ('unrouted','routed')`,
    ),
  ],
);
