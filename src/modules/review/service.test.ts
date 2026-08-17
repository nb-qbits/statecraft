import { describe, it, expect, vi } from "vitest";
import type {
  DocumentVersionId,
  DocumentId,
  ContentHash,
  AnchorId,
  SegmentId,
  SupportLevel,
  EvaluatorVerdict,
  ProposalId,
  AnalysisId,
  ReviewEventId,
  RegisterRecordId,
  RecordVersionId,
  ProjectId,
  Lane,
} from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { ReviewRepository, ProposalInsert } from "../../platform/db/review-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { RoutingRepository } from "../../platform/db/routing-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type {
  Analysis,
  ReviewProposal,
  ReviewEvent,
  ReviewAction,
  ReviewDiff,
  RegisterRecord,
  DateProvenance,
} from "./types.js";
import type { PipelineServices } from "./service.js";
import { createReviewService } from "./service.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;

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
      number: "35",
      stage: "introduced",
      chapter: null,
    },
    legislativeStatus: "introduced",
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
    evaluationStatus: "evaluated",
    evaluatorVersion: "1.0.0",
    routingStatus: "routed",
    routerVersion: "1.0.0",
    authoritativeSource: null,
    asOfDate: null,
    retrievedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const mockAnalysis: Analysis = {
  analysisId: "analysis-001" as AnalysisId,
  documentVersionId: dvId,
  configHash: "abc123",
  stageVersions: null,
  status: "completed",
  error: null,
  startedAt: "2025-01-01T00:00:00.000Z",
  completedAt: "2025-01-01T00:01:00.000Z",
};

function makeProposal(overrides: Partial<ReviewProposal> = {}): ReviewProposal {
  return {
    proposalId: "prop-001" as ProposalId,
    analysisId: "analysis-001" as AnalysisId,
    documentVersionId: dvId,
    anchorId: "anc_test1" as AnchorId,
    segmentId: "seg_1" as SegmentId,
    quotedText: "July 1, 2025",
    kind: "effective_date",
    normalizedStart: 10,
    normalizedEnd: 22,
    originalStart: 10,
    originalEnd: 22,
    anchoringMethod: "exact",
    parsedExpression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
    resolved: true,
    statutoryDate: "2025-07-01",
    adjustedDate: "2025-07-01",
    rrule: null,
    ruleIds: ["FIXED_DATE"],
    citations: ["va-code § 1-210: effective date derived from FIXED_DATE rule"],
    packVersion: "us-va/v1",
    actor: null,
    actorQuotedText: null,
    dependsOnDescription: null,
    supportLevel: "ambiguous",
    lane: "exception_review",
    laneReasons: [{ rule: "ER_AMBIGUOUS", detail: "ambiguous support" }],
    status: "pending_review",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
} as unknown as Logger;

function createMockReviewRepository(): ReviewRepository {
  let storedProposals: ReviewProposal[] = [];
  const storedEvents: ReviewEvent[] = [];
  const storedRecords: RegisterRecord[] = [];

  return {
    insertProject: vi.fn(async (name, description) => ({
      projectId: "proj-001" as ProjectId,
      name,
      description,
      createdAt: new Date().toISOString(),
    })),
    getProject: vi.fn(async () => null),
    insertAnalysis: vi.fn(async (dvId, configHash, stageVersions) => ({
      analysisId: "analysis-001" as AnalysisId,
      documentVersionId: dvId,
      configHash,
      stageVersions: stageVersions ?? null,
      status: "running" as const,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    })),
    getAnalysis: vi.fn(async () => null),
    getAnalysisByConfig: vi.fn(async () => null),
    updateAnalysisStatus: vi.fn(),
    insertProposals: vi.fn(async (rows: ProposalInsert[]) => {
      storedProposals = rows.map((r, i) => ({
        ...makeProposal(),
        proposalId: `prop-${i}` as ProposalId,
        anchorId: r.anchorId as AnchorId,
        segmentId: r.segmentId as SegmentId,
        supportLevel: r.supportLevel as SupportLevel,
        lane: r.lane as Lane,
      }));
    }),
    getProposalsByVersion: vi.fn(async () => storedProposals),
    deletePendingProposalsByVersion: vi.fn(async () => 0),
    getProposal: vi.fn(async (id: ProposalId) =>
      storedProposals.find((p) => p.proposalId === id) ?? makeProposal({ proposalId: id }),
    ),
    updateProposalStatus: vi.fn(),
    updateProposalResolution: vi.fn(),
    insertReviewEvent: vi.fn(async (event) => {
      const created: ReviewEvent = {
        eventId: `evt-${storedEvents.length}` as ReviewEventId,
        proposalId: event.proposalId as ProposalId | null,
        action: event.action as ReviewAction,
        reviewerId: event.reviewerId,
        beforeValues: event.beforeValues,
        afterValues: event.afterValues,
        diff: event.diff as readonly ReviewDiff[],
        idempotencyKey: event.idempotencyKey,
        createdAt: new Date().toISOString(),
      };
      storedEvents.push(created);
      return created;
    }),
    getReviewEvent: vi.fn(async (id: ReviewEventId) =>
      storedEvents.find((e) => e.eventId === id) ?? null,
    ),
    getReviewEventByIdempotencyKey: vi.fn(async () => null),
    getReviewEventsByProposal: vi.fn(async () => []),
    insertRegisterRecord: vi.fn(async (record) => {
      const created: RegisterRecord = {
        recordId: `rec-${storedRecords.length}` as RegisterRecordId,
        recordVersionId: record.recordVersionId as RecordVersionId,
        proposalId: record.proposalId as ProposalId | null,
        reviewEventId: record.reviewEventId as ReviewEventId,
        documentVersionId: record.documentVersionId as DocumentVersionId,
        anchorId: record.anchorId as AnchorId | null,
        segmentId: record.segmentId as SegmentId | null,
        quotedText: record.quotedText,
        kind: record.kind,
        deadlineDate: record.deadlineDate,
        adjustedDate: record.adjustedDate,
        ruleIds: record.ruleIds as string[],
        citations: record.citations as string[],
        packVersion: record.packVersion,
        deliverable: record.deliverable,
        actor: record.actor,
        conditions: record.conditions,
        dateProvenance: record.dateProvenance as DateProvenance,
        status: "active",
        rrule: record.rrule ?? null,
        splitFromRecordId: record.splitFromRecordId as RegisterRecordId | null,
        createdAt: new Date().toISOString(),
      };
      storedRecords.push(created);
      return created;
    }),
    getRegisterRecord: vi.fn(async (id: RegisterRecordId) =>
      storedRecords.find((r) => r.recordId === id) ?? null,
    ),
    getRegisterRecordsByVersion: vi.fn(async () => storedRecords),
    getAllActiveRecords: vi.fn(async () => storedRecords.filter((r) => r.status === "active")),
    getRecordsByReviewEvent: vi.fn(async (eventId: ReviewEventId) =>
      storedRecords.filter((r) => r.reviewEventId === eventId),
    ),
    getEvaluatorPromptHash: vi.fn(async () => "ph_eval_test"),
    getIdempotencyResponse: vi.fn(async () => null),
    setIdempotencyResponse: vi.fn(),
    insertOccurrences: vi.fn(),
    getOccurrencesByRecord: vi.fn(async () => []),
    getLatestCompletedAnalysis: vi.fn(async () => null),
    getLatestProposalByAnchor: vi.fn(async () => null),
  };
}

function createMockPipeline(): PipelineServices {
  return {
    parse: vi.fn(async () => {}),
    scan: vi.fn(async () => {}),
    extract: vi.fn(async () => {}),
    anchor: vi.fn(async () => {}),
    parseGrammar: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
    route: vi.fn(async () => {}),
  };
}

function createDeps() {
  const reviewRepo = createMockReviewRepository();
  const pipeline = createMockPipeline();
  return {
    reviewRepository: reviewRepo,
    ingestionRepository: {
      getVersion: vi.fn(async () => makeVersion()),
      findOrCreateDocument: vi.fn(),
      findVersionByHash: vi.fn(),
      insertVersion: vi.fn(),
      listVersions: vi.fn(),
      getDocument: vi.fn(),
    } as unknown as IngestionRepository,
    parsingRepository: {
      getSegmentsByVersion: vi.fn(async () => []),
    } as unknown as ParsingRepository,
    anchoringRepository: {
      getResultsByVersion: vi.fn(async () => [
        {
          anchorId: "anc_test1" as AnchorId,
          segmentId: "seg_1" as SegmentId,
          quotedText: "July 1, 2025",
          kind: "effective_date",
          result: {
            anchored: true,
            normalizedStart: 10,
            normalizedEnd: 22,
            originalStart: 10,
            originalEnd: 22,
            method: "exact",
          },
          actor: null,
          actorQuotedText: null,
          actorAnchored: null,
          dependsOnQuotedText: null,
          dependsOnDescription: null,
          dependsOnAnchored: null,
        },
      ]),
    } as unknown as AnchoringRepository,
    grammarRepository: {
      getResultsByVersion: vi.fn(async () => [
        {
          anchorId: "anc_test1" as AnchorId,
          segmentId: "seg_1" as SegmentId,
          text: "July 1, 2025",
          result: {
            parsed: true,
            expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
          },
        },
      ]),
    } as unknown as GrammarRepository,
    resolverRepository: {
      getResultsByVersion: vi.fn(async () => [
        {
          anchorId: "anc_test1" as AnchorId,
          segmentId: "seg_1" as SegmentId,
          text: "July 1, 2025",
          expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
          result: {
            resolved: true,
            statutoryDate: "2025-07-01",
            adjustedDate: "2025-07-01",
            ruleIds: ["FIXED_DATE"],
            citations: ["va-code § 1-210: effective date derived from FIXED_DATE rule"],
            packVersion: "us-va/v1",
            warnings: [],
            inputs: [],
          },
        },
      ]),
    } as unknown as ResolverRepository,
    evaluationRepository: {
      getResultsByVersion: vi.fn(async () => [
        {
          anchorId: "anc_test1" as AnchorId,
          segmentId: "seg_1" as SegmentId,
          quotedText: "July 1, 2025",
          deterministicResult: { allPassed: true, checks: [] },
          evaluatorVerdict: "ambiguous" as EvaluatorVerdict,
          supportLevel: "ambiguous" as SupportLevel,
        },
      ]),
    } as unknown as EvaluationRepository,
    routingRepository: {
      getAssignmentsByVersion: vi.fn(async () => [
        {
          anchorId: "anc_test1" as AnchorId,
          segmentId: "seg_1" as SegmentId,
          lane: "exception_review",
          reasons: [{ rule: "ER_AMBIGUOUS", detail: "ambiguous" }],
        },
      ]),
    } as unknown as RoutingRepository,
    extractionRepository: {
      getCallsByVersion: vi.fn(async () => [
        {
          modelCallId: "mcall_test",
          documentVersionId: dvId,
          segmentId: "seg_1" as SegmentId,
          modelId: "fixture",
          promptHash: "ph_fixture",
          requestPayload: "{}",
          responsePayload: "{}",
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 0,
          correlationId: "test",
          repaired: false,
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]),
    } as unknown as ExtractionRepository,
    pipeline,
    logger: mockLogger,
  };
}

describe("review service", () => {
  describe("analysis", () => {
    it("runs full pipeline and derives proposals", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const analysis = await service.startAnalysis(dvId);

      expect(analysis.status).toBe("completed");
      expect(deps.pipeline.parse).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.scan).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.extract).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.anchor).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.parseGrammar).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.resolve).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.evaluate).toHaveBeenCalledWith(dvId);
      expect(deps.pipeline.route).toHaveBeenCalledWith(dvId);
      expect(deps.reviewRepository.insertProposals).toHaveBeenCalled();
    });

    it("returns existing analysis when config matches (idempotent)", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getAnalysisByConfig as ReturnType<typeof vi.fn>)
        .mockResolvedValue(mockAnalysis);

      const service = createReviewService(deps);
      const analysis = await service.startAnalysis(dvId);

      expect(analysis.status).toBe("completed");
      expect(deps.pipeline.parse).not.toHaveBeenCalled();
    });

    it("throws when document not found", async () => {
      const deps = createDeps();
      (deps.ingestionRepository.getVersion as ReturnType<typeof vi.fn>)
        .mockResolvedValue(null);

      const service = createReviewService(deps);
      await expect(service.startAnalysis(dvId)).rejects.toThrow("not found");
    });
  });

  describe("review decisions", () => {
    it("accept: creates review event and register record", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-accept-1",
        },
      );

      expect(result.event.action).toBe("accept");
      expect(result.event.reviewerId).toBe("reviewer-alice");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.deadlineDate).toBe("2025-07-01");
      expect(result.records[0]!.dateProvenance).toBe("computed");
      expect(result.records[0]!.citations.length).toBeGreaterThan(0);
      expect(result.records[0]!.ruleIds).toContain("FIXED_DATE");
      expect(deps.reviewRepository.updateProposalStatus).toHaveBeenCalledWith(
        "prop-001",
        "accepted",
      );
    });

    it("accept: blocks unsupported proposals — INV gate", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({ supportLevel: "unsupported" }),
        );

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-accept-unsupported",
        }),
      ).rejects.toThrow("unsupported");
    });

    it("accept: blocks unresolved proposals", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({ resolved: false, statutoryDate: null }),
        );

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-accept-unresolved",
        }),
      ).rejects.toThrow("requires a resolved result");
    });

    it("edit_and_accept: creates event with diff, allows unresolved", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({ resolved: false, statutoryDate: null, adjustedDate: null }),
        );

      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "edit_and_accept",
          reviewerId: "reviewer-bob",
          idempotencyKey: "idem-edit-1",
          edits: {
            deadlineDate: "2025-09-15",
            adjustedDate: "2025-09-15",
            deliverable: "compliance report",
          },
        },
      );

      expect(result.event.action).toBe("edit_and_accept");
      expect(result.event.diff.length).toBeGreaterThan(0);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.deadlineDate).toBe("2025-09-15");
      expect(result.records[0]!.deliverable).toBe("compliance report");
      expect(result.records[0]!.dateProvenance).toBe("reviewer_asserted");
      expect(result.records[0]!.citations.length).toBeGreaterThan(0);
      expect(result.records[0]!.citations[0]).toContain("reviewer_asserted");
      expect(result.records[0]!.citations[0]).toContain("reviewer-bob");
      expect(result.records[0]!.citations[0]).toContain("2025-09-15");
    });

    it("reject: creates event, no register record", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "reject",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-reject-1",
        },
      );

      expect(result.event.action).toBe("reject");
      expect(result.records).toHaveLength(0);
      expect(deps.reviewRepository.updateProposalStatus).toHaveBeenCalledWith(
        "prop-001",
        "rejected",
      );
    });

    it("split: creates linked records", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "split",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-split-1",
          splitRecords: [
            {
              deadlineDate: "2025-07-01",
              adjustedDate: "2025-07-01",
              kind: "effective_date",
              deliverable: "first obligation",
            },
            {
              deadlineDate: "2025-08-01",
              adjustedDate: "2025-08-01",
              kind: "obligation_deadline",
              deliverable: "second obligation",
            },
          ],
        },
      );

      expect(result.event.action).toBe("split");
      expect(result.records).toHaveLength(2);
      expect(result.records[0]!.deadlineDate).toBe("2025-07-01");
      expect(result.records[1]!.deadlineDate).toBe("2025-08-01");
      expect(deps.reviewRepository.updateProposalStatus).toHaveBeenCalledWith(
        "prop-001",
        "split",
      );
    });

    it("split: requires at least 2 records", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "split",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-split-fail",
          splitRecords: [
            {
              deadlineDate: "2025-07-01",
              adjustedDate: "2025-07-01",
              kind: "effective_date",
            },
          ],
        }),
      ).rejects.toThrow("at least 2");
    });

    it("idempotent: same key returns same result", async () => {
      const deps = createDeps();
      const existingEvent: ReviewEvent = {
        eventId: "evt-existing" as ReviewEventId,
        proposalId: "prop-001" as ProposalId,
        action: "accept",
        reviewerId: "reviewer-alice",
        beforeValues: {},
        afterValues: {},
        diff: [],
        idempotencyKey: "idem-dupe",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      (deps.reviewRepository.getReviewEventByIdempotencyKey as ReturnType<typeof vi.fn>)
        .mockResolvedValue(existingEvent);
      (deps.reviewRepository.getRecordsByReviewEvent as ReturnType<typeof vi.fn>)
        .mockResolvedValue([]);

      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-dupe",
        },
      );

      expect(result.event.eventId).toBe("evt-existing");
      expect(deps.reviewRepository.insertReviewEvent).not.toHaveBeenCalled();
    });

    it("rejects already-reviewed proposals", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(makeProposal({ status: "accepted" }));

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-already-done",
        }),
      ).rejects.toThrow("not pending_review");
    });
  });

  describe("manual record", () => {
    it("creates event and record without proposal", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.addManualRecord(dvId, {
        reviewerId: "reviewer-carol",
        idempotencyKey: "idem-manual-1",
        deadlineDate: "2025-12-31",
        adjustedDate: "2025-12-31",
        kind: "obligation_deadline",
        deliverable: "annual report",
      });

      expect(result.event.action).toBe("manual_add");
      expect(result.record.proposalId).toBeNull();
      expect(result.record.deadlineDate).toBe("2025-12-31");
      expect(result.record.deliverable).toBe("annual report");
    });
  });

  describe("date provenance", () => {
    it("accept on resolved proposal sets dateProvenance = computed", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-prov-computed",
        },
      );

      expect(result.records[0]!.dateProvenance).toBe("computed");
    });

    it("edit_and_accept on unresolved proposal sets dateProvenance = reviewer_asserted with citation", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({
            resolved: false,
            statutoryDate: null,
            adjustedDate: null,
            parsedExpression: { kind: "relative_duration", unit: "days", quantity: 30 },
          }),
        );

      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "edit_and_accept",
          reviewerId: "reviewer-bob",
          idempotencyKey: "idem-prov-asserted",
          edits: {
            deadlineDate: "2025-09-15",
            adjustedDate: "2025-09-15",
          },
        },
      );

      expect(result.records[0]!.dateProvenance).toBe("reviewer_asserted");
      expect(result.records[0]!.citations.length).toBeGreaterThan(0);
      expect(result.records[0]!.citations[0]).toContain("reviewer_asserted");
      expect(result.records[0]!.citations[0]).toContain("reviewer-bob");
      expect(result.records[0]!.citations[0]).toContain("triggerDate");
    });

    it("no reviewer_asserted record can have empty citations", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({ resolved: false, statutoryDate: null, adjustedDate: null }),
        );

      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "edit_and_accept",
          reviewerId: "reviewer-carol",
          idempotencyKey: "idem-prov-nonempty",
          edits: { deadlineDate: "2025-10-01" },
        },
      );

      expect(result.records[0]!.dateProvenance).toBe("reviewer_asserted");
      expect(result.records[0]!.citations.length).toBeGreaterThan(0);
    });

    it("manual_add sets dateProvenance = reviewer_asserted with citation", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.addManualRecord(dvId, {
        reviewerId: "reviewer-manual",
        idempotencyKey: "idem-prov-manual",
        deadlineDate: "2025-12-31",
        adjustedDate: "2025-12-31",
        kind: "obligation_deadline",
      });

      expect(result.record.dateProvenance).toBe("reviewer_asserted");
      expect(result.record.citations.length).toBeGreaterThan(0);
      expect(result.record.citations[0]).toContain("reviewer_asserted");
      expect(result.record.citations[0]).toContain("reviewer-manual");
      expect(result.record.citations[0]).toContain("manual_add");
    });

    it("unresolved proposal cannot produce dateProvenance = computed", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({ resolved: false, statutoryDate: null, adjustedDate: null }),
        );

      const service = createReviewService(deps);

      // accept rejects — unresolved cannot compute
      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-struct",
          idempotencyKey: "idem-struct-1",
        }),
      ).rejects.toThrow("requires a resolved result");

      // edit_and_accept yields reviewer_asserted, never computed
      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "edit_and_accept",
          reviewerId: "reviewer-struct",
          idempotencyKey: "idem-struct-2",
          edits: { deadlineDate: "2025-10-01" },
        },
      );
      expect(result.records[0]!.dateProvenance).toBe("reviewer_asserted");
    });

    it("accept with empty citations cannot produce dateProvenance = computed", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({
            resolved: true,
            statutoryDate: "2025-07-01",
            ruleIds: ["FIXED_DATE"],
            citations: [],
            packVersion: "us-va/v1",
          }),
        );

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-struct",
          idempotencyKey: "idem-struct-3",
        }),
      ).rejects.toThrow("requires non-empty citations");
    });

    it("accept with empty ruleIds cannot produce dateProvenance = computed", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(
          makeProposal({
            resolved: true,
            statutoryDate: "2025-07-01",
            ruleIds: [],
            citations: ["some citation"],
            packVersion: "us-va/v1",
          }),
        );

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-struct",
          idempotencyKey: "idem-struct-4",
        }),
      ).rejects.toThrow("requires non-empty ruleIds");
    });

    it("split records set dateProvenance = reviewer_asserted with citations", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "split",
          reviewerId: "reviewer-split",
          idempotencyKey: "idem-prov-split",
          splitRecords: [
            { deadlineDate: "2025-07-01", adjustedDate: "2025-07-01", kind: "effective_date" },
            { deadlineDate: "2025-08-01", adjustedDate: "2025-08-01", kind: "obligation_deadline" },
          ],
        },
      );

      for (const record of result.records) {
        expect(record.dateProvenance).toBe("reviewer_asserted");
        expect(record.citations.length).toBeGreaterThan(0);
        expect(record.citations[0]).toContain("reviewer_asserted");
      }
    });
  });

  describe("INV-9: no record authoritative without reviewer event", () => {
    it("every register record has a review event", async () => {
      const deps = createDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview(
        "prop-001" as ProposalId,
        {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-inv9-check",
        },
      );

      expect(result.event).toBeDefined();
      expect(result.event.reviewerId).toBe("reviewer-alice");
      for (const record of result.records) {
        expect(record.reviewEventId).toBe(result.event.eventId);
      }
    });
  });

  describe("INV-10: immutable events", () => {
    it("review events are insert-only — no update method exists", () => {
      const deps = createDeps();
      const repo = deps.reviewRepository;
      expect(typeof repo.insertReviewEvent).toBe("function");
      // No updateReviewEvent method exists
      expect((repo as unknown as Record<string, unknown>).updateReviewEvent).toBeUndefined();
    });
  });

  describe("recurrence acceptance", () => {
    const recurrenceOccurrences = [
      {
        occurrenceDate: "2026-12-15",
        adjustedDate: "2026-12-15",
        ruleIds: ["va-1-210-E-evaluated-no-adjustment"],
        citations: ["Va. Code § 1-210(E) evaluated — date falls on a business day, no adjustment required"],
        sequenceNumber: 1,
      },
      {
        occurrenceDate: "2028-12-15",
        adjustedDate: "2028-12-15",
        ruleIds: ["va-1-210-E-evaluated-no-adjustment"],
        citations: ["Va. Code § 1-210(E) evaluated — date falls on a business day, no adjustment required"],
        sequenceNumber: 2,
      },
      {
        occurrenceDate: "2030-12-15",
        adjustedDate: "2030-12-16",
        ruleIds: ["va-1-210-E-sunday", "va-1-210-E-next-business-day"],
        citations: ["Va. Code § 1-210(E): December 15, 2030 falls on Sunday", "Va. Code § 1-210(E): adjusted to next business day 2030-12-16"],
        sequenceNumber: 3,
      },
    ];

    function makeRecurrenceProposal(): ReviewProposal {
      return makeProposal({
        quotedText: "each December 15 in even-numbered years thereafter",
        kind: "recurrence",
        resolved: true,
        statutoryDate: null,
        adjustedDate: null,
        rrule: "FREQ=YEARLY;INTERVAL=2;BYMONTH=12;BYMONTHDAY=15",
        ruleIds: ["recurrence-schedule", "year-parity-filter"],
        citations: [
          "recurrence rule: FREQ=YEARLY;INTERVAL=2;BYMONTH=12;BYMONTHDAY=15",
          "year parity: even-numbered years only (RRULE INTERVAL=2 with DTSTART in even year 2026)",
        ],
        packVersion: "us-va/v1",
      });
    }

    function createRecurrenceDeps() {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(makeRecurrenceProposal());
      (deps.resolverRepository as unknown as { getResultsByVersion: ReturnType<typeof vi.fn> })
        .getResultsByVersion = vi.fn(async () => [
          {
            anchorId: "anc_test1" as AnchorId,
            segmentId: "seg_1" as SegmentId,
            text: "each December 15 in even-numbered years thereafter",
            expression: { kind: "recurrence" },
            result: {
              resolved: true,
              recurrence: true,
              rrule: "FREQ=YEARLY;INTERVAL=2;BYMONTH=12;BYMONTHDAY=15",
              occurrences: recurrenceOccurrences,
              horizon: "2031-12-31",
              yearParityNote: "even-numbered years",
              ruleIds: ["recurrence-schedule", "year-parity-filter"],
              citations: [
                "recurrence rule: FREQ=YEARLY;INTERVAL=2;BYMONTH=12;BYMONTHDAY=15",
                "year parity: even-numbered years only",
              ],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          },
        ]);
      return deps;
    }

    it("accept: recurrence proposal produces register record with rrule and first occurrence as deadlineDate", async () => {
      const deps = createRecurrenceDeps();
      const service = createReviewService(deps);

      const result = await service.submitReview("prop-001" as ProposalId, {
        action: "accept",
        reviewerId: "reviewer-alice",
        idempotencyKey: "idem-recurrence-accept",
      });

      expect(result.records).toHaveLength(1);
      const record = result.records[0]!;
      expect(record.rrule).toBe("FREQ=YEARLY;INTERVAL=2;BYMONTH=12;BYMONTHDAY=15");
      expect(record.deadlineDate).toBe("2026-12-15");
      expect(record.adjustedDate).toBe("2026-12-15");
      expect(record.dateProvenance).toBe("computed");
      expect(record.ruleIds).toContain("recurrence-schedule");
      expect(record.ruleIds).toContain("year-parity-filter");
    });

    it("accept: materializes occurrences with per-occurrence §1-210(E)", async () => {
      const deps = createRecurrenceDeps();
      const service = createReviewService(deps);

      await service.submitReview("prop-001" as ProposalId, {
        action: "accept",
        reviewerId: "reviewer-alice",
        idempotencyKey: "idem-recurrence-occ",
      });

      const insertOccurrencesMock = deps.reviewRepository.insertOccurrences as ReturnType<typeof vi.fn>;
      expect(insertOccurrencesMock).toHaveBeenCalledTimes(1);

      const [_recordVersionId, occurrences] = insertOccurrencesMock.mock.calls[0] as [string, typeof recurrenceOccurrences];
      expect(occurrences).toHaveLength(3);

      // 2030-12-15 falls on Sunday → adjusted to 2030-12-16
      const dec2030 = occurrences.find((o) => o.occurrenceDate === "2030-12-15");
      expect(dec2030).toBeDefined();
      expect(dec2030!.adjustedDate).toBe("2030-12-16");
      expect(dec2030!.ruleIds).toContain("va-1-210-E-sunday");
      expect(dec2030!.citations.some((c: string) => c.includes("§ 1-210(E)"))).toBe(true);
    });

    it("accept: INV-6 — rejects occurrence with empty citations", async () => {
      const deps = createRecurrenceDeps();
      (deps.resolverRepository as unknown as { getResultsByVersion: ReturnType<typeof vi.fn> })
        .getResultsByVersion = vi.fn(async () => [
          {
            anchorId: "anc_test1" as AnchorId,
            segmentId: "seg_1" as SegmentId,
            text: "each December 15",
            expression: { kind: "recurrence" },
            result: {
              resolved: true,
              recurrence: true,
              rrule: "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=15",
              occurrences: [
                {
                  occurrenceDate: "2026-12-15",
                  adjustedDate: "2026-12-15",
                  ruleIds: [],
                  citations: [],
                  sequenceNumber: 1,
                },
              ],
              horizon: "2031-12-31",
              yearParityNote: null,
              ruleIds: ["recurrence-schedule"],
              citations: ["recurrence rule: FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=15"],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          },
        ]);

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-recurrence-inv6",
        }),
      ).rejects.toThrow("INV-6");
    });

    it("accept: rejects recurrence with no occurrences", async () => {
      const deps = createRecurrenceDeps();
      (deps.resolverRepository as unknown as { getResultsByVersion: ReturnType<typeof vi.fn> })
        .getResultsByVersion = vi.fn(async () => [
          {
            anchorId: "anc_test1" as AnchorId,
            segmentId: "seg_1" as SegmentId,
            text: "each December 15",
            expression: { kind: "recurrence" },
            result: {
              resolved: true,
              recurrence: true,
              rrule: "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=15",
              occurrences: [],
              horizon: "2031-12-31",
              yearParityNote: null,
              ruleIds: ["recurrence-schedule"],
              citations: ["recurrence rule: FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=15"],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          },
        ]);

      const service = createReviewService(deps);

      await expect(
        service.submitReview("prop-001" as ProposalId, {
          action: "accept",
          reviewerId: "reviewer-alice",
          idempotencyKey: "idem-recurrence-empty",
        }),
      ).rejects.toThrow("no occurrences");
    });

    it("non-recurrence accept still works (rrule=null, no occurrences)", async () => {
      const deps = createDeps();
      (deps.reviewRepository.getProposal as ReturnType<typeof vi.fn>)
        .mockResolvedValue(makeProposal());

      const service = createReviewService(deps);

      const result = await service.submitReview("prop-001" as ProposalId, {
        action: "accept",
        reviewerId: "reviewer-alice",
        idempotencyKey: "idem-non-recurrence",
      });

      expect(result.records).toHaveLength(1);
      const record = result.records[0]!;
      expect(record.rrule).toBeNull();
      expect(record.deadlineDate).toBe("2025-07-01");

      const insertOccurrencesMock = deps.reviewRepository.insertOccurrences as ReturnType<typeof vi.fn>;
      expect(insertOccurrencesMock).not.toHaveBeenCalled();
    });
  });
});
