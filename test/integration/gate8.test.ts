/**
 * Gate 8 integration tests — Resolver.
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

interface ResolutionResultEntry {
  anchorId: string;
  segmentId: string;
  text: string;
  expression: { kind: string; [key: string]: unknown };
  result: {
    resolved: boolean;
    statutoryDate?: string;
    adjustedDate?: string;
    ruleIds?: string[];
    citations?: string[];
    packVersion?: string;
    warnings?: string[];
    inputs?: Array<{
      name: string;
      value: string;
      source: string;
      authority: string;
      citation: string;
    }>;
    reason?: string;
    missingInputs?: string[];
  };
}

interface ResolutionResponse {
  documentVersionId: string;
  resolverVersion: string;
  totalExpressions: number;
  totalResolved: number;
  totalUnresolved: number;
  results: ResolutionResultEntry[];
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

async function fullPipeline(
  documentVersionId: string,
): Promise<void> {
  await fetch(`${BASE_URL}/${documentVersionId}/parse`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/scan`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/extract`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/anchor`, { method: "POST" });
  await fetch(`${BASE_URL}/${documentVersionId}/parse-temporal`, { method: "POST" });
}

async function resolveDoc(
  documentVersionId: string,
  inputs?: Array<{
    name: string;
    value: string;
    source: string;
    authority: string;
    citation: string;
  }>,
): Promise<{ status: number; body: ResolutionResponse & ErrorResult }> {
  const res = await fetch(
    `${BASE_URL}/${documentVersionId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: inputs ?? [] }),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as ResolutionResponse & ErrorResult,
  };
}

describe("Gate 8 — Resolver", () => {
  it("HB 35 without trigger dates: all relative durations resolve to UNRESOLVED with missingInputs named", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-no-trigger.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8035-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await resolveDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.resolverVersion).toBe("1.0.0");
    expect(g.body.totalExpressions).toBeGreaterThan(0);

    for (const result of g.body.results) {
      if (result.expression.kind === "relative_duration") {
        expect(
          result.result.resolved,
          `"${result.text}" should be unresolved without trigger date`,
        ).toBe(false);
        expect(result.result.missingInputs).toContain("triggerDate");
        expect(result.result.reason).toBeTruthy();
      }

      if (result.expression.kind === "recurrence") {
        expect(result.result.resolved).toBe(false);
        expect(result.result.missingInputs).toContain("periodStart");
        expect(result.result.missingInputs).toContain("periodEnd");
      }
    }
  });

  it("every resolution carries citations or is explicitly unresolved — never a bare date", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-inv6.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8036-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await resolveDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    for (const result of g.body.results) {
      if (result.result.resolved) {
        expect(
          result.result.citations!.length,
          `resolved "${result.text}" must carry citations`,
        ).toBeGreaterThan(0);
        expect(result.result.ruleIds!.length).toBeGreaterThan(0);
        expect(result.result.packVersion).toBeTruthy();
        expect(result.result.statutoryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.result.adjustedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.result.inputs!.length).toBeGreaterThan(0);
      } else {
        expect(result.result.reason).toBeTruthy();
        expect(result.result.missingInputs).toBeDefined();
      }
    }
  });

  it("worked example: supplying a trigger date produces a real resolved date with § 1-210 rule IDs", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-trigger.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8037-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const triggerInput = {
      name: "triggerDate",
      value: "2026-03-15",
      source: "manual_input",
      authority: "analyst",
      citation: "assumed trigger date for testing",
    };

    const g = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g.status).toBe(200);

    const resolvedDurations = g.body.results.filter(
      (r) => r.expression.kind === "relative_duration" && r.result.resolved,
    );

    expect(
      resolvedDurations.length,
      "at least one relative_duration should resolve with a trigger date",
    ).toBeGreaterThan(0);

    for (const rd of resolvedDurations) {
      expect(rd.result.statutoryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rd.result.adjustedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rd.result.ruleIds!.length).toBeGreaterThan(0);
      expect(rd.result.citations!.length).toBeGreaterThan(0);

      const hasVa1210Rule = rd.result.ruleIds!.some((id) =>
        id.startsWith("va-1-210"),
      );
      expect(
        hasVa1210Rule,
        `resolved "${rd.text}" must carry § 1-210 rule ID`,
      ).toBe(true);

      expect(rd.result.packVersion).toBe("us-va/v1");
      expect(rd.result.inputs!.length).toBeGreaterThan(0);
      const triggerInResult = rd.result.inputs!.find(
        (i) => i.name === "triggerDate",
      );
      expect(triggerInResult).toBeDefined();
      expect(triggerInResult!.value).toBe("2026-03-15");
      expect(triggerInResult!.source).toBe("manual_input");
    }
  });

  it("reproducibility: recomputing from stored inputs produces the same output", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-repro.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8038-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const triggerInput = {
      name: "triggerDate",
      value: "2026-06-01",
      source: "manual_input",
      authority: "analyst",
      citation: "reproducibility test trigger",
    };

    const g1 = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g1.status).toBe(200);

    const g2 = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g2.status).toBe(200);

    expect(g2.body.totalExpressions).toBe(g1.body.totalExpressions);
    expect(g2.body.totalResolved).toBe(g1.body.totalResolved);
    expect(g2.body.totalUnresolved).toBe(g1.body.totalUnresolved);

    for (const r1 of g1.body.results) {
      const r2 = g2.body.results.find((r) => r.anchorId === r1.anchorId);
      expect(r2, `result for ${r1.anchorId} should exist in second run`).toBeDefined();
      expect(r2!.result.resolved).toBe(r1.result.resolved);
      if (r1.result.resolved && r2!.result.resolved) {
        expect(r2!.result.statutoryDate).toBe(r1.result.statutoryDate);
        expect(r2!.result.adjustedDate).toBe(r1.result.adjustedDate);
        expect(r2!.result.ruleIds).toEqual(r1.result.ruleIds);
        expect(r2!.result.citations).toEqual(r1.result.citations);
      }
    }
  });

  it("simple-bill: fixed_date 'July 1, 2025' resolves with adjustment rules", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate8.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `8001-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await resolveDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    const fixedDate = g.body.results.find(
      (r) => r.expression.kind === "fixed_date" && r.text === "July 1, 2025",
    );

    if (fixedDate) {
      expect(fixedDate.result.resolved).toBe(true);
      if (fixedDate.result.resolved) {
        expect(fixedDate.result.statutoryDate).toBe("2025-07-01");
        expect(fixedDate.result.adjustedDate).toBe("2025-07-01");
        expect(fixedDate.result.ruleIds!.length).toBeGreaterThan(0);
        expect(fixedDate.result.ruleIds).toContain("verbatim-date");
        expect(fixedDate.result.citations!.length).toBeGreaterThan(0);
        expect(fixedDate.result.packVersion).toBe("us-va/v1");
        expect(fixedDate.result.inputs!.length).toBeGreaterThan(0);
        expect(fixedDate.result.inputs![0]!.name).toBe("specifiedDate");
        expect(fixedDate.result.inputs![0]!.value).toBe("2025-07-01");
        expect(fixedDate.result.inputs![0]!.source).toBe("anchored_span");
      }
    }
  });

  it("resolve before grammar → error", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-nogrammar.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `8002-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fetch(`${BASE_URL}/${r.body.documentVersionId}/parse`, {
      method: "POST",
    });

    const g = await resolveDoc(r.body.documentVersionId);
    expect(g.status).toBe(400);
    expect(g.body.error.code).toBe("DOCUMENT_NOT_PARSED_GRAMMAR");
  });

  it("idempotency: resolve twice → same results", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-idem.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8039-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g1 = await resolveDoc(r.body.documentVersionId);
    expect(g1.status).toBe(200);

    const g2 = await resolveDoc(r.body.documentVersionId);
    expect(g2.status).toBe(200);

    expect(g2.body.totalExpressions).toBe(g1.body.totalExpressions);
    expect(g2.body.totalResolved).toBe(g1.body.totalResolved);
    const ids1 = g1.body.results.map((r) => r.anchorId).sort();
    const ids2 = g2.body.results.map((r) => r.anchorId).sort();
    expect(ids1).toEqual(ids2);
  });

  it("hour-scale durations remain unresolved even with a trigger date", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate8-hours.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `8040-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const triggerInput = {
      name: "triggerDate",
      value: "2026-03-15",
      source: "manual_input",
      authority: "analyst",
      citation: "hour-scale test trigger",
    };

    const g = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g.status).toBe(200);

    const hourDurations = g.body.results.filter(
      (r) =>
        r.expression.kind === "relative_duration" &&
        (r.expression as { unit: string }).unit === "hours",
    );

    for (const hd of hourDurations) {
      expect(
        hd.result.resolved,
        `hour-scale "${hd.text}" must remain unresolved`,
      ).toBe(false);
      expect(hd.result.reason).toContain("hour");
    }
  });
});
