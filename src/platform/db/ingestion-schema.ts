import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
  ],
);
