import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentVersions } from "./ingestion-schema.js";

export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    plan: varchar("plan", { length: 32 }).notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chk_user_plan",
      sql`${table.plan} IN ('free','waitlisted')`,
    ),
  ],
);

export const userBills = pgTable(
  "user_bills",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    archived: varchar("archived", { length: 5 }).notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_user_bills_user").on(table.userId),
    index("idx_user_bills_dvid").on(table.documentVersionId),
  ],
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    entryId: uuid("entry_id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    email: varchar("email", { length: 512 }).notNull(),
    trigger: varchar("trigger", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_waitlist_user").on(table.userId),
    check(
      "chk_waitlist_trigger",
      sql`${table.trigger} IN ('bill_limit','calendar_sync')`,
    ),
  ],
);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    connectionId: uuid("connection_id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId),
    provider: varchar("provider", { length: 32 }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    calendarId: varchar("calendar_id", { length: 512 }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_calendar_conn_user").on(table.userId),
  ],
);

export const syncedEvents = pgTable(
  "synced_events",
  {
    syncId: uuid("sync_id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.connectionId),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.documentVersionId),
    recordVersionId: uuid("record_version_id").notNull(),
    googleEventId: varchar("google_event_id", { length: 512 }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_synced_events_conn").on(table.connectionId),
    index("idx_synced_events_dvid").on(table.documentVersionId),
    index("idx_synced_events_record").on(table.recordVersionId),
  ],
);
