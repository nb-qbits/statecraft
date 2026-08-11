/**
 * Gate 4 integration tests — Model Gateway and Span Proposal.
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

interface ExtractionSegment {
  segmentId: string;
  modelCallId: string;
  repaired: boolean;
  proposals: Array<{
    segmentId: string;
    quotedText: string;
    kind: string;
  }>;
}

interface ExtractionResult {
  documentVersionId: string;
  extractorVersion: string;
  segmentCount: number;
  segmentsSkipped: number;
  totalProposals: number;
  totalRepaired: number;
  segments: ExtractionSegment[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const RUN = Math.random().toString(36).slice(2, 8);

const LEGAL_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2025",
  instrumentType: "HB",
  number: `g4-${RUN}`,
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
): Promise<{
  status: number;
  body: ExtractionResult & ErrorResult;
}> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/extract`, {
    method: "POST",
  });
  return {
    status: res.status,
    body: (await res.json()) as ExtractionResult & ErrorResult,
  };
}

describe("Gate 4 — Model Gateway and Span Proposal", () => {
  it("simple-bill.txt: extracts proposals with verbatim quoted spans", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: `4001-${RUN}` },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const e = await extractDoc(r.body.documentVersionId);
    expect(e.status).toBe(200);

    expect(e.body.extractorVersion).toBe("1.0.0");
    expect(e.body.segmentCount).toBeGreaterThan(0);

    const allProposals = e.body.segments.flatMap((seg) => seg.proposals);
    const quotedTexts = allProposals.map((p) => p.quotedText);
    expect(quotedTexts).toContain("within 30 days");
    expect(quotedTexts).toContain("effective date of this act");
    expect(quotedTexts).toContain("July 1, 2025");

    for (const seg of e.body.segments) {
      expect(seg.modelCallId).toMatch(/^mcall_/);
      for (const proposal of seg.proposals) {
        expect(proposal.segmentId).toBeTruthy();
        expect(proposal.quotedText).toBeTruthy();
        expect([
          "obligation_deadline",
          "effective_date",
          "duration",
          "temporal_constraint",
        ]).toContain(proposal.kind);
        expect(proposal).not.toHaveProperty("date");
        expect(proposal).not.toHaveProperty("normalizedValue");
        expect(proposal).not.toHaveProperty("computedDate");
      }
    }
  });

  it("extract before scan → error", async () => {
    const r = await uploadDoc({
      content: "Unparsed content for extract test.",
      filename: "unparsed.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: `4002-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);

    const e = await extractDoc(r.body.documentVersionId);
    expect(e.status).toBe(400);
    expect(e.body.error.code).toBe("DOCUMENT_NOT_SCANNED");
  });

  it("idempotency: extract twice → same result", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-idem.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: `4003-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);

    const e1 = await extractDoc(r.body.documentVersionId);
    expect(e1.status).toBe(200);

    const e2 = await extractDoc(r.body.documentVersionId);
    expect(e2.status).toBe(200);

    expect(e2.body.totalProposals).toBe(e1.body.totalProposals);
  });

  it("HB 35 PDF: duration segments return verbatim quoted spans", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `4035-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const e = await extractDoc(r.body.documentVersionId);
    expect(e.status).toBe(200);

    expect(e.body.segmentCount).toBeGreaterThan(0);

    const allProposals = e.body.segments.flatMap((seg) => seg.proposals);
    const quotedTexts = allProposals.map((p) => p.quotedText);

    expect(quotedTexts).toContain("within 30 days");
    expect(quotedTexts).toContain("within one working day");
    expect(quotedTexts).toContain("every two business days");

    for (const seg of e.body.segments) {
      for (const proposal of seg.proposals) {
        expect(proposal).not.toHaveProperty("date");
        expect(proposal).not.toHaveProperty("value");
        expect(proposal).not.toHaveProperty("normalizedDate");
      }
    }
  });

  it("INV-3 boundary: model-authored quote not in segment is accepted (anchoring is Module 5)", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-adv.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `4036-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);

    const e = await extractDoc(r.body.documentVersionId);
    expect(e.status).toBe(200);

    const medicalSeg = e.body.segments.find((seg) =>
      seg.proposals.some((p) => p.quotedText === "within five business days of such placement"),
    );
    expect(medicalSeg).toBeDefined();
    expect(medicalSeg!.proposals[0]!.quotedText).toBe(
      "within five business days of such placement",
    );
    expect(medicalSeg!.proposals[0]!.kind).toBe("duration");
  });

  it("proposal output schema has no date, value, or computed field", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "schema-check.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: `4004-${RUN}` },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);
    await scanDoc(r.body.documentVersionId);

    const e = await extractDoc(r.body.documentVersionId);
    expect(e.status).toBe(200);

    for (const seg of e.body.segments) {
      for (const proposal of seg.proposals) {
        const keys = Object.keys(proposal);
        expect(keys).toEqual(["segmentId", "quotedText", "kind"]);
      }
    }
  });
});
