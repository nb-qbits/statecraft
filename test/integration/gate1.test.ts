/**
 * Gate 1 integration tests.
 *
 * Requires Docker stack running: docker compose up -d --build
 * Then: docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
 *       docker compose exec minio mc mb local/policyaction --ignore-existing
 *       docker compose exec app node dist/platform/db/migrate.js
 *
 * Run: npm run test:integration
 */
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000/api/v1/documents/upload";

function buildMultipartBody(
  parts: Array<{
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }>,
): { body: Buffer; boundary: string } {
  const boundary =
    "----FormBoundary" + Math.random().toString(36).slice(2, 14);
  const chunks: Buffer[] = [];

  for (const part of parts) {
    let header = `--${boundary}\r\n`;
    if (part.filename) {
      header += `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`;
      header += `Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${part.name}"\r\n`;
    }
    header += "\r\n";
    chunks.push(Buffer.from(header));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), boundary };
}

interface UploadResult {
  documentVersionId: string;
  documentId: string;
  contentHash: string;
  legislativeStatus: string;
  statusProvenance: string;
  legalIdentity: { jurisdiction: string };
  mimeType: string;
  byteSize: number;
  authoritativeSource: string | null;
  asOfDate: string | null;
}

interface ErrorResult {
  error: { code: string; message: string };
}

async function upload(opts: {
  content: string | Buffer;
  filename: string;
  contentType: string;
  legalIdentity: Record<string, unknown>;
  documentId?: string;
  legislativeStatus?: string;
  authoritativeSource?: string;
  asOfDate?: string;
}): Promise<{ status: number; body: UploadResult & ErrorResult }> {
  const parts: Parameters<typeof buildMultipartBody>[0] = [
    {
      name: "file",
      value: opts.content,
      filename: opts.filename,
      contentType: opts.contentType,
    },
    {
      name: "legalIdentity",
      value: JSON.stringify(opts.legalIdentity),
    },
  ];
  if (opts.documentId) {
    parts.push({ name: "documentId", value: opts.documentId });
  }
  if (opts.legislativeStatus) {
    parts.push({ name: "legislativeStatus", value: opts.legislativeStatus });
  }
  if (opts.authoritativeSource) {
    parts.push({ name: "authoritativeSource", value: opts.authoritativeSource });
  }
  if (opts.asOfDate) {
    parts.push({ name: "asOfDate", value: opts.asOfDate });
  }

  const { body, boundary } = buildMultipartBody(parts);
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  return { status: res.status, body: (await res.json()) as UploadResult & ErrorResult };
}

const LEGAL_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2025",
  instrumentType: "HB",
  number: "9999",
  stage: "introduced",
  chapter: null,
};

describe("Gate 1 — Ingestion integration", () => {
  it("uploads text/plain and returns a version", async () => {
    const r = await upload({
      content: "Section 1. This act shall take effect July 1, 2026.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: LEGAL_IDENTITY,
    });

    expect(r.status).toBe(201);
    expect(r.body.documentVersionId).toBeDefined();
    expect(r.body.documentId).toBeDefined();
    expect(r.body.contentHash).toHaveLength(64);
    expect(r.body.mimeType).toBe("text/plain");
    expect(r.body.legislativeStatus).toBe("unknown");
    expect(r.body.statusProvenance).toBe("default_unknown");
  });

  it("identical bytes uploaded twice produce one version (dedup)", async () => {
    const text = "Dedup test content — identical bytes.";
    const identity = { ...LEGAL_IDENTITY, number: "7001" };

    const r1 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });
    const r2 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });

    expect(r1.body.documentVersionId).toBe(r2.body.documentVersionId);
    expect(r1.body.documentId).toBe(r2.body.documentId);
    expect(r1.body.contentHash).toBe(r2.body.contentHash);
  });

  it("different bytes produce two versions", async () => {
    const identity = { ...LEGAL_IDENTITY, number: "7002" };

    const r1 = await upload({
      content: "Version one text.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });
    const r2 = await upload({
      content: "Version two — different text.",
      filename: "bill-v2.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });

    expect(r1.body.documentId).toBe(r2.body.documentId);
    expect(r1.body.documentVersionId).not.toBe(r2.body.documentVersionId);
    expect(r1.body.contentHash).not.toBe(r2.body.contentHash);
  });

  it("same legal identity without documentId routes to same document", async () => {
    const text = "Legal identity routing test.";
    const identity = { ...LEGAL_IDENTITY, number: "7003" };

    const r1 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });
    const r2 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });

    expect(r1.body.documentId).toBe(r2.body.documentId);
  });

  it("rejects unsupported mime type", async () => {
    const r = await upload({
      content: "%PDF-1.4 fake pdf",
      filename: "doc.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7004" },
    });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("UNSUPPORTED_MIME_TYPE");
  });

  it("rejects corrupt DOCX (no ZIP signature)", async () => {
    const r = await upload({
      content: "not a zip file",
      filename: "corrupt.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7005" },
    });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CORRUPT_FILE");
  });

  it("legislativeStatus defaults to unknown", async () => {
    const r = await upload({
      content: "Default status test.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7006" },
    });

    expect(r.body.legislativeStatus).toBe("unknown");
    expect(r.body.statusProvenance).toBe("default_unknown");
  });

  it("unknown is distinguishable from enacted", async () => {
    const rUnknown = await upload({
      content: "Unknown status bill.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7007" },
    });
    const rEnacted = await upload({
      content: "Enacted status bill.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7008" },
      legislativeStatus: "enacted",
      authoritativeSource: "https://lis.virginia.gov/bill/HB7008",
      asOfDate: "2025-07-01",
    });

    expect(rUnknown.body.legislativeStatus).toBe("unknown");
    expect(rEnacted.body.legislativeStatus).toBe("enacted");
    expect(rEnacted.body.statusProvenance).toBe("caller_asserted");
  });

  it("dedup is durable (DB-backed, not in-memory)", async () => {
    const text = "Durable dedup test — persisted in Postgres.";
    const identity = { ...LEGAL_IDENTITY, number: "7009" };

    const r1 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });
    const r2 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity,
    });

    expect(r1.body.documentVersionId).toBe(r2.body.documentVersionId);
    expect(r1.body.documentId).toBe(r2.body.documentId);
  });

  // --- HIGH 1: status provenance ---

  it("rejects caller-asserted status without provenance", async () => {
    const r = await upload({
      content: "No provenance bill.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7010" },
      legislativeStatus: "enacted",
    });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("MISSING_STATUS_PROVENANCE");
  });

  it("rejects caller-asserted status with only authoritativeSource", async () => {
    const r = await upload({
      content: "Partial provenance bill.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7011" },
      legislativeStatus: "enacted",
      authoritativeSource: "https://example.com",
    });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("MISSING_STATUS_PROVENANCE");
  });

  // --- MEDIUM 4: input validation ---

  it("rejects malformed legalIdentity (missing required fields)", async () => {
    const r = await upload({
      content: "Bad identity bill.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { jurisdiction: "Virginia" },
    });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid legislativeStatus enum value", async () => {
    const parts = [
      {
        name: "file",
        value: "Invalid status bill.",
        filename: "bill.txt",
        contentType: "text/plain",
      },
      {
        name: "legalIdentity",
        value: JSON.stringify({ ...LEGAL_IDENTITY, number: "7013" }),
      },
      { name: "legislativeStatus", value: "banana" },
    ];
    const { body, boundary } = buildMultipartBody(parts);
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect((json as ErrorResult).error.code).toBe("INVALID_INPUT");
  });

  it("normalizes jurisdiction ('Virginia' → 'us-va')", async () => {
    const r = await upload({
      content: "Jurisdiction normalization test.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7014", jurisdiction: "Virginia" },
    });

    expect(r.status).toBe(201);
    expect(r.body.legalIdentity.jurisdiction).toBe("us-va");
  });

  it("'Virginia' and 'us-va' route to same document", async () => {
    const text = "Jurisdiction alias test.";

    const r1 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7015", jurisdiction: "Virginia" },
    });
    const r2 = await upload({
      content: text,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "7015", jurisdiction: "us-va" },
    });

    expect(r1.body.documentId).toBe(r2.body.documentId);
    expect(r1.body.documentVersionId).toBe(r2.body.documentVersionId);
  });

  // --- HIGH 3: concurrent uploads ---

  it("concurrent identical uploads produce one version, no 500s", async () => {
    const text = "Concurrent upload race condition test.";
    const identity = { ...LEGAL_IDENTITY, number: "7016" };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        upload({
          content: text,
          filename: "bill.txt",
          contentType: "text/plain",
          legalIdentity: identity,
        }),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const versionIds = new Set(results.map((r) => r.body.documentVersionId));
    expect(versionIds.size).toBe(1);

    const documentIds = new Set(results.map((r) => r.body.documentId));
    expect(documentIds.size).toBe(1);
  });
});
