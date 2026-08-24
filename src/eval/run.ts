import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildDocumentReport } from "./compare.js";
import { formatReport } from "./report.js";
import type {
  GoldDocument,
  PipelineFinding,
  AggregateReport,
  DocumentReport,
} from "./types.js";

const GOLD_DIR = join(import.meta.dirname, "../../fixtures/gold");
const EVAL_OUT_DIR = join(import.meta.dirname, "../../docs/eval");

function baseUrl(): string {
  const port = process.env.PORT ?? "3000";
  const host = process.env.EVAL_HOST ?? "localhost";
  return `http://${host}:${port}`;
}

async function uploadDocument(
  doc: GoldDocument,
  pdfPath: string,
): Promise<string> {
  const url = `${baseUrl()}/api/v1/documents/upload`;
  const formData = new FormData();

  const bytes = readFileSync(pdfPath);
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), doc.document.filename);
  formData.append(
    "legalIdentity",
    JSON.stringify({
      jurisdiction: doc.document.jurisdiction,
      session: doc.document.session,
      instrumentType: doc.document.instrumentType,
      number: doc.document.number,
      stage: doc.document.stage,
      chapter: doc.document.chapter,
    }),
  );

  const resp = await fetch(url, { method: "POST", body: formData });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Upload failed (${resp.status}): ${body}`);
  }
  const result = (await resp.json()) as { documentVersionId: string };
  return result.documentVersionId;
}

async function analyzeDocument(dvId: string, forceReparse: boolean): Promise<void> {
  const qs = forceReparse ? "?forceReparse=true" : "";
  const url = `${baseUrl()}/api/v1/documents/${dvId}/analyze${qs}`;
  const resp = await fetch(url, { method: "POST" });
  if (!resp.ok && resp.status !== 200) {
    const body = await resp.text();
    throw new Error(`Analyze failed (${resp.status}): ${body}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body for SSE stream");

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (line.startsWith("data: ")) {
        const event = JSON.parse(line.slice(6)) as { stage: string; status: string; error?: string };
        process.stdout.write(`  ${event.stage}: ${event.status}\n`);
        if (event.status === "failed") {
          throw new Error(`Pipeline stage "${event.stage}" failed: ${event.error ?? "unknown"}`);
        }
      }
    }
  }
}

async function fetchFindings(dvId: string): Promise<PipelineFinding[]> {
  const url = `${baseUrl()}/api/v1/documents/${dvId}/findings`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Findings fetch failed (${resp.status}): ${body}`);
  }

  const result = (await resp.json()) as {
    findings: PipelineFinding[];
    engineVersions: { current: Record<string, string> };
  };
  return result.findings;
}

async function fetchEngineVersions(dvId: string): Promise<Record<string, string>> {
  const url = `${baseUrl()}/api/v1/documents/${dvId}/findings`;
  const resp = await fetch(url);
  if (!resp.ok) return {};
  const result = (await resp.json()) as {
    engineVersions: { current: Record<string, string> };
  };
  return result.engineVersions.current;
}

function discoverGoldDocuments(): Array<{ dir: string; doc: GoldDocument; pdfPath: string }> {
  const entries = readdirSync(GOLD_DIR);
  const results: Array<{ dir: string; doc: GoldDocument; pdfPath: string }> = [];

  for (const entry of entries) {
    const dirPath = join(GOLD_DIR, entry);
    if (!statSync(dirPath).isDirectory()) continue;

    const labelsPath = join(dirPath, "labels.json");
    if (!existsSync(labelsPath)) {
      console.warn(`SKIP: ${entry}/ has no labels.json`);
      continue;
    }

    const doc = JSON.parse(readFileSync(labelsPath, "utf-8")) as GoldDocument;
    const pdfPath = join(dirPath, doc.document.filename);
    if (!existsSync(pdfPath)) {
      console.warn(`SKIP: ${entry}/ PDF not found: ${doc.document.filename}`);
      continue;
    }

    results.push({ dir: entry, doc, pdfPath });
  }

  return results;
}

async function main(): Promise<void> {
  const modelProvider = process.env.MODEL_PROVIDER;
  if (!modelProvider || (modelProvider !== "anthropic" && modelProvider !== "openai")) {
    console.error("FATAL: MODEL_PROVIDER must be set to a real provider (anthropic or openai).");
    console.error("       This eval harness must run against the live pipeline, not the fixture gateway.");
    process.exit(1);
  }

  const modelId = process.env.MODEL_ID ?? null;
  const forceReparse = process.argv.includes("--force-reparse");

  console.log("Gold-set evaluation harness");
  console.log(`  MODEL_PROVIDER: ${modelProvider}`);
  console.log(`  MODEL_ID: ${modelId ?? "default"}`);
  console.log(`  Server: ${baseUrl()}`);
  console.log(`  Force reparse: ${forceReparse}`);
  console.log("");

  const goldDocs = discoverGoldDocuments();
  if (goldDocs.length === 0) {
    console.error("No gold documents found in fixtures/gold/");
    process.exit(1);
  }
  console.log(`Found ${goldDocs.length} gold document(s):\n`);

  const documentReports: DocumentReport[] = [];
  let engineVersions: Record<string, string> = {};

  for (const { dir, doc, pdfPath } of goldDocs) {
    console.log(`=== ${dir} (${doc.document.filename}) ===`);
    console.log(`  Verified: ${doc.verified}`);
    console.log(`  Obligations: ${doc.obligations.length}`);

    try {
      let dvId: string;
      if (doc.documentVersionId) {
        dvId = doc.documentVersionId;
        console.log(`  Using pre-analyzed documentVersionId: ${dvId}`);
      } else {
        console.log("  Uploading...");
        dvId = await uploadDocument(doc, pdfPath);
        console.log(`  documentVersionId: ${dvId}`);

        console.log(`  Analyzing${forceReparse ? " (force reparse)" : ""}...`);
        await analyzeDocument(dvId, forceReparse);
      }

      console.log("  Fetching findings...");
      const findings = await fetchFindings(dvId);
      console.log(`  Found ${findings.length} findings`);

      if (Object.keys(engineVersions).length === 0) {
        engineVersions = await fetchEngineVersions(dvId);
      }

      const report = buildDocumentReport(dir, doc.verified, doc.obligations, findings);
      documentReports.push(report);

      console.log(`  Recall: ${(report.recall * 100).toFixed(1)}%`);
      console.log(`  Wrong answers: ${report.wrongAnswers.length}`);
      console.log(`  Parse errors: ${report.parseErrors.length}`);
      console.log(`  Refused but shouldn't have: ${report.refusedButShouldntHave.length}`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      documentReports.push({
        documentName: dir,
        verified: doc.verified,
        labelled: doc.obligations.length,
        found: 0,
        matched: 0,
        recall: 0,
        actorAccuracy: 0,
        citationAccuracy: 0,
        dateAccuracy: 0,
        completeRecords: 0,
        wrongAnswers: [],
        refusedButShouldntHave: [],
        parseErrors: [],
        unmatchedGold: [],
        unmatchedFindings: [],
        pairs: [],
      });
    }

    console.log("");
  }

  const totalLabelled = documentReports.reduce((s, d) => s + d.labelled, 0);
  const totalFound = documentReports.reduce((s, d) => s + d.found, 0);
  const totalMatched = documentReports.reduce((s, d) => s + d.matched, 0);

  const allMatchedPairs = documentReports.flatMap(d =>
    d.pairs.filter(p => p.verdict !== "unmatched_gold" && p.verdict !== "unmatched_finding"),
  );

  const totalActorCorrect = allMatchedPairs.filter(p => p.actorCorrect).length;

  const totalCitationCorrect = allMatchedPairs.filter(p => p.citationCorrect).length;

  const totalDateAssessable = allMatchedPairs.filter(p => p.dateCorrect !== null);
  const totalDateCorrect = totalDateAssessable.filter(p => p.dateCorrect === true).length;

  const totalComplete = allMatchedPairs.filter(p =>
    p.actorCorrect && p.citationCorrect && p.dateCorrect === true,
  ).length;

  const totalWrong = documentReports.reduce((s, d) => s + d.wrongAnswers.length, 0);
  const totalRefusedButShouldntHave = documentReports.reduce(
    (s, d) => s + d.refusedButShouldntHave.length, 0,
  );
  const totalParseErrors = documentReports.reduce(
    (s, d) => s + d.parseErrors.length, 0,
  );

  const graded = documentReports.every(d => d.verified);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const aggregate: AggregateReport = {
    timestamp: now.toISOString(),
    engineVersions,
    modelId,
    graded,
    documents: documentReports,
    aggregate: {
      totalLabelled,
      totalFound,
      totalMatched,
      recall: totalLabelled > 0 ? totalMatched / totalLabelled : 0,
      actorAccuracy: allMatchedPairs.length > 0 ? totalActorCorrect / allMatchedPairs.length : 0,
      citationAccuracy: allMatchedPairs.length > 0 ? totalCitationCorrect / allMatchedPairs.length : 0,
      dateAccuracy: totalDateAssessable.length > 0 ? totalDateCorrect / totalDateAssessable.length : 0,
      completeRecords: allMatchedPairs.length > 0 ? totalComplete / allMatchedPairs.length : 0,
      wrongAnswerCount: totalWrong,
      refusedButShouldntHaveCount: totalRefusedButShouldntHave,
      parseErrorCount: totalParseErrors,
    },
  };

  const markdownReport = formatReport(aggregate);
  const mdPath = join(EVAL_OUT_DIR, `eval-${dateStr}.md`);
  const jsonPath = join(EVAL_OUT_DIR, `eval-${dateStr}.json`);

  writeFileSync(mdPath, markdownReport, "utf-8");
  writeFileSync(jsonPath, JSON.stringify(aggregate, null, 2), "utf-8");

  console.log("=== AGGREGATE ===");
  console.log(`  Graded: ${graded ? "yes" : "NO — unverified labels present"}`);
  console.log(`  Recall: ${(aggregate.aggregate.recall * 100).toFixed(1)}%${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Actor accuracy: ${(aggregate.aggregate.actorAccuracy * 100).toFixed(1)}%${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Citation accuracy: ${(aggregate.aggregate.citationAccuracy * 100).toFixed(1)}%${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Date accuracy: ${(aggregate.aggregate.dateAccuracy * 100).toFixed(1)}%${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Complete records: ${(aggregate.aggregate.completeRecords * 100).toFixed(1)}%${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Wrong answers: ${aggregate.aggregate.wrongAnswerCount}${graded ? "" : " (UNGRADED)"}`);
  console.log(`  Parse errors: ${aggregate.aggregate.parseErrorCount}`);
  console.log(`  Refused but shouldn't have: ${aggregate.aggregate.refusedButShouldntHaveCount}${graded ? "" : " (UNGRADED)"}`);
  console.log("");
  console.log(`Report written to:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${jsonPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
