/**
 * Gate U1 integration tests — Orchestration and findings read model.
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

const BASE_URL = "http://localhost:3000/api/v1";
const UPLOAD_URL = `${BASE_URL}/documents/upload`;

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

const RUN = Math.random().toString(36).slice(2, 8);

async function uploadDocument(): Promise<string> {
  const parts = [
    {
      name: "file",
      value: SIMPLE_BILL_TXT,
      filename: `simple-bill-u1-${RUN}.txt`,
      contentType: "text/plain",
    },
    {
      name: "legalIdentity",
      value: JSON.stringify({
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `U1-${RUN}`,
        stage: "introduced",
        chapter: null,
      }),
    },
  ];
  const { body, boundary } = buildMultipartBody(parts);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { documentVersionId: string };
  return json.documentVersionId;
}

function parseSSEEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => {
      const jsonStr = block.replace(/^data: /, "");
      return JSON.parse(jsonStr) as Record<string, unknown>;
    });
}

describe("Gate U1 — Orchestration and Findings", () => {
  it("analyze streams SSE stage events with real counts", async () => {
    const dvId = await uploadDocument();

    const res = await fetch(`${BASE_URL}/documents/${dvId}/analyze`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const text = await res.text();
    const events = parseSSEEvents(text);

    const stages = events.map((e) => e.stage);
    expect(stages).toContain("parsed");
    expect(stages).toContain("scanned");
    expect(stages).toContain("proposed");
    expect(stages).toContain("verified");
    expect(stages).toContain("parsedDates");
    expect(stages).toContain("resolved");
    expect(stages).toContain("routed");
    expect(stages).toContain("complete");

    const parsed = events.find((e) => e.stage === "parsed");
    expect((parsed!.counts as Record<string, number>).provisions).toBeGreaterThan(0);

    const verified = events.find((e) => e.stage === "verified");
    const counts = verified!.counts as Record<string, number>;
    expect(counts.anchoredToSource + counts.rejected).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.status).toBe("completed");
    }

    console.log("\n=== ANALYZE SSE OUTPUT ===");
    for (const event of events) {
      console.log(JSON.stringify(event));
    }
    console.log("=== END ANALYZE SSE OUTPUT ===\n");
  });

  it("re-running analyze returns cached results without re-executing", async () => {
    const dvId = await uploadDocument();

    // First run
    const res1 = await fetch(`${BASE_URL}/documents/${dvId}/analyze`, {
      method: "POST",
    });
    expect(res1.status).toBe(200);
    const text1 = await res1.text();
    const events1 = parseSSEEvents(text1);

    // Second run — should return cached
    const res2 = await fetch(`${BASE_URL}/documents/${dvId}/analyze`, {
      method: "POST",
    });
    expect(res2.status).toBe(200);
    const text2 = await res2.text();
    const events2 = parseSSEEvents(text2);

    expect(events2.map((e) => e.stage)).toEqual(events1.map((e) => e.stage));

    const parsed1 = events1.find((e) => e.stage === "parsed");
    const parsed2 = events2.find((e) => e.stage === "parsed");
    expect(parsed2!.counts).toEqual(parsed1!.counts);
  });

  it("analyze on nonexistent document returns 404", async () => {
    const res = await fetch(
      `${BASE_URL}/documents/00000000-0000-0000-0000-000000000000/analyze`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("findings returns complete payload with coverage and lane summary", async () => {
    const dvId = await uploadDocument();

    // Run analysis first
    const analyzeRes = await fetch(
      `${BASE_URL}/documents/${dvId}/analyze`,
      { method: "POST" },
    );
    expect(analyzeRes.status).toBe(200);
    await analyzeRes.text(); // consume stream

    // Fetch findings
    const res = await fetch(`${BASE_URL}/documents/${dvId}/findings`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      findings: Array<Record<string, unknown>>;
      coverage: Record<string, number>;
      laneSummary: Record<string, number>;
      rejectedSpans: Array<Record<string, unknown>>;
    };

    expect(json.findings).toBeDefined();
    expect(json.coverage).toBeDefined();
    expect(json.laneSummary).toBeDefined();
    expect(json.rejectedSpans).toBeDefined();

    expect(json.coverage.totalSegments).toBeGreaterThan(0);
    expect(
      json.coverage.withCandidates + json.coverage.screenedNoCandidate + json.coverage.needsSweep,
    ).toBe(json.coverage.totalSegments);

    expect(
      json.laneSummary.straight_through +
        json.laneSummary.quick_confirmation +
        json.laneSummary.exception_review +
        json.laneSummary.blocked,
    ).toBe(json.findings.length);

    for (const finding of json.findings) {
      expect(finding.anchorId).toBeDefined();
      expect(finding.segmentId).toBeDefined();
      expect(finding.provisionLabel).toBeDefined();
      expect(typeof finding.provisionLabel).toBe("string");
      expect(finding.provisionLabel).not.toBe("");
      expect(finding.quotedText).toBeDefined();
      expect(finding.kind).toBeDefined();
      expect(finding.lane).toBeDefined();
      expect(finding.laneReasons).toBeDefined();
      expect(finding.anchored).toBe(true);
      expect(finding.supportLevel).toBeDefined();

      if (finding.resolved) {
        expect(finding.statutoryDate).not.toBeNull();
        expect(finding.ruleIds).toBeDefined();
        expect(finding.citations).toBeDefined();
      }
    }

    console.log("\n=== FINDINGS OUTPUT ===");
    console.log(JSON.stringify(json, null, 2));
    console.log("=== END FINDINGS OUTPUT ===\n");
  });

  it("provisionLabel renders human-readably", async () => {
    const dvId = await uploadDocument();

    const analyzeRes = await fetch(
      `${BASE_URL}/documents/${dvId}/analyze`,
      { method: "POST" },
    );
    await analyzeRes.text();

    const res = await fetch(`${BASE_URL}/documents/${dvId}/findings`);
    const json = (await res.json()) as {
      findings: Array<{ provisionLabel: string; structuralPath: string }>;
    };

    for (const finding of json.findings) {
      expect(finding.provisionLabel).not.toContain("/body/");
      expect(finding.provisionLabel).not.toMatch(/^\//);
      expect(finding.provisionLabel.length).toBeGreaterThan(0);
    }
  });

  it("findings on nonexistent document returns 404", async () => {
    const res = await fetch(
      `${BASE_URL}/documents/00000000-0000-0000-0000-000000000000/findings`,
    );
    expect(res.status).toBe(404);
  });
});
