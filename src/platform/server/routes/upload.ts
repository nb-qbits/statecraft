/**
 * POST /api/v1/documents/upload
 *
 * Multipart form-data upload. Creates or retrieves a document version.
 *
 * Fields (multipart form parts):
 *
 *   file             (required)  The document bytes. Content-Type determines mimeType.
 *                                Supported: text/plain,
 *                                application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *                                Max size: 50 MB.
 *
 *   legalIdentity    (required)  JSON string: { jurisdiction, session, instrumentType, number, stage, chapter }
 *                                All string fields. chapter may be null.
 *                                Identifies the legislative instrument. Two uploads with the same
 *                                legal identity (jurisdiction + session + instrumentType + number + stage)
 *                                route to the same source document.
 *
 *   documentId       (optional)  UUID of an existing source document. When provided, the version is
 *                                added under this document. When omitted, the service finds or creates
 *                                a document by legal identity.
 *
 *   legislativeStatus (optional) One of: introduced, engrossed, enrolled, enacted, vetoed, failed, unknown.
 *                                Defaults to "unknown". If an Open States API key is configured and
 *                                this field is omitted or "unknown", the service attempts lookup.
 *
 *   authoritativeSource (optional) URL of the authoritative source for the legislative status.
 *
 *   asOfDate          (optional)  ISO date (YYYY-MM-DD) when the legislative status was observed.
 *
 * Responses:
 *   201  Document version created or existing duplicate returned.
 *   400  Validation error (unsupported type, corrupt file, oversized, missing fields).
 *   422  Unsupported document error.
 *   500  Internal error.
 *
 * Deduplication:
 *   Identical bytes uploaded to the same document produce the same version (idempotent).
 *   The response is the same DocumentVersion object in both cases.
 *
 * Example (curl):
 *
 *   # Upload a new document (creates source document by legal identity)
 *   curl -X POST http://localhost:3000/api/v1/documents/upload \
 *     -F 'file=@bill.txt;type=text/plain' \
 *     -F 'legalIdentity={"jurisdiction":"Virginia","session":"2025","instrumentType":"HB","number":"1234","stage":"introduced","chapter":null}'
 *
 *   # Upload a new version of an existing document
 *   curl -X POST http://localhost:3000/api/v1/documents/upload \
 *     -F 'file=@bill-v2.txt;type=text/plain' \
 *     -F 'legalIdentity={"jurisdiction":"Virginia","session":"2025","instrumentType":"HB","number":"1234","stage":"enrolled","chapter":null}' \
 *     -F 'documentId=<uuid from previous response>'
 *
 *   # Upload with explicit legislative status
 *   curl -X POST http://localhost:3000/api/v1/documents/upload \
 *     -F 'file=@enacted-bill.txt;type=text/plain' \
 *     -F 'legalIdentity={"jurisdiction":"Virginia","session":"2025","instrumentType":"HB","number":"5678","stage":"enrolled","chapter":"123"}' \
 *     -F 'legislativeStatus=enacted'
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../modules/shared/errors.js";
import { invalidInput } from "../../../modules/ingestion/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { LegalIdentity } from "../../../modules/ingestion/types.js";
import type { LegislativeStatus, DocumentId } from "../../../modules/shared/types.js";

const LegalIdentitySchema = z.object({
  jurisdiction: z.string().min(1, "jurisdiction is required"),
  session: z.string().min(1, "session is required"),
  instrumentType: z.string().min(1, "instrumentType is required"),
  number: z.string().min(1, "number is required"),
  stage: z.string().min(1, "stage is required"),
  chapter: z.string().nullable(),
});

const LEGISLATIVE_STATUS_VALUES = [
  "introduced", "engrossed", "enrolled", "enacted", "vetoed", "failed", "unknown",
] as const;
const LegislativeStatusSchema = z.enum(LEGISLATIVE_STATUS_VALUES);

interface UploadService {
  upload(input: {
    documentId?: DocumentId;
    bytes: Buffer;
    mimeType: string;
    legalIdentity: LegalIdentity;
    legislativeStatus?: LegislativeStatus;
    authoritativeSource?: string;
    asOfDate?: string;
  }): Promise<unknown>;
}

export function registerUploadRoutes(
  app: FastifyInstance,
  uploadService: UploadService,
  logger: Logger,
): void {
  app.post("/api/v1/documents/upload", async (req, reply) => {
    const contentType = req.headers["content-type"] ?? "";

    if (!contentType.startsWith("multipart/form-data")) {
      return reply.status(400).send({
        error: {
          code: "INVALID_CONTENT_TYPE",
          message: "Expected multipart/form-data",
        },
      });
    }

    try {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({
          error: {
            code: "MISSING_FILE",
            message: "No file provided in request",
          },
        });
      }

      const bytes = await data.toBuffer();
      const mimeType = data.mimetype;

      const fields = data.fields;

      // Validate legalIdentity shape
      const rawIdentity = parseJsonField(fields, "legalIdentity");
      if (!rawIdentity) {
        throw invalidInput("legalIdentity", "required JSON field is missing or malformed");
      }
      const identityResult = LegalIdentitySchema.safeParse(rawIdentity);
      if (!identityResult.success) {
        throw invalidInput(
          "legalIdentity",
          identityResult.error.issues.map((i) => i.message).join("; "),
        );
      }
      const legalIdentity = identityResult.data as LegalIdentity;

      // Validate legislativeStatus enum
      const rawStatus = getStringField(fields, "legislativeStatus");
      let legislativeStatus: LegislativeStatus | undefined;
      if (rawStatus) {
        const statusResult = LegislativeStatusSchema.safeParse(rawStatus);
        if (!statusResult.success) {
          throw invalidInput(
            "legislativeStatus",
            `must be one of: ${LEGISLATIVE_STATUS_VALUES.join(", ")}`,
          );
        }
        legislativeStatus = statusResult.data;
      }

      const documentId = getStringField(fields, "documentId") as
        | DocumentId
        | undefined;
      const authoritativeSource = getStringField(fields, "authoritativeSource");
      const asOfDate = getStringField(fields, "asOfDate");

      const uploadInput: Parameters<typeof uploadService.upload>[0] = {
        bytes,
        mimeType,
        legalIdentity,
      };
      if (documentId) uploadInput.documentId = documentId;
      if (legislativeStatus) uploadInput.legislativeStatus = legislativeStatus;
      if (authoritativeSource) uploadInput.authoritativeSource = authoritativeSource;
      if (asOfDate) uploadInput.asOfDate = asOfDate;

      const version = await uploadService.upload(uploadInput);

      return reply.status(201).send(version);
    } catch (err) {
      if (err instanceof AppError) {
        const status =
          err.category === "user_input"
            ? 400
            : err.category === "unsupported_document"
              ? 422
              : 500;
        logger.warn({ err: err.toJSON() }, "upload failed");
        return reply.status(status).send({ error: err.toJSON() });
      }
      logger.error({ err }, "unexpected upload error");
      return reply.status(500).send({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  });
}

function getStringField(
  fields: Record<string, unknown>,
  name: string,
): string | undefined {
  const field = fields[name];
  if (!field || typeof field !== "object") return undefined;
  const val = (field as { value?: string }).value;
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

function parseJsonField(
  fields: Record<string, unknown>,
  name: string,
): unknown | undefined {
  const raw = getStringField(fields, name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
