import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const modelCalls = pgTable("model_calls", {
  modelCallId: varchar("model_call_id", { length: 128 }).primaryKey(),
  documentVersionId: varchar("document_version_id", { length: 128 }).notNull(),
  segmentId: varchar("segment_id", { length: 128 }).notNull(),
  modelId: varchar("model_id", { length: 256 }).notNull(),
  promptHash: varchar("prompt_hash", { length: 128 }).notNull(),
  requestPayload: text("request_payload").notNull(),
  responsePayload: text("response_payload").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  correlationId: varchar("correlation_id", { length: 256 }).notNull(),
  repaired: boolean("repaired").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
