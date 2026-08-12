/**
 * Gate 10 integration tests — Lane Router and Coverage Accounting.
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

interface LaneReason {
  rule: string;
  detail: string;
}

interface LaneAssignmentResponse {
  anchorId: string;
  segmentId: string;
  lane: string;
  reasons: LaneReason[];
}

interface LaneSummary {
  straight_through: number;
  quick_confirmation: number;
  exception_review: number;
  blocked: number;
}

interface CoverageResponse {
  label: string;
  note: string;
  totalSegments: number;
  withCandidates: number;
  screenedNoCandidate: number;
  needsSweep: number;
}

interface RoutingResponse {
  documentVersionId: string;
  routerVersion: string;
  totalAssignments: number;
  laneSummary: LaneSummary;
  processingCoverage: CoverageResponse;
  assignments: LaneAssignmentResponse[];
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
  await fetch(`${BASE_URL}/${documentVersionId}/evaluate`, { method: "POST" });
}

async function routeDoc(
  documentVersionId: string,
): Promise<{ status: number; body: RoutingResponse & ErrorResult }> {
  const res = await fetch(
    `${BASE_URL}/${documentVersionId}/route`,
    { method: "POST" },
  );
  return {
    status: res.status,
    body: (await res.json()) as RoutingResponse & ErrorResult,
  };
}

describe("Gate 10 — Lane Router and Coverage Accounting", () => {
  it("HB 35: lane assignment is deterministic — same input yields same lane across runs", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate10-det.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `10035-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g1 = await routeDoc(r.body.documentVersionId);
    expect(g1.status).toBe(200);

    const g2 = await routeDoc(r.body.documentVersionId);
    expect(g2.status).toBe(200);

    expect(g1.body.totalAssignments).toBe(g2.body.totalAssignments);
    expect(g1.body.laneSummary).toEqual(g2.body.laneSummary);

    const lanes1 = g1.body.assignments.map((a) => `${a.anchorId}:${a.lane}`).sort();
    const lanes2 = g2.body.assignments.map((a) => `${a.anchorId}:${a.lane}`).sort();
    expect(lanes1).toEqual(lanes2);
  });

  it("HB 35: reasons are stored and inspectable for every assignment", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate10-reasons.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `10036-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await routeDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.totalAssignments).toBeGreaterThan(0);

    for (const assignment of g.body.assignments) {
      expect(assignment.reasons.length).toBeGreaterThan(0);
      for (const reason of assignment.reasons) {
        expect(reason.rule).toBeTruthy();
        expect(reason.detail).toBeTruthy();
      }
    }
  });

  it("HB 35 (introduced): never routes to straight_through — INV-8", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate10-inv8.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `10037-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await routeDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    expect(g.body.laneSummary.straight_through).toBe(0);
    for (const assignment of g.body.assignments) {
      expect(assignment.lane).not.toBe("straight_through");
    }
  });

  it("coverage counts reconcile: every segment in exactly one state, totals sum", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate10-cov.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `10038-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await routeDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);

    const cov = g.body.processingCoverage;
    expect(cov.totalSegments).toBeGreaterThan(0);
    expect(
      cov.withCandidates + cov.screenedNoCandidate + cov.needsSweep,
    ).toBe(cov.totalSegments);

    expect(cov.label).toBe("processing_coverage");
    expect(cov.note).toContain("not measured recall");
  });

  it("route before evaluate → error", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate10-noeval.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `10001-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fetch(`${BASE_URL}/${r.body.documentVersionId}/parse`, { method: "POST" });

    const g = await routeDoc(r.body.documentVersionId);
    expect(g.status).toBe(400);
    expect(g.body.error.code).toBe("DOCUMENT_NOT_EVALUATED");
  });

  it("simple-bill: lane assignment works end-to-end", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate10.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `10002-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const g = await routeDoc(r.body.documentVersionId);
    expect(g.status).toBe(200);
    expect(g.body.routerVersion).toBe("1.0.0");

    const summaryTotal =
      g.body.laneSummary.straight_through +
      g.body.laneSummary.quick_confirmation +
      g.body.laneSummary.exception_review +
      g.body.laneSummary.blocked;
    expect(summaryTotal).toBe(g.body.totalAssignments);

    // simple-bill is "introduced" — no straight_through
    expect(g.body.laneSummary.straight_through).toBe(0);
  });

  it("getAssignmentsByLane returns same set as JSONB unpack for the same document", async () => {
    const r = await uploadDoc({
      content: HB35_PDF,
      filename: "va-hb35-gate10-consistency.pdf",
      contentType: "application/pdf",
      legalIdentity: {
        jurisdiction: "Virginia",
        session: "2026",
        instrumentType: "HB",
        number: `10040-${RUN}`,
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    await fullPipeline(r.body.documentVersionId);

    const routeResult = await routeDoc(r.body.documentVersionId);
    expect(routeResult.status).toBe(200);

    const jsonbAssignments = routeResult.body.assignments;
    expect(jsonbAssignments.length).toBeGreaterThan(0);

    // Collect all unique lanes from the JSONB response
    const lanesInJsonb = [...new Set(jsonbAssignments.map((a) => a.lane))];

    // For each lane, fetch via the normalised GET endpoint scoped to this document
    const normalisedAssignments: LaneAssignmentResponse[] = [];
    for (const lane of lanesInJsonb) {
      const laneRes = await fetch(
        `http://localhost:3000/api/v1/assignments/lane/${lane}?limit=200&documentVersionId=${r.body.documentVersionId}`,
      );
      expect(laneRes.status).toBe(200);
      const laneBody = (await laneRes.json()) as {
        lane: string;
        count: number;
        assignments: LaneAssignmentResponse[];
      };
      normalisedAssignments.push(...laneBody.assignments);
    }

    // Sort both sets by anchorId for stable comparison
    const sortByAnchor = (a: LaneAssignmentResponse, b: LaneAssignmentResponse) =>
      a.anchorId.localeCompare(b.anchorId);

    const sortedJsonb = [...jsonbAssignments].sort(sortByAnchor);
    const sortedNormalised = [...normalisedAssignments].sort(sortByAnchor);

    expect(sortedNormalised.length).toBe(sortedJsonb.length);

    for (let i = 0; i < sortedJsonb.length; i++) {
      expect(sortedNormalised[i]!.anchorId).toBe(sortedJsonb[i]!.anchorId);
      expect(sortedNormalised[i]!.segmentId).toBe(sortedJsonb[i]!.segmentId);
      expect(sortedNormalised[i]!.lane).toBe(sortedJsonb[i]!.lane);
      expect(sortedNormalised[i]!.reasons).toEqual(sortedJsonb[i]!.reasons);
    }
  });
});
