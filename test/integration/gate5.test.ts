/**
 * Gate 5 integration tests — Anchoring and Verification.
 *
 * Requires Docker stack running: docker compose up -d --build
 * Then: docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
 *       docker compose exec minio mc mb local/policyaction --ignore-existing
 *       docker compose exec app node dist/platform/db/migrate.js
 *
 * Run: npm run test:integration
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMPLE_BILL_TXT = readFileSync(
  resolve(__dirname, "../../fixtures/documents/simple-bill.txt"),
  "utf-8",
);
const HB35_PDF = readFileSync(
  resolve(__dirname, "../../fixtures/documents/va-hb35-restorative-housing.pdf"),
);

const UPLOAD_URL = "http://localhost:3000/api/v1/documents/upload";
const BASE_URL = "http://localhost:3000/api/v1/documents";

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
    chunks.push(
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
    );
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), boundary };
}

interface AnchorResultEntry {
  anchorId: string;
  segmentId: string;
  quotedText: string;
  kind: string;
  anchored: boolean;
  method?: string;
  normalizedStart?: number;
  normalizedEnd?: number;
  originalStart?: number;
  originalEnd?: number;
  reason?: string;
}

interface AnchoringResult {
  documentVersionId: string;
  anchorerVersion: string;
  totalProposals: number;
  totalAnchored: number;
  totalFailed: number;
  results: AnchorResultEntry[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const RUN = Math.random().toString(36).slice(2, 8);

const HB35_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2026",
  instrumentType: "HB",
  number: `g5-${RUN}`,
  stage: "introduced",
  chapter: null,
};

async function uploadDoc(opts: {
  content: string | Buffer;
  filename: string;
  contentType: string;
  legalIdentity: Record<string, unknown>;
}): Promise<{
  status: number;
  body: { documentVersionId: string } & ErrorResult;
}> {
  const parts: Array<{
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }> = [
    {
      name: "file",
      value: opts.content,
      filename: opts.filename,
      contentType: opts.contentType,
    },
    { name: "legalIdentity", value: JSON.stringify(opts.legalIdentity) },
  ];
  const { body, boundary } = buildMultipartBody(parts);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return {
    status: res.status,
    body: (await res.json()) as { documentVersionId: string } & ErrorResult,
  };
}

async function parseDoc(
  documentVersionId: string,
): Promise<{ status: number; body: { segmentCount: number } & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/parse`, {
    method: "POST",
  });
  return {
    status: res.status,
    body: (await res.json()) as { segmentCount: number } & ErrorResult,
  };
}

async function scanDoc(
  documentVersionId: string,
): Promise<{ status: number; body: { segmentCount: number } & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/scan`, {
    method: "POST",
  });
  return {
    status: res.status,
    body: (await res.json()) as { segmentCount: number } & ErrorResult,
  };
}

async function extractDoc(
  documentVersionId: string,
): Promise<{ status: number; body: Record<string, unknown> & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/extract`, {
    method: "POST",
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown> & ErrorResult,
  };
}

async function anchorDoc(
  documentVersionId: string,
): Promise<{ status: number; body: AnchoringResult & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/anchor`, {
    method: "POST",
  });
  return {
    status: res.status,
    body: (await res.json()) as AnchoringResult & ErrorResult,
  };
}

describe("Gate 5 — Anchoring and Verification", () => {
  it("HB 35: adversarial 'within five business days of such placement' FAILS to anchor", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate5.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `5035-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);
    await extractDoc(r.body.documentVersionId);

    const a = await anchorDoc(r.body.documentVersionId);
    expect(a.status).toBe(200);

    const adversarial = a.body.results.find(
      (ar) => ar.quotedText === "within five business days of such placement",
    );
    expect(adversarial).toBeDefined();
    expect(adversarial!.anchored).toBe(false);
    expect(adversarial!.reason).toBeTruthy();
    expect(adversarial!).not.toHaveProperty("method");
    expect(adversarial!).not.toHaveProperty("normalizedStart");
  });

  it("HB 35: five genuine spans anchor with valid offsets", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-genuine.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `5036-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);
    await extractDoc(r.body.documentVersionId);

    const a = await anchorDoc(r.body.documentVersionId);
    expect(a.status).toBe(200);

    const genuineSpans = [
      "within 30 days",
      "no longer than seven days",
      "every two business days",
      "within one working day",
      "within 24 hours",
    ];

    for (const span of genuineSpans) {
      const result = a.body.results.find((ar) => ar.quotedText === span);
      expect(result).toBeDefined();
      expect(result!.anchored).toBe(true);
      expect(result!.method).toBeTruthy();
      expect(typeof result!.normalizedStart).toBe("number");
      expect(typeof result!.normalizedEnd).toBe("number");
      expect(typeof result!.originalStart).toBe("number");
      expect(typeof result!.originalEnd).toBe("number");
      expect(result!.normalizedEnd).toBeGreaterThan(result!.normalizedStart!);
      expect(result!.originalEnd).toBeGreaterThan(result!.originalStart!);
    }
  });

  it("anchor before extraction → error", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-noextract.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `5001-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);

    const a = await anchorDoc(r.body.documentVersionId);
    expect(a.status).toBe(400);
    expect(a.body.error.code).toBe("DOCUMENT_NOT_EXTRACTED");
  });

  it("idempotency: anchor twice → same results", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-idem.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `5037-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);
    await extractDoc(r.body.documentVersionId);

    const a1 = await anchorDoc(r.body.documentVersionId);
    expect(a1.status).toBe(200);

    const a2 = await anchorDoc(r.body.documentVersionId);
    expect(a2.status).toBe(200);

    expect(a2.body.totalProposals).toBe(a1.body.totalProposals);
    expect(a2.body.totalAnchored).toBe(a1.body.totalAnchored);
    expect(a2.body.totalFailed).toBe(a1.body.totalFailed);

    const ids1 = a1.body.results.map((r) => r.anchorId).sort();
    const ids2 = a2.body.results.map((r) => r.anchorId).sort();
    expect(ids1).toEqual(ids2);
  });

  it("no code path returns offsets or method when anchoring fails", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-failcheck.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `5038-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);
    await extractDoc(r.body.documentVersionId);

    const a = await anchorDoc(r.body.documentVersionId);
    expect(a.status).toBe(200);

    const failed = a.body.results.filter((ar) => !ar.anchored);
    expect(failed.length).toBeGreaterThan(0);

    for (const f of failed) {
      expect(f.reason).toBeTruthy();
      expect(f).not.toHaveProperty("method");
      expect(f).not.toHaveProperty("normalizedStart");
      expect(f).not.toHaveProperty("normalizedEnd");
      expect(f).not.toHaveProperty("originalStart");
      expect(f).not.toHaveProperty("originalEnd");
    }
  });
});
