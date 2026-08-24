import type { AggregateReport, DocumentReport, MatchedPair } from "./types.js";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function metric(value: number, graded: boolean): string {
  return graded ? pct(value) : `~~${pct(value)}~~ UNGRADED`;
}

function metricInt(value: number, graded: boolean): string {
  return graded ? String(value) : `~~${value}~~ UNGRADED`;
}

function fieldMark(correct: boolean | null): string {
  if (correct === null) return "—";
  return correct ? "✓" : "✗";
}

function formatPair(p: MatchedPair): string {
  const lines: string[] = [];
  lines.push(`  [${p.goldId}] ${p.verdict}  actor:${fieldMark(p.actorCorrect)} citation:${fieldMark(p.citationCorrect)} date:${fieldMark(p.dateCorrect)}`);
  lines.push(`    gold: actor="${p.goldActor}" citation="${p.goldCitation}" outcome=${p.goldOutcome} date=${p.goldDate ?? "n/a"}`);
  lines.push(`    found: actor="${p.foundActor ?? "?"}" citation="${p.foundCitation ?? "?"}" outcome=${p.foundOutcome ?? "?"} date=${p.foundDate ?? "n/a"}`);
  if (p.refusalReason) {
    lines.push(`    refusal: ${p.refusalReason}`);
  }
  lines.push(`    detail: ${p.detail}`);
  return lines.join("\n");
}

function formatDocumentReport(doc: DocumentReport): string {
  const g = doc.verified;
  const lines: string[] = [];
  lines.push(`## ${doc.documentName}${doc.verified ? "" : " (UNGRADED — labels not verified)"}`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Obligations labelled | ${doc.labelled} |`);
  lines.push(`| Obligations found by pipeline | ${doc.found} |`);
  lines.push(`| Matched | ${doc.matched} |`);
  lines.push(`| Recall | ${metric(doc.recall, g)} |`);
  lines.push(`| Actor accuracy (of matched) | ${metric(doc.actorAccuracy, g)} |`);
  lines.push(`| Citation accuracy (of matched) | ${metric(doc.citationAccuracy, g)} |`);
  lines.push(`| Date accuracy (of date/bounded) | ${metric(doc.dateAccuracy, g)} |`);
  lines.push(`| Complete records (actor+date) | ${metric(doc.completeRecords, g)} |`);
  lines.push(`| Wrong answers | ${metricInt(doc.wrongAnswers.length, g)} |`);
  lines.push(`| Refused but shouldn't have | ${metricInt(doc.refusedButShouldntHave.length, g)} |`);
  lines.push(`| **Parse errors** | **${doc.parseErrors.length}** |`);
  lines.push("");

  if (doc.parseErrors.length > 0) {
    lines.push("### PARSE ERRORS (system failures, not refusals)");
    lines.push("");
    for (const p of doc.parseErrors) {
      lines.push(formatPair(p));
      lines.push("");
    }
  }

  if (doc.refusedButShouldntHave.length > 0) {
    lines.push("### REFUSED-BUT-SHOULDN'T-HAVE");
    lines.push("");
    for (const p of doc.refusedButShouldntHave) {
      lines.push(formatPair(p));
      lines.push("");
    }
  }

  if (doc.wrongAnswers.length > 0) {
    lines.push("### WRONG ANSWERS");
    lines.push("");
    for (const p of doc.wrongAnswers) {
      lines.push(formatPair(p));
      lines.push("");
    }
  }

  if (doc.unmatchedGold.length > 0) {
    lines.push("### UNMATCHED GOLD (missed obligations)");
    lines.push("");
    for (const p of doc.unmatchedGold) {
      lines.push(formatPair(p));
      lines.push("");
    }
  }

  if (doc.unmatchedFindings.length > 0) {
    lines.push(`### UNMATCHED FINDINGS (${doc.unmatchedFindings.length} pipeline findings with no gold label)`);
    lines.push("");
    for (const id of doc.unmatchedFindings) {
      lines.push(`  - ${id}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatReport(report: AggregateReport): string {
  const g = report.graded;
  const lines: string[] = [];
  lines.push("# Gold-Set Evaluation Report");
  lines.push("");
  if (!g) {
    lines.push("> **ALL METRICS ARE UNGRADED.** One or more label files have `\"verified\": false`.");
    lines.push("> These labels were generated from pipeline output — the system is grading its own homework.");
    lines.push("> Numbers below are structurally valid but carry no evaluative weight until labels are hand-verified.");
    lines.push("");
  }
  lines.push(`**Date**: ${report.timestamp}`);
  lines.push(`**Model**: ${report.modelId ?? "unknown"}`);
  lines.push(`**Graded**: ${g ? "yes" : "NO — unverified labels present"}`);
  lines.push("");
  lines.push("### Engine Versions");
  lines.push("");
  for (const [k, v] of Object.entries(report.engineVersions)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`# Aggregate${g ? "" : " (UNGRADED)"}`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total labelled | ${report.aggregate.totalLabelled} |`);
  lines.push(`| Total found | ${report.aggregate.totalFound} |`);
  lines.push(`| Total matched | ${report.aggregate.totalMatched} |`);
  lines.push(`| Recall | ${metric(report.aggregate.recall, g)} |`);
  lines.push(`| Actor accuracy | ${metric(report.aggregate.actorAccuracy, g)} |`);
  lines.push(`| Citation accuracy | ${metric(report.aggregate.citationAccuracy, g)} |`);
  lines.push(`| Date accuracy | ${metric(report.aggregate.dateAccuracy, g)} |`);
  lines.push(`| Complete records | ${metric(report.aggregate.completeRecords, g)} |`);
  lines.push(`| Wrong answers | ${metricInt(report.aggregate.wrongAnswerCount, g)} |`);
  lines.push(`| Refused but shouldn't have | ${metricInt(report.aggregate.refusedButShouldntHaveCount, g)} |`);
  lines.push(`| **Parse errors** | **${report.aggregate.parseErrorCount}** |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const doc of report.documents) {
    lines.push(formatDocumentReport(doc));
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
