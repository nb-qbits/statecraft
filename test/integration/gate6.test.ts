/**
 * Gate 6 integration tests — Legal Date Grammar.
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
const ADVERSARIAL_TXT = readFileSync(
  resolve(__dirname, "../../fixtures/documents/adversarial-temporal.txt"),
  "utf-8",
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

interface GrammarResultEntry {
  anchorId: string;
  segmentId: string;
  text: string;
  parsed: boolean;
  expression?: {
    kind: string;
    [key: string]: unknown;
  };
  reason?: string;
  position?: number;
}

interface GrammarResult {
  documentVersionId: string;
  grammarVersion: string;
  totalSpans: number;
  totalParsed: number;
  totalFailed: number;
  results: GrammarResultEntry[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const RUN = Math.random().toString(36).slice(2, 8);

const HB35_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2026",
  instrumentType: "HB",
  number: `g6-${RUN}`,
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

async function pipeline(
  documentVersionId: string,
): Promise<void> {
  await fetch(`${BASE_URL}/${documentVersionId}/parse`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/scan`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/extract`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/anchor`, { method: "POST" });
}

async function parseTemporalDoc(
  documentVersionId: string,
): Promise<{ status: number; body: GrammarResult & ErrorResult }> {
  const res = await fetch(
    `${BASE_URL}/${documentVersionId}/parse-temporal`,
    { method: "POST" },
  );
  return {
    status: res.status,
    body: (await res.json()) as GrammarResult & ErrorResult,
  };
}

describe("Gate 6 — Legal Date Grammar", () => {
  it("HB 35: parses all five HB 35 temporal forms through the grammar", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate6.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `6035-${RUN}` },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.grammarVersion).toBe("1.0.0");
    expect(g.body.totalSpans).toBeGreaterThan(0);

    const hb35Forms: Record<string, { kind: string; [k: string]: unknown }> = {
      "within 30 days": {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        boundKind: "within",
      },
      "no longer than seven days": {
        kind: "relative_duration",
        quantity: 7,
        unit: "days",
        boundKind: "no_longer_than",
      },
      "every two business days": {
        kind: "recurrence",
        quantity: 2,
        unit: "days",
        dayKind: "business",
      },
      "within one working day": {
        kind: "relative_duration",
        quantity: 1,
        unit: "days",
        dayKind: "working",
        boundKind: "within",
      },
      "within 24 hours": {
        kind: "relative_duration",
        quantity: 24,
        unit: "hours",
        boundKind: "within",
      },
    };

    for (const [text, expectedFields] of Object.entries(hb35Forms)) {
      const entry = g.body.results.find((r) => r.text === text);
      expect(entry, `expected grammar result for "${text}"`).toBeDefined();
      expect(entry!.parsed, `"${text}" should parse successfully`).toBe(true);
      if (entry!.parsed) {
        for (const [key, val] of Object.entries(expectedFields)) {
          expect(entry!.expression![key], `"${text}".${key}`).toBe(val);
        }
      }
    }
  });

  it("HB 35: adversarial span 'within five business days of such placement' fails grammar", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate6-adversarial.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `6036-${RUN}` },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    const adversarial = g.body.results.find(
      (r) => r.text === "within five business days of such placement",
    );
    if (adversarial) {
      expect(adversarial.parsed).toBe(false);
      expect(adversarial.reason).toBeTruthy();
    }
  });

  it("simple-bill: 'effective date of this act' is outside grammar scope, fails parse", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate6.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `6001-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    const edat = g.body.results.find(
      (r) => r.text === "effective date of this act",
    );
    if (edat) {
      expect(edat.parsed).toBe(false);
    }
  });

  it("parse-temporal before anchoring → error", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-noanchor.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `6002-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fetch(`${BASE_URL}/${r.body.documentVersionId}/parse`, {
      method: "POST",
    });

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(400);
    expect(g.body.error.code).toBe("DOCUMENT_NOT_ANCHORED");
  });

  it("idempotency: parse-temporal twice → same results", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate6-idem.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `6037-${RUN}` },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g1 = await parseTemporalDoc(r.body.documentVersionId);
    expect(g1.status).toBe(200);

    const g2 = await parseTemporalDoc(r.body.documentVersionId);
    expect(g2.status).toBe(200);

    expect(g2.body.totalSpans).toBe(g1.body.totalSpans);
    expect(g2.body.totalParsed).toBe(g1.body.totalParsed);
    expect(g2.body.totalFailed).toBe(g1.body.totalFailed);

    const ids1 = g1.body.results.map((r) => r.anchorId).sort();
    const ids2 = g2.body.results.map((r) => r.anchorId).sort();
    expect(ids1).toEqual(ids2);
  });

  it("adversarial fixture: all five vague phrases reach grammar and are refused", async () => {
    const r = await uploadDoc({
      content: ADVERSARIAL_TXT,
      filename: "adversarial-temporal.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `6099-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.totalParsed).toBe(0);
    expect(g.body.totalFailed).toBe(5);

    const adversarialPhrases = [
      "sometime next spring",
      "as soon as practicable",
      "within a reasonable period",
      "30",
      "the first day of the fourth month following adjournment",
    ];

    for (const phrase of adversarialPhrases) {
      const entry = g.body.results.find((r) => r.text === phrase);
      expect(entry, `expected grammar result for "${phrase}"`).toBeDefined();
      expect(entry!.parsed, `"${phrase}" must be rejected`).toBe(false);
      expect(entry!.reason, `"${phrase}" must have a reason`).toBeTruthy();
      expect(typeof entry!.position).toBe("number");
    }
  });

  it("every result has either expression or reason — never both, never neither", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate6-shape.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...HB35_IDENTITY, number: `6038-${RUN}` },
    });
    expect(r.status).toBe(201);

    await pipeline(r.body.documentVersionId);

    const g = await parseTemporalDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    for (const result of g.body.results) {
      if (result.parsed) {
        expect(result.expression).toBeDefined();
        expect(result.expression!.kind).toBeTruthy();
        expect(result).not.toHaveProperty("reason");
      } else {
        expect(result.reason).toBeTruthy();
        expect(result).not.toHaveProperty("expression");
      }
    }
  });
});
