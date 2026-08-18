import { createHash } from "node:crypto";
import { SCANNER_VERSION } from "../scanning/scanner.js";
import { EXTRACTOR_VERSION } from "../extraction/service.js";
import { ANCHORER_VERSION } from "../anchoring/service.js";
import { GRAMMAR_VERSION } from "../grammar/service.js";
import { RESOLVER_VERSION } from "../resolver/service.js";
import { EVALUATOR_VERSION } from "../evaluation/types.js";
import { ROUTER_VERSION } from "../routing/types.js";
import { REVIEW_VERSION } from "../review/types.js";

export interface StageVersions {
  parser?: string | undefined;
  scanner: string;
  extractor: string;
  anchorer: string;
  grammar: string;
  resolver: string;
  evaluator: string;
  router: string;
  review: string;
}

export function currentStageVersions(
  runtime?: { parserVersion?: string },
): StageVersions {
  return {
    parser: runtime?.parserVersion,
    scanner: SCANNER_VERSION,
    extractor: EXTRACTOR_VERSION,
    anchorer: ANCHORER_VERSION,
    grammar: GRAMMAR_VERSION,
    resolver: RESOLVER_VERSION,
    evaluator: EVALUATOR_VERSION,
    router: ROUTER_VERSION,
    review: REVIEW_VERSION,
  };
}

export function computeConfigHash(versions?: StageVersions): string {
  const v = versions ?? currentStageVersions();
  const ordered = [
    v.parser ?? "", v.scanner, v.extractor, v.anchorer, v.grammar,
    v.resolver, v.evaluator, v.router, v.review,
  ];
  return createHash("sha256").update(ordered.join(":")).digest("hex");
}

export function stageVersionsToRecord(versions: StageVersions): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(versions)) {
    if (val !== undefined) result[key] = val;
  }
  return result;
}

export function staleStages(
  stored: StageVersions,
  current: StageVersions,
): string[] {
  const stale: string[] = [];
  for (const key of Object.keys(current) as (keyof StageVersions)[]) {
    if (stored[key] !== current[key]) {
      stale.push(key);
    }
  }
  return stale;
}
