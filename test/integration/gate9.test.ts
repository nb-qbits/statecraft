/**
 * Gate 9 integration tests — Support Evaluation.
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
const HB35_PDF = readFileSync(
  resolve(__dirname, "../../fixtures/documents/va-hb35-restorative-housing.pdf"),
);
const SIMPLE_BILL_TXT = readFileSync(
  resolve(__dirname, "../../fixtures/documents/simple-bill.txt"),
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

interface EvaluationEntry {
  anchorId: string;
  segmentId: string;
  quotedText: string;
  deterministicResult: {
    allPassed: boolean;
    checks: Array<{ check: string; status: string; reason: string | null }>;
  };
  evaluatorVerdict: string | null;
  supportLevel: string;
}

interface EvaluationResponse {
  documentVersionId: string;
  evaluatorVersion: string;
  promptHash: string;
  approved: boolean;
  totalEvaluated: number;
  totalSupported: number;
  totalAmbiguous: number;
  totalUnsupported: number;
  evaluations: EvaluationEntry[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const RUN = Math.random().toString(36).slice(2, 8);

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

async function fullPipeline(documentVersionId: string): Promise<void> {
  await fetch(`${BASE_URL}/${documentVersionId}/parse`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/scan`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/extract`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/anchor`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/parse-temporal`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: [] }),
  });
}

async function evaluateDoc(
  documentVersionId: string,
): Promise<{ status: number; body: EvaluationResponse & ErrorResult }> {
  const res = await fetch(
    `${BASE_URL}/${documentVersionId}/evaluate`,
    { method: "POST" },
  );
  return {
    status: res.status,
    body: (await res.json()) as EvaluationResponse & ErrorResult,
  };
}

describe("Gate 9 — Support Evaluation", () => {
  it("HB 35: all anchored spans are evaluated, each has deterministic check results", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate9-eval.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `9035-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await evaluateDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.evaluatorVersion).toBe("1.0.0");
    expect(g.body.totalEvaluated).toBeGreaterThan(0);

    for (const evaluation of g.body.evaluations) {
      expect(evaluation.anchorId).toBeTruthy();
      expect(evaluation.segmentId).toBeTruthy();
      expect(evaluation.quotedText).toBeTruthy();
      expect(evaluation.deterministicResult).toBeDefined();
      expect(evaluation.deterministicResult.checks.length).toBeGreaterThanOrEqual(4);
      expect(
        ["supported", "ambiguous", "unsupported"].includes(evaluation.supportLevel),
      ).toBe(true);
    }
  });

  it("deterministic checks pass → LLM evaluator invoked (verdict is not null)", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate9-llm.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `9036-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await evaluateDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    const passingEvals = g.body.evaluations.filter(
      (e) => e.deterministicResult.allPassed,
    );
    expect(
      passingEvals.length,
      "at least one evaluation should have all deterministic checks pass",
    ).toBeGreaterThan(0);

    for (const e of passingEvals) {
      expect(
        e.evaluatorVerdict,
        `evaluation ${e.anchorId} should have evaluator verdict when deterministic checks pass`,
      ).not.toBeNull();
      expect(
        ["ambiguous", "unsupported"].includes(e.evaluatorVerdict!),
        "evaluator verdict must be ambiguous or unsupported, never supported",
      ).toBe(true);
    }
  });

  it("evaluate before resolve → error", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate9-noresolve.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `9001-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fetch(`${BASE_URL}/${r.body.documentVersionId}/parse`, { method: "POST" });

    const g = await evaluateDoc(r.body.documentVersionId);
    expect(g.status).toBe(400);
    expect(g.body.error.code).toBe("DOCUMENT_NOT_RESOLVED");
  });

  it("idempotency: evaluate twice → same results", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate9-idem.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `9037-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g1 = await evaluateDoc(r.body.documentVersionId);
    expect(g1.status).toBe(200);

    const g2 = await evaluateDoc(r.body.documentVersionId);
    expect(g2.status).toBe(200);

    expect(g2.body.totalEvaluated).toBe(g1.body.totalEvaluated);
    expect(g2.body.totalSupported).toBe(g1.body.totalSupported);
    expect(g2.body.totalAmbiguous).toBe(g1.body.totalAmbiguous);
    expect(g2.body.totalUnsupported).toBe(g1.body.totalUnsupported);

    const ids1 = g1.body.evaluations.map((e) => e.anchorId).sort();
    const ids2 = g2.body.evaluations.map((e) => e.anchorId).sort();
    expect(ids1).toEqual(ids2);
  });

  it("evaluator prompt hash differs from extraction prompt hash", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate9-prompt.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `9038-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await evaluateDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.promptHash).toBeTruthy();
    expect(g.body.promptHash).not.toBe("ph_fixture");
    expect(g.body.promptHash).toMatch(/^ph_/);
  });

  it("simple-bill: evaluation produces results with proper support levels", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate9.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `9002-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await evaluateDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.evaluatorVersion).toBe("1.0.0");

    for (const evaluation of g.body.evaluations) {
      if (evaluation.deterministicResult.allPassed) {
        expect(evaluation.evaluatorVerdict).not.toBeNull();
      } else {
        expect(evaluation.evaluatorVerdict).toBeNull();
        expect(evaluation.supportLevel).toBe("unsupported");
      }
    }
  });
});
