import { describe, it, expect, vi } from "vitest";
import type {
  DocumentVersionId,
  DocumentId,
  ContentHash,
  SegmentId,
  AnchorId,
  EvaluatorVerdict,
  PromptHash,
} from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment } from "../parsing/types.js";
import type { ProposalAnchorResult } from "../anchoring/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { SupportEvaluator, EvaluatorOutput } from "./evaluator.js";
import { createEvaluationService } from "./service.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;
const segId = "seg_test001" as SegmentId;
const ancId = "anc_test001" as AnchorId;

function makeVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    documentVersionId: dvId,
    documentId: docId,
    contentHash: hash,
    mimeType: "text/plain",
    byteSize: 100,
    legalIdentity: {
      jurisdiction: "us-va",
      session: "2025",
      instrumentType: "HB",
      number: "1234",
      stage: "introduced",
      chapter: null,
    },
    legislativeStatus: "unknown",
    statusProvenance: "default_unknown",
    parseStatus: "parsed",
    scanStatus: "scanned",
    scannerVersion: "1.0.0",
    extractionStatus: "extracted",
    extractorVersion: "1.0.0",
    anchoringStatus: "anchored",
    anchorerVersion: "1.0.0",
    grammarStatus: "parsed_grammar",
    grammarVersion: "1.0.0",
    resolutionStatus: "resolved_resolver",
    resolverVersion: "1.0.0",
    evaluationStatus: "unevaluated",
    evaluatorVersion: null,
    routingStatus: "unrouted",
    routerVersion: null,
    authoritativeSource: null,
    asOfDate: null,
    retrievedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSegment(): SourceSegment {
  return {
    segmentId: segId,
    documentVersionId: dvId,
    structuralPath: "/body/p[0]",
    ordinal: 0,
    rawText: "within 30 days after the effective date of this act",
    normalizedText: "within 30 days after the effective date of this act",
    contentHash: "hash" as ContentHash,
    offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    parserAdapter: "plain-text",
    parserVersion: "1.3.0",
    fidelity: "none",
  };
}

function makeAnchorResult(
  overrides: Partial<ProposalAnchorResult> = {},
): ProposalAnchorResult {
  return {
    anchorId: ancId,
    segmentId: segId,
    quotedText: "within 30 days",
    kind: "duration",
    result: {
      anchored: true,
      normalizedStart: 0,
      normalizedEnd: 14,
      originalStart: 0,
      originalEnd: 14,
      method: "exact",
    },
    actor: null,
    actorQuotedText: null,
    actorAnchored: null,
    dependsOnQuotedText: null,
    dependsOnDescription: null,
    dependsOnAnchored: null,
    ...overrides,
  };
}

function makeGrammarResult(): SpanParseResult {
  return {
    anchorId: ancId,
    segmentId: segId,
    text: "within 30 days",
    result: {
      parsed: true,
      expression: {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: "calendar",
        preposition: "within",
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
    },
  };
}

function makeResolution(): AnchoredResolution {
  return {
    anchorId: ancId,
    segmentId: segId,
    text: "within 30 days",
    expression: {
      kind: "relative_duration",
      quantity: 30,
      unit: "days",
      dayKind: "calendar",
      preposition: "within",
      referenceEvent: null,
      referenceEventText: null,
      boundKind: "within",
    },
    result: {
      resolved: false,
      reason: "triggerDate is required",
      missingInputs: ["triggerDate"],
      warnings: [],
      inputs: [],
    },
  };
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => createMockLogger(),
  } as unknown as Logger;
}

const PH = "ph_eval_test" as PromptHash;

function createMockEvaluator(verdict: EvaluatorVerdict = "ambiguous"): SupportEvaluator & { evaluate: ReturnType<typeof vi.fn> } {
  const evaluateFn = vi.fn(async (): Promise<EvaluatorOutput> => ({
    verdict,
    reasoning: "fixture reasoning",
    promptHash: PH,
  }));
  return {
    promptHash: PH,
    evaluate: evaluateFn,
  };
}

function createMockRepos() {
  const ingestionRepository: IngestionRepository = {
    findOrCreateDocument: vi.fn(),
    findVersionByHash: vi.fn(),
    insertVersion: vi.fn(),
    getVersion: vi.fn(async () => makeVersion()),
    listVersions: vi.fn(),
    getDocument: vi.fn(),
    updateJurisdiction: vi.fn(),
  };

  const parsingRepository: ParsingRepository = {
    insertSegments: vi.fn(),
    getSegmentsByVersion: vi.fn(async () => [makeSegment()]),
    deleteSegmentsByVersion: vi.fn(),
    updateParseStatus: vi.fn(),
  } as unknown as ParsingRepository;

  const anchoringRepository: AnchoringRepository = {
    insertResults: vi.fn(),
    getResultsByVersion: vi.fn(async () => [makeAnchorResult()]),
    deleteResultsByVersion: vi.fn(),
    updateAnchoringStatus: vi.fn(),
  };

  const grammarRepository: GrammarRepository = {
    insertResults: vi.fn(),
    getResultsByVersion: vi.fn(async () => [makeGrammarResult()]),
    deleteResultsByVersion: vi.fn(),
    updateGrammarStatus: vi.fn(),
  };

  const resolverRepository: ResolverRepository = {
    insertResults: vi.fn(),
    getResultsByVersion: vi.fn(async () => [makeResolution()]),
    deleteResultsByVersion: vi.fn(),
    updateResolutionStatus: vi.fn(),
  };

  const evaluationRepository: EvaluationRepository = {
    insertResults: vi.fn(),
    getResultsByVersion: vi.fn(),
    deleteResultsByVersion: vi.fn(),
    updateEvaluationStatus: vi.fn(),
  };

  return {
    ingestionRepository,
    parsingRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
  };
}

describe("Evaluation Service", () => {
  it("evaluates anchored spans and invokes LLM when deterministic checks pass", async () => {
    const repos = createMockRepos();
    const evaluator = createMockEvaluator("ambiguous");
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);
    expect(result.totalEvaluated).toBe(1);
    expect(result.evaluations[0]!.supportLevel).toBe("ambiguous");
    expect(result.evaluations[0]!.evaluatorVerdict).toBe("ambiguous");
    expect(result.evaluations[0]!.deterministicResult.allPassed).toBe(true);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
  });

  it("fabricated quote: deterministic check fails, LLM NOT called", async () => {
    const repos = createMockRepos();
    (repos.anchoringRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnchorResult({
        result: { anchored: false, reason: "fuzzy_ceiling_exceeded" },
      }),
    ]);
    const evaluator = createMockEvaluator();
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);
    expect(result.totalEvaluated).toBe(0);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("cross-document evidence: segment missing, deterministic fails, LLM NOT called", async () => {
    const repos = createMockRepos();
    (repos.parsingRepository.getSegmentsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const evaluator = createMockEvaluator();
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);
    expect(result.totalEvaluated).toBe(1);
    expect(result.evaluations[0]!.supportLevel).toBe("unsupported");
    expect(result.evaluations[0]!.deterministicResult.allPassed).toBe(false);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("unsupported material field blocks approval", async () => {
    const repos = createMockRepos();
    const evaluator = createMockEvaluator("unsupported");
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);
    expect(result.approved).toBe(false);
    expect(result.totalUnsupported).toBeGreaterThan(0);
  });

  it("ambiguous blocks approval — only supported passes", async () => {
    const repos = createMockRepos();
    const evaluator = createMockEvaluator("ambiguous");
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);
    expect(result.evaluations[0]!.supportLevel).toBe("ambiguous");
    expect(result.approved).toBe(false);
  });

  it("throws when document not found", async () => {
    const repos = createMockRepos();
    (repos.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const evaluator = createMockEvaluator();
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    await expect(service.evaluateDocument(dvId)).rejects.toThrow(
      "not found",
    );
  });

  it("throws when document not resolved", async () => {
    const repos = createMockRepos();
    (repos.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ resolutionStatus: "unresolved_resolver" }),
    );
    const evaluator = createMockEvaluator();
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    await expect(service.evaluateDocument(dvId)).rejects.toThrow(
      "has not been resolved yet",
    );
  });

  it("re-evaluates: deletes previous results before re-evaluating", async () => {
    const repos = createMockRepos();
    (repos.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ evaluationStatus: "evaluated" }),
    );
    const evaluator = createMockEvaluator("ambiguous");
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    await service.evaluateDocument(dvId);
    expect(repos.evaluationRepository.deleteResultsByVersion).toHaveBeenCalledWith(dvId);
  });

  it("persists results and updates evaluation status", async () => {
    const repos = createMockRepos();
    const evaluator = createMockEvaluator("ambiguous");
    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    await service.evaluateDocument(dvId);
    expect(repos.evaluationRepository.insertResults).toHaveBeenCalled();
    expect(repos.evaluationRepository.updateEvaluationStatus).toHaveBeenCalledWith(
      dvId,
      "evaluated",
      "1.0.0",
    );
  });

  it("supportLevel 'supported' is only reachable via passing deterministic checks", async () => {
    const repos = createMockRepos();
    const ancId2 = "anc_test002" as AnchorId;

    (repos.anchoringRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnchorResult(),
      makeAnchorResult({
        anchorId: ancId2,
        result: { anchored: true, normalizedStart: 0, normalizedEnd: 14, originalStart: 0, originalEnd: 14, method: "exact" },
      }),
    ]);

    (repos.parsingRepository.getSegmentsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSegment(),
    ]);

    (repos.grammarRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeGrammarResult(),
    ]);

    const evaluateFn = vi.fn(async (): Promise<EvaluatorOutput> => ({
      verdict: "ambiguous" as EvaluatorVerdict,
      reasoning: "test",
      promptHash: PH,
    }));
    const evaluator: SupportEvaluator & { evaluate: ReturnType<typeof vi.fn> } = {
      promptHash: PH,
      evaluate: evaluateFn,
    };

    const service = createEvaluationService({
      ...repos,
      evaluator,
      logger: createMockLogger(),
    });

    const result = await service.evaluateDocument(dvId);

    for (const evaluation of result.evaluations) {
      if (evaluation.supportLevel === "supported") {
        expect(
          evaluation.deterministicResult.allPassed,
          `"supported" must only appear when all deterministic checks pass (anchor ${evaluation.anchorId})`,
        ).toBe(true);
      }
    }

    const failedDeterministic = result.evaluations.filter(
      (e) => !e.deterministicResult.allPassed,
    );
    for (const e of failedDeterministic) {
      expect(e.supportLevel).not.toBe("supported");
    }
  });
});
