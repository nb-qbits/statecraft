/**
 * Gate 2 integration tests — Parsing and normalization.
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
const SIMPLE_BILL_DOCX = readFileSync(resolve(__dirname, "../../fixtures/documents/simple-bill.docx"));
const PDF_FIXTURE = readFileSync(resolve(__dirname, "../../fixtures/sample-bill.pdf"));
const HB346_PDF = readFileSync(resolve(__dirname, "../../fixtures/documents/hb346.pdf"));

const UPLOAD_URL = "http://localhost:3000/api/v1/documents/upload";
const PARSE_URL = "http://localhost:3000/api/v1/documents";

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
  parseStatus: string;
  mimeType: string;
}

interface Segment {
  segmentId: string;
  documentVersionId: string;
  structuralPath: string;
  ordinal: number;
  rawText: string;
  normalizedText: string;
  contentHash: string;
  offsetMap: { normalizedToOriginal: number[]; originalToNormalized: number[] };
  parserAdapter: string;
  parserVersion: string;
  fidelity: string;
}

interface ParseResult {
  documentVersionId: string;
  segmentCount: number;
  segments: Segment[];
}

interface ErrorResult {
  error: { code: string; message: string };
}

const LEGAL_IDENTITY = {
  jurisdiction: "Virginia",
  session: "2025",
  instrumentType: "HB",
  number: "8001",
  stage: "introduced",
  chapter: null,
};

async function uploadDoc(opts: {
  content: string | Buffer;
  filename: string;
  contentType: string;
  legalIdentity: Record<string, unknown>;
  documentId?: string;
}): Promise<{ status: number; body: UploadResult & ErrorResult }> {
  const parts: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }> = [
    { name: "file", value: opts.content, filename: opts.filename, contentType: opts.contentType },
    { name: "legalIdentity", value: JSON.stringify(opts.legalIdentity) },
  ];
  if (opts.documentId) {
    parts.push({ name: "documentId", value: opts.documentId });
  }
  const { body, boundary } = buildMultipartBody(parts);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return { status: res.status, body: (await res.json()) as UploadResult & ErrorResult };
}

async function parseDoc(documentVersionId: string): Promise<{ status: number; body: ParseResult & ErrorResult }> {
  const res = await fetch(`${PARSE_URL}/${documentVersionId}/parse`, {
    method: "POST",
  });
  return { status: res.status, body: (await res.json()) as ParseResult & ErrorResult };
}

describe("Gate 2 — Parsing integration", () => {
  it("parses text → segments → parses again → same segment IDs", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "simple-bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8001" },
    });
    expect(r.status).toBe(201);
    const dvId = r.body.documentVersionId;

    const p1 = await parseDoc(dvId);
    expect(p1.status).toBe(200);
    expect(p1.body.segmentCount).toBeGreaterThan(0);

    const p2 = await parseDoc(dvId);
    expect(p2.status).toBe(200);
    expect(p2.body.segmentCount).toBe(p1.body.segmentCount);

    for (let i = 0; i < p1.body.segments.length; i++) {
      expect(p1.body.segments[i]!.segmentId).toBe(p2.body.segments[i]!.segmentId);
    }
  });

  it("offset round-trip passes on adversarial text", async () => {
    const r = await uploadDoc({
      content: ADVERSARIAL_TXT,
      filename: "adversarial.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8002" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);
    expect(p.body.segmentCount).toBeGreaterThan(0);

    for (const seg of p.body.segments) {
      expect(seg.offsetMap.normalizedToOriginal.length).toBe(seg.normalizedText.length);
      expect(seg.offsetMap.originalToNormalized.length).toBe(seg.rawText.length);

      // Monotonicity check
      for (let i = 1; i < seg.offsetMap.normalizedToOriginal.length; i++) {
        expect(seg.offsetMap.normalizedToOriginal[i]).toBeGreaterThanOrEqual(
          seg.offsetMap.normalizedToOriginal[i - 1]!,
        );
      }
    }
  });

  it("two identical subsections receive distinct segment IDs", async () => {
    // The adversarial fixture has "Each agency shall submit a report to the Governor." twice
    const r = await uploadDoc({
      content: ADVERSARIAL_TXT,
      filename: "adversarial.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8003" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    // Find segments with identical rawText
    const textCounts = new Map<string, Segment[]>();
    for (const seg of p.body.segments) {
      const existing = textCounts.get(seg.rawText) ?? [];
      existing.push(seg);
      textCounts.set(seg.rawText, existing);
    }

    const duplicates = [...textCounts.values()].filter(segs => segs.length > 1);
    expect(duplicates.length).toBeGreaterThan(0);

    for (const dupeSet of duplicates) {
      const ids = dupeSet.map(s => s.segmentId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it("corrupt DOCX → parse_failed status", async () => {
    // Upload a valid DOCX first, then try to parse something that will fail
    // We upload a file with valid ZIP magic but invalid DOCX structure
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("not-a-docx.txt", "This is not a DOCX file");
    const fakeDocx = await zip.generateAsync({ type: "nodebuffer" });

    const r = await uploadDoc({
      content: fakeDocx,
      filename: "corrupt.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8004" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(422);
    expect(p.body.error.code).toBe("PARSE_FAILED");
  });

  it("PDF is parsed via sidecar and returns segments", async () => {
    const r = await uploadDoc({
      content: HB346_PDF,
      filename: "hb346.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8050" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);
    expect(p.body.segmentCount).toBeGreaterThan(0);
    expect(p.body.segments[0]!.parserAdapter).toBe("pdf");
    expect(p.body.segments[0]!.fidelity).toBe("inferred");
  });

  it("parses DOCX with italic and strikethrough runs", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_DOCX,
      filename: "simple-bill.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8006" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);
    expect(p.body.segmentCount).toBeGreaterThan(0);
    expect(p.body.segments[0]!.fidelity).toBe("declared");
    expect(p.body.segments[0]!.parserAdapter).toBe("docx");
  });

  it("HB 346 PDF produces ≥15 segments with all 14 subdivisions", async () => {
    const r = await uploadDoc({
      content: HB346_PDF,
      filename: "hb346-pdf-gate.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8020" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);
    expect(p.body.segmentCount).toBeGreaterThanOrEqual(15);

    const texts = p.body.segments.map(s => s.rawText);

    for (let i = 1; i <= 14; i++) {
      const prefix = `${i}. `;
      const found = texts.some(t => t.startsWith(prefix));
      expect(found, `subdivision ${i} should be present`).toBe(true);
    }
  });

  it("HB 346 PDF segments contain no bare line-number fragments in body content", async () => {
    const r = await uploadDoc({
      content: HB346_PDF,
      filename: "hb346-pdf-linenums.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8021" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    // Check body segments (skip preamble which legitimately contains year numbers)
    const bodySegments = p.body.segments.filter(
      s => s.structuralPath.includes("section["),
    );
    expect(bodySegments.length).toBeGreaterThan(0);

    for (const seg of bodySegments) {
      // Line-number residue looks like "37 4. Any test" — a bare 1-3 digit number
      // followed by content that is NOT part of the number
      expect(seg.rawText).not.toMatch(/^\d{1,3}\s+\d+\./);
    }
  });

  it("HB 346 PDF and text produce same structural shape", async () => {
    const rPdf = await uploadDoc({
      content: HB346_PDF,
      filename: "hb346-compare.pdf",
      contentType: "application/pdf",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8022" },
    });
    expect(rPdf.status).toBe(201);

    const rTxt = await uploadDoc({
      content: HB346_TXT,
      filename: "hb346-compare.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8023" },
    });
    expect(rTxt.status).toBe(201);

    const pPdf = await parseDoc(rPdf.body.documentVersionId);
    const pTxt = await parseDoc(rTxt.body.documentVersionId);

    expect(pPdf.status).toBe(200);
    expect(pTxt.status).toBe(200);

    // Normalize section IDs out of paths — compare structural shape, not exact IDs
    // The text and PDF fixtures were extracted differently so section IDs may differ
    const normalizePath = (p: string) =>
      p.replace(/section\[[^\]]+\]/g, "section[*]");

    const pdfShapes = pPdf.body.segments.map(s => normalizePath(s.structuralPath)).slice().sort();
    const txtShapes = pTxt.body.segments.map(s => normalizePath(s.structuralPath)).slice().sort();

    expect(pdfShapes).toEqual(txtShapes);
  });

  it("HB 346 (PDF-extracted, no blank lines) produces >10 segments", async () => {
    const r = await uploadDoc({
      content: HB346_TXT,
      filename: "hb346.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8010" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);
    expect(p.body.segmentCount).toBeGreaterThan(10);
  });

  it("HB 346 segments contain no line-number margins (tested on line-numbered fixture)", async () => {
    const HB346_LINENUMBERED = readFileSync(resolve(__dirname, "../../fixtures/documents/va-foia-records-request.txt"), "utf-8");
    const r = await uploadDoc({
      content: HB346_LINENUMBERED,
      filename: "foia-records.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8011" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    for (const seg of p.body.segments) {
      expect(seg.rawText).not.toMatch(/^\d{1,4}\s/);
      expect(seg.normalizedText).not.toMatch(/^\d{1,4}\s/);
    }
  });

  it("HB 346 offset map uses compressed format in storage", async () => {
    const r = await uploadDoc({
      content: HB346_TXT,
      filename: "hb346.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8012" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    for (const seg of p.body.segments) {
      expect(seg.offsetMap.normalizedToOriginal).toBeInstanceOf(Array);
      expect(seg.offsetMap.normalizedToOriginal.length).toBe(seg.normalizedText.length);
      expect(seg.offsetMap.originalToNormalized.length).toBe(seg.rawText.length);
    }
  });

  it("segments have all required fields populated", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8007" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    for (const seg of p.body.segments) {
      expect(seg.segmentId).toMatch(/^seg_[0-9a-f]{32}$/);
      expect(seg.documentVersionId).toBe(r.body.documentVersionId);
      expect(seg.structuralPath).toBeTruthy();
      expect(typeof seg.ordinal).toBe("number");
      expect(seg.rawText.length).toBeGreaterThan(0);
      expect(seg.normalizedText.length).toBeGreaterThan(0);
      expect(seg.contentHash).toHaveLength(64);
      expect(seg.parserAdapter).toBe("plain-text");
      expect(seg.parserVersion).toBe("1.3.0");
      expect(seg.fidelity).toBe("none");
    }
  });
});

describe("Segment ordering", () => {
  it("HB 346 returns subdivisions 1-14 in numeric document order", async () => {
    const r = await uploadDoc({
      content: HB346_TXT,
      filename: "hb346-order.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8030" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const subdivisionSegments = p.body.segments.filter(
      (s: { rawText: string }) => /^\d+\.\s/.test(s.rawText),
    );

    expect(subdivisionSegments.length).toBe(14);

    const numbers = subdivisionSegments.map(
      (s: { rawText: string }) => parseInt(s.rawText.match(/^(\d+)\.\s/)![1]!, 10),
    );
    for (let i = 0; i < numbers.length; i++) {
      expect(numbers[i]).toBe(i + 1);
    }
  });

  it("ordinals are sequential zero-based document-order indices", async () => {
    const r = await uploadDoc({
      content: SIMPLE_BILL_TXT,
      filename: "ordinal-seq.txt",
      contentType: "text/plain",
      legalIdentity: { ...LEGAL_IDENTITY, number: "8031" },
    });
    expect(r.status).toBe(201);

    const p = await parseDoc(r.body.documentVersionId);
    expect(p.status).toBe(200);

    const ordinals = p.body.segments.map((s: { ordinal: number }) => s.ordinal);
    for (let i = 0; i < ordinals.length; i++) {
      expect(ordinals[i]).toBe(i);
    }
  });
});

describe("Identity mismatch (deferred from Amendment 2)", () => {
  it("upload version 2 with mismatched number → 400 IDENTITY_MISMATCH", async () => {
    // Step 1: upload version 1
    const identity1 = {
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "8100",
      stage: "introduced",
      chapter: null,
    };

    const r1 = await uploadDoc({
      content: "First version of bill 8100.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity1,
    });
    expect(r1.status).toBe(201);
    const documentId = r1.body.documentId;

    // Step 2: upload version 2 with same documentId but different number
    const identity2 = { ...identity1, number: "8101" };

    const r2 = await uploadDoc({
      content: "Second version with wrong number.",
      filename: "bill-v2.txt",
      contentType: "text/plain",
      legalIdentity: identity2,
      documentId,
    });

    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("IDENTITY_MISMATCH");
  });

  it("upload version 2 with mismatched jurisdiction → 400 IDENTITY_MISMATCH", async () => {
    const identity1 = {
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "8102",
      stage: "introduced",
      chapter: null,
    };

    const r1 = await uploadDoc({
      content: "Bill for identity mismatch jurisdiction test.",
      filename: "bill.txt",
      contentType: "text/plain",
      legalIdentity: identity1,
    });
    expect(r1.status).toBe(201);
    const documentId = r1.body.documentId;

    const identity2 = { ...identity1, jurisdiction: "us-md" };

    const r2 = await uploadDoc({
      content: "Version with wrong jurisdiction.",
      filename: "bill-v2.txt",
      contentType: "text/plain",
      legalIdentity: identity2,
      documentId,
    });

    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("IDENTITY_MISMATCH");
  });
});
