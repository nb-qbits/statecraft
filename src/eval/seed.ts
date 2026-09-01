import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GoldDocument, GoldObligation, PipelineFinding } from "./types.js";

const GOLD_DIR = join(import.meta.dirname, "../../fixtures/gold");

function baseUrl(): string {
  const port = process.env.PORT ?? "3000";
  const host = process.env.EVAL_HOST ?? "localhost";
  return `http://${host}:${port}`;
}

interface DocumentMeta {
  filename: string;
  jurisdiction: string;
  session: string;
  instrumentType: string;
  number: string;
  stage: string;
  chapter: string | null;
}

interface SeedConfig {
  document: DocumentMeta;
  documentVersionId?: string;
  expectNoFindings?: boolean;
}

async function uploadDocument(config: SeedConfig, pdfPath: string): Promise<string> {
  const url = `${baseUrl()}/api/v1/documents/upload`;
  const formData = new FormData();

  const bytes = readFileSync(pdfPath);
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), config.document.filename);
  formData.append(
    "legalIdentity",
    JSON.stringify({
      jurisdiction: config.document.jurisdiction,
      session: config.document.session,
      instrumentType: config.document.instrumentType,
      number: config.document.number,
      stage: config.document.stage,
      chapter: config.document.chapter,
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

async function analyzeDocument(dvId: string): Promise<void> {
  const url = `${baseUrl()}/api/v1/documents/${dvId}/analyze`;
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
        process.stdout.write(`    ${event.stage}: ${event.status}\n`);
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

  const result = (await resp.json()) as { findings: PipelineFinding[] };
  return result.findings;
}

function findingToGoldObligation(f: PipelineFinding, index: number, slug: string): GoldObligation {
  let expectedOutcome: "date" | "bounded" | "refuse";
  let expectedDate: string | null = null;
  let refusalReason: string | null = null;

  if (f.resolved && f.adjustedDate) {
    expectedOutcome = "date";
    expectedDate = f.adjustedDate;
  } else if (f.resolved && f.rrule && f.occurrences?.length > 0) {
    expectedOutcome = "date";
    expectedDate = f.occurrences[0]!.adjustedDate;
  } else if (f.bounded && f.upperBound) {
    expectedOutcome = "bounded";
    expectedDate = f.upperBound;
  } else {
    expectedOutcome = "refuse";
    refusalReason = f.unresolvedReason ?? f.refusalKind ?? f.grammarFailureReason ?? null;
  }

  return {
    id: `${slug}-${String(index + 1).padStart(2, "0")}`,
    actor: f.actor ?? null,
    duty: f.obligationTitle ?? "UNVERIFIED",
    citation: f.sectionCitation ?? "UNKNOWN",
    expected_outcome: expectedOutcome,
    expected_date: expectedDate,
    refusal_reason: refusalReason,
    notes: `UNVERIFIED — generated from pipeline output.`,
  };
}

function discoverSeedTargets(): Array<{ dir: string; config: SeedConfig; pdfPath: string }> {
  const entries = readdirSync(GOLD_DIR);
  const results: Array<{ dir: string; config: SeedConfig; pdfPath: string }> = [];

  for (const entry of entries) {
    const dirPath = join(GOLD_DIR, entry);
    if (!statSync(dirPath).isDirectory()) continue;

    const configPath = join(dirPath, "seed-config.json");
    const labelsPath = join(dirPath, "labels.json");

    if (!existsSync(configPath)) continue;

    if (existsSync(labelsPath)) {
      console.log(`SKIP: ${entry}/ already has labels.json`);
      continue;
    }

    const config = JSON.parse(readFileSync(configPath, "utf-8")) as SeedConfig;
    const pdfPath = join(dirPath, config.document.filename);
    if (!existsSync(pdfPath)) {
      console.warn(`SKIP: ${entry}/ PDF not found: ${config.document.filename}`);
      continue;
    }

    results.push({ dir: entry, config, pdfPath });
  }

  return results;
}

async function main(): Promise<void> {
  const modelProvider = process.env.MODEL_PROVIDER;
  if (!modelProvider || (modelProvider !== "anthropic" && modelProvider !== "openai")) {
    console.error("FATAL: MODEL_PROVIDER must be set to a real provider (anthropic or openai).");
    process.exit(1);
  }

  console.log("Gold-set seed script");
  console.log(`  Server: ${baseUrl()}`);
  console.log("");

  const targets = discoverSeedTargets();
  if (targets.length === 0) {
    console.log("No seed targets found. Place a seed-config.json in a fixtures/gold/<slug>/ directory.");
    process.exit(0);
  }

  console.log(`Found ${targets.length} document(s) to seed:\n`);

  for (const { dir, config, pdfPath } of targets) {
    console.log(`=== ${dir} ===`);

    if (config.expectNoFindings) {
      console.log("  Amendment-by-instruction — writing empty obligation list");
      const goldDoc: GoldDocument = {
        document: config.document,
        verified: false,
        expectNoFindings: true,
        obligations: [],
      };
      const labelsPath = join(GOLD_DIR, dir, "labels.json");
      writeFileSync(labelsPath, JSON.stringify(goldDoc, null, 2) + "\n", "utf-8");
      console.log(`  Wrote ${labelsPath}`);
      continue;
    }

    try {
      let dvId: string;
      if (config.documentVersionId) {
        dvId = config.documentVersionId;
        console.log(`  Using pre-uploaded documentVersionId: ${dvId}`);
      } else {
        console.log("  Uploading...");
        dvId = await uploadDocument(config, pdfPath);
        console.log(`  documentVersionId: ${dvId}`);
      }

      console.log("  Analyzing...");
      await analyzeDocument(dvId);

      console.log("  Fetching findings...");
      const findings = await fetchFindings(dvId);
      console.log(`  Found ${findings.length} findings`);

      const obligations = findings
        .filter(f => f.kind !== "effective_date")
        .map((f, i) => findingToGoldObligation(f, i, dir));

      const goldDoc: GoldDocument = {
        document: config.document,
        documentVersionId: dvId,
        verified: false,
        obligations,
      };

      const labelsPath = join(GOLD_DIR, dir, "labels.json");
      writeFileSync(labelsPath, JSON.stringify(goldDoc, null, 2) + "\n", "utf-8");
      console.log(`  Wrote ${labelsPath} with ${obligations.length} obligations`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`  Skipping ${dir}`);
    }

    console.log("");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
