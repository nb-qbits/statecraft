#!/usr/bin/env node
/**
 * Verification script: upload three Virginia bills, run full pipeline via
 * the /analyze SSE endpoint, then fetch and print findings.
 *
 * Usage: node scripts/verify-live-pipeline.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3000/api/v1";

const BILLS = [
  {
    label: "HB 434 — Electric Grid Utilization Metrics",
    file: resolve(__dirname, "../fixtures/documents/va-hb434-grid-metrics.txt"),
    identity: { jurisdiction: "Virginia", session: "2026", instrumentType: "HB", number: "HB434-live", stage: "enrolled", chapter: null },
  },
  {
    label: "SB 21 — Juvenile Justice Transfer Work Group",
    file: resolve(__dirname, "../fixtures/documents/va-sb21-juvenile-justice.txt"),
    identity: { jurisdiction: "Virginia", session: "2026", instrumentType: "SB", number: "SB21-live", stage: "enrolled", chapter: null },
  },
  {
    label: "HB 1456 — Government Efficiency",
    file: resolve(__dirname, "../fixtures/documents/va-hb1456-gov-efficiency.txt"),
    identity: { jurisdiction: "Virginia", session: "2026", instrumentType: "HB", number: "HB1456-live", stage: "enrolled", chapter: null },
  },
];

function buildMultipartBody(fileContent, filename, identity) {
  const boundary = "----VerifyBoundary" + Math.random().toString(36).slice(2, 14);
  const parts = [];

  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`);
  parts.push(fileContent);
  parts.push(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="legalIdentity"\r\n\r\n`);
  parts.push(JSON.stringify(identity));
  parts.push(`\r\n--${boundary}--\r\n`);

  return { body: parts.join(""), boundary };
}

async function upload(bill) {
  const content = readFileSync(bill.file, "utf-8");
  const filename = bill.file.split("/").pop();
  const { body, boundary } = buildMultipartBody(content, filename, bill.identity);

  const res = await fetch(`${BASE}/documents/upload`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed ${res.status}: ${text}`);
  }

  return await res.json();
}

async function analyze(dvId) {
  const res = await fetch(`${BASE}/documents/${dvId}/analyze`, { method: "POST" });
  const text = await res.text();
  const events = text.split("\n\n")
    .filter(b => b.startsWith("data: "))
    .map(b => JSON.parse(b.replace(/^data: /, "")));
  return events;
}

async function getFindings(dvId) {
  const res = await fetch(`${BASE}/documents/${dvId}/findings`);
  return await res.json();
}

async function main() {
  const results = [];

  for (const bill of BILLS) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`  ${bill.label}`);
    console.log(`${"=".repeat(70)}`);

    // Upload
    const uploadResult = await upload(bill);
    const dvId = uploadResult.documentVersionId;
    console.log(`  documentVersionId: ${dvId}`);

    // Analyze (SSE)
    console.log(`\n  --- SSE Events ---`);
    const events = await analyze(dvId);
    for (const e of events) {
      console.log(`  ${e.stage}: ${JSON.stringify(e.counts)}`);
    }

    // Findings
    const findings = await getFindings(dvId);
    console.log(`\n  --- Findings Summary ---`);
    console.log(`  Total findings:        ${findings.findings.length}`);
    console.log(`  Rejected spans:        ${findings.rejectedSpans.length}`);
    console.log(`  Coverage:              ${JSON.stringify(findings.coverage)}`);
    console.log(`  Lane summary:          ${JSON.stringify(findings.laneSummary)}`);

    if (findings.findings.length > 0) {
      console.log(`\n  --- Individual Findings ---`);
      for (const f of findings.findings) {
        console.log(`\n  [${f.kind}] "${f.quotedText}"`);
        console.log(`    provision:    ${f.provisionLabel} (${f.structuralPath})`);
        console.log(`    anchored:     ${f.anchored} (${f.anchorMethod})`);
        console.log(`    grammar:      parsed=${f.grammarParsed}${f.grammarFailureReason ? ` reason="${f.grammarFailureReason}"` : ""}`);
        console.log(`    resolved:     ${f.resolved}`);
        if (f.resolved) {
          console.log(`    statutory:    ${f.statutoryDate}`);
          console.log(`    adjusted:     ${f.adjustedDate}`);
          console.log(`    ruleIds:      ${JSON.stringify(f.ruleIds)}`);
          console.log(`    citations:    ${JSON.stringify(f.citations)}`);
        } else {
          console.log(`    unresolved:   ${f.unresolvedReason}`);
          console.log(`    missing:      ${JSON.stringify(f.missingInputs)}`);
        }
        console.log(`    lane:         ${f.lane}`);
        console.log(`    support:      ${f.supportLevel}`);
      }
    }

    if (findings.rejectedSpans.length > 0) {
      console.log(`\n  --- Rejected Spans ---`);
      for (const r of findings.rejectedSpans) {
        console.log(`  "${r.quotedText}" — ${r.reason}`);
      }
    }

    results.push({ bill: bill.label, findings });
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("  VERIFICATION SUMMARY");
  console.log(`${"=".repeat(70)}`);
  let totalFindings = 0;
  let totalRejected = 0;
  let totalResolved = 0;
  for (const r of results) {
    const resolved = r.findings.findings.filter(f => f.resolved).length;
    totalFindings += r.findings.findings.length;
    totalRejected += r.findings.rejectedSpans.length;
    totalResolved += resolved;
    console.log(`  ${r.bill}`);
    console.log(`    findings: ${r.findings.findings.length}, resolved: ${resolved}, rejected spans: ${r.findings.rejectedSpans.length}`);
  }
  console.log(`\n  TOTALS: ${totalFindings} findings, ${totalResolved} resolved, ${totalRejected} rejected spans`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
