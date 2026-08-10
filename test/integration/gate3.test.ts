/**
 * Gate 3 integration tests — Deterministic Candidate Scan.
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
const SIMPLE_BILL_TXT = readFileSync(resolve(__dirname, "../../fixtures/documents/simple-bill.txt"), "utf-8");
const ADVERSARIAL_TXT = readFileSync(resolve(__dirname, "../../fixtures/documents/adversarial-text.txt"), "utf-8");
const HB346_TXT = readFileSync(resolve(__dirname, "../../fixtures/documents/hb346-extracted.txt"), "utf-8");
const HR3481_TXT = readFileSync(resolve(__dirname, "../../fixtures/documents/hr3481-extracted.txt"), "utf-8");

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
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), boundary };
}

interface Candidate {
  candidateId: string;
  kind: string;
  ruleId: string;
  matchedText: string;
  matchStart: number;
  matchEnd: number;
  suppressed: boolean;
}

interface SegmentResult {
  segmentId: string;
  coverageState: string;
  candidates: Candidate[];
}

interface ScanResult {
  documentVersionId: string;
  scannerVersion: string;
  segmentCount: number;
  totalCandidates: number;
  totalSuppressed: number;
  segments: SegmentResult[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const LEGAL_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2025",
  instrumentType: "HB",
  number: "9001",
  stage: "introduced",
  chapter: null,
};

async function uploadDoc(opts: {
  content: string | Buffer;
  filename: string;
  contentType: string;
  legalIdentity: Record<string, unknown>;
}): Promise<{ status: number; body: { documentVersionId: string } & ErrorResult }> {
  const parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }> = [
    { name: "file", value: opts.content, filename: opts.filename, contentType: opts.contentType },
    { name: "legalIdentity", value: JSON.stringify(opts.legalIdentity) },
  ];
  const { body, boundary } = buildMultipartBody(parts);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return { status: res.status, body: (await res.json()) as { documentVersionId: string } & ErrorResult };
}

async function parseDoc(documentVersionId: string): Promise<{ status: number; body: { segmentCount: number; segments: Array<{ segmentId: string }> } & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/parse`, { method: "POST" });
  return { status: res.status, body: (await res.json()) as { segmentCount: number; segments: Array<{ segmentId: string }> } & ErrorResult };
}

async function scanDoc(documentVersionId: string): Promise<{ status: number; body: ScanResult & ErrorResult }> {
  const res = await fetch(`${BASE_URL}/${documentVersionId}/scan`, { method: "POST" });
  return { status: res.status, body: (await res.json()) as ScanResult & ErrorResult };
}

describe("Gate 3 — Deterministic Candidate Scan", () => {
  it("simple-bill.txt: finds dates, durations, modals, citations, temporal connectors", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9001" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const allCandidates = s.body.segments.flatMap(seg => seg.candidates);
    const nonSuppressed = allCandidates.filter(c => !c.suppressed);
    const kinds = new Set(nonSuppressed.map(c => c.kind));

    expect(kinds.has("date")).toBe(true);
    expect(kinds.has("duration")).toBe(true);
    expect(kinds.has("modal_verb")).toBe(true);
    expect(kinds.has("citation")).toBe(true);
    expect(kinds.has("temporal_connector")).toBe(true);

    const dateTexts = nonSuppressed.filter(c => c.kind === "date").map(c => c.matchedText);
    expect(dateTexts.some(t => t.includes("July 1, 2025"))).toBe(true);

    const durationTexts = nonSuppressed.filter(c => c.kind === "duration").map(c => c.matchedText);
    expect(durationTexts.some(t => t.includes("within 30 days"))).toBe(true);

    const citationTexts = nonSuppressed.filter(c => c.kind === "citation").map(c => c.matchedText);
    expect(citationTexts.some(t => t.includes("§ 2.2-4002"))).toBe(true);

    for (const seg of s.body.segments) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }
  });

  it("adversarial-text.txt: history lines suppressed, § 1-210 is citation not date", async () => {
    const r = await uploadDoc({
      content: ADVERSARIAL_TXT,
      filename: "adversarial.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9002" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const allCandidates = s.body.segments.flatMap(seg => seg.candidates);

    const historySegment = s.body.segments.find(seg =>
      seg.candidates.length === 0 &&
      seg.coverageState === "screened_no_candidate"
    );
    expect(historySegment).toBeDefined();

    const dateTexts = allCandidates.filter(c => c.kind === "date").map(c => c.matchedText);
    expect(dateTexts.every(t => !t.includes("1997") && !t.includes("1-210"))).toBe(true);

    const citations = allCandidates.filter(c => c.kind === "citation" && !c.suppressed);
    expect(citations.some(c => c.matchedText.includes("§ 1-210"))).toBe(true);

    for (const seg of s.body.segments) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }
  });

  it("HB 346 text: finds dates, modals, citations, enactment clause (FOIA exclusions bill, no durations)", async () => {
    const r = await uploadDoc({
      content: HB346_TXT,
      filename: "hb346.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9003" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const allCandidates = s.body.segments.flatMap(seg => seg.candidates);
    const nonSuppressed = allCandidates.filter(c => !c.suppressed);

    const dateTexts = nonSuppressed.filter(c => c.kind === "date").map(c => c.matchedText);
    expect(dateTexts.some(t => t.includes("January 14, 2026"))).toBe(true);
    expect(dateTexts.some(t => t.includes("January 12, 2026"))).toBe(true);

    const modals = nonSuppressed.filter(c => c.kind === "modal_verb");
    expect(modals.length).toBeGreaterThan(0);

    const citations = nonSuppressed.filter(c => c.kind === "citation");
    expect(citations.length).toBeGreaterThan(0);

    const enactments = nonSuppressed.filter(c => c.kind === "enactment_clause");
    expect(enactments.length).toBeGreaterThan(0);

    expect(s.body.segmentCount).toBeGreaterThan(10);

    for (const seg of s.body.segments) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }
  });

  it("HR 3481 federal: finds explicit dates, amendment instructions, enactment clause", async () => {
    const r = await uploadDoc({
      content: HR3481_TXT,
      filename: "hr3481.txt",
      contentType: "text/plain",
      legalIdentity: {
        jurisdiction: "us-federal",
        session: "119",
        instrumentType: "HR",
        number: "3481",
        stage: "introduced",
        chapter: null,
      },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    const allCandidates = s.body.segments.flatMap(seg => seg.candidates);
    const nonSuppressed = allCandidates.filter(c => !c.suppressed);

    const dateTexts = nonSuppressed.filter(c => c.kind === "date").map(c => c.matchedText);
    expect(dateTexts.some(t => t.includes("November 30, 2031"))).toBe(true);
    expect(dateTexts.some(t => t.includes("January 31, 2033"))).toBe(true);

    const enactments = nonSuppressed.filter(c => c.kind === "enactment_clause");
    expect(enactments.length).toBeGreaterThan(0);
    expect(enactments.some(c =>
      c.matchedText.toLowerCase().includes("senate and house") ||
      c.matchedText.toLowerCase().includes("striking") ||
      c.matchedText.toLowerCase().includes("inserting")
    )).toBe(true);

    for (const seg of s.body.segments) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }
  });

  it("idempotency: scan twice → same candidate IDs", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-idem.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9005" },
    });
    expect(r.status).toBe(201);

    await parseDoc(r.body.documentVersionId);

    const s1 = await scanDoc(r.body.documentVersionId);
    expect(s1.status).toBe(200);

    const s2 = await scanDoc(r.body.documentVersionId);
    expect(s2.status).toBe(200);

    expect(s2.body.totalCandidates).toBe(s1.body.totalCandidates);

    const ids1 = s1.body.segments.flatMap(seg => seg.candidates.map(c => c.candidateId)).sort();
    const ids2 = s2.body.segments.flatMap(seg => seg.candidates.map(c => c.candidateId)).sort();
    expect(ids1).toEqual(ids2);
  });

  it("scan before parse → error", async () => {
    const r = await uploadDoc({
      content: "Unparsed content for scan test.",
      filename: "unparsed.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9006" },
    });
    expect(r.status).toBe(201);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(400);
    expect(s.body.error.code).toBe("DOCUMENT_NOT_PARSED");
  });

  it("INV-7 exhaustiveness: parse segment count == scan segment count, all have coverage state", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill-inv7.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "9007" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const s = await scanDoc(r.body.documentVersionId);
    expect(s.status).toBe(200);

    expect(s.body.segmentCount).toBe(p.body.segmentCount);

    for (const seg of s.body.segments) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }

    const segWithCandidatesFound = s.body.segments.filter(seg => seg.coverageState === "candidates_found");
    const segWithScreened = s.body.segments.filter(seg => seg.coverageState === "screened_no_candidate");
    expect(segWithCandidatesFound.length + segWithScreened.length).toBe(s.body.segmentCount);
  });
});
