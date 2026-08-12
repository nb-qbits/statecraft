import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "../../platform/logger/logger.js";
import type { ReviewRepository } from "../../platform/db/review-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { RoutingRepository } from "../../platform/db/routing-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type {
  DocumentVersionId,
  ProposalId,
  RegisterRecordId,
  SegmentId,
  AnalysisId,
} from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { ProposalAnchorResult } from "../anchoring/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { LaneAssignment } from "../routing/types.js";
import type {
  Analysis,
  ReviewProposal,
  ReviewEvent,
  RegisterRecord,
  ProvenanceSheet,
  ReviewDecisionInput,
  ManualRecordInput,
  ReviewDiff,
  Project,
} from "./types.js";
import { REVIEW_VERSION } from "./types.js";

import { SCANNER_VERSION } from "../scanning/scanner.js";
import { EXTRACTOR_VERSION } from "../extraction/service.js";
import { ANCHORER_VERSION } from "../anchoring/service.js";
import { GRAMMAR_VERSION } from "../grammar/service.js";
import { RESOLVER_VERSION } from "../resolver/service.js";
import { EVALUATOR_VERSION } from "../evaluation/types.js";
import { ROUTER_VERSION } from "../routing/types.js";
import type { ProposalInsert } from "../../platform/db/review-repository.js";

export interface PipelineServices {
  parse(dvId: DocumentVersionId): Promise<unknown>;
  scan(dvId: DocumentVersionId): Promise<unknown>;
  extract(dvId: DocumentVersionId): Promise<unknown>;
  anchor(dvId: DocumentVersionId): Promise<unknown>;
  parseGrammar(dvId: DocumentVersionId): Promise<unknown>;
  resolve(dvId: DocumentVersionId): Promise<unknown>;
  evaluate(dvId: DocumentVersionId): Promise<unknown>;
  route(dvId: DocumentVersionId): Promise<unknown>;
}

export interface ReviewServiceDeps {
  reviewRepository: ReviewRepository;
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  evaluationRepository: EvaluationRepository;
  routingRepository: RoutingRepository;
  extractionRepository: ExtractionRepository;
  pipeline: PipelineServices;
  logger: Logger;
}

function computeConfigHash(): string {
  const versions = [
    SCANNER_VERSION,
    EXTRACTOR_VERSION,
    ANCHORER_VERSION,
    GRAMMAR_VERSION,
    RESOLVER_VERSION,
    EVALUATOR_VERSION,
    ROUTER_VERSION,
    REVIEW_VERSION,
  ];
  return createHash("sha256").update(versions.join(":")).digest("hex");
}

function proposalSnapshot(p: ReviewProposal): Record<string, unknown> {
  return {
    proposalId: p.proposalId,
    anchorId: p.anchorId,
    segmentId: p.segmentId,
    quotedText: p.quotedText,
    kind: p.kind,
    resolved: p.resolved,
    statutoryDate: p.statutoryDate,
    adjustedDate: p.adjustedDate,
    ruleIds: p.ruleIds,
    citations: p.citations,
    packVersion: p.packVersion,
    supportLevel: p.supportLevel,
    lane: p.lane,
    deliverable: null,
    actor: null,
    conditions: null,
  };
}

function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ReviewDiff[] {
  const diffs: ReviewDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const bVal = before[key];
    const aVal = after[key];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      diffs.push({ field: key, before: bVal, after: aVal });
    }
  }
  return diffs;
}

function buildResolverFailureReason(proposal: ReviewProposal): string {
  if (!proposal.parsedExpression) {
    return "grammar parse failed";
  }
  const expr = proposal.parsedExpression;
  if (expr.kind === "relative_duration" || expr.kind === "relative_date") {
    return "triggerDate is required to resolve a relative duration";
  }
  return "automatic resolution could not derive a date";
}

interface ComputedDateFields {
  readonly dateProvenance: "computed";
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly ruleIds: string[];
  readonly citations: string[];
  readonly packVersion: string;
}

function buildComputedDateFields(proposal: ReviewProposal): ComputedDateFields {
  if (!proposal.resolved || !proposal.statutoryDate) {
    throw new AppError({
      code: "COMPUTED_DATE_REQUIRES_RESOLUTION",
      category: "internal",
      message: "dateProvenance 'computed' requires a resolved date from the resolver",
      retryable: false,
      context: { proposalId: proposal.proposalId, resolved: proposal.resolved },
    });
  }
  const ruleIds = proposal.ruleIds as string[];
  const citations = proposal.citations as string[];
  if (ruleIds.length === 0 || !proposal.packVersion) {
    throw new AppError({
      code: "COMPUTED_DATE_MISSING_PROVENANCE",
      category: "internal",
      message:
        "dateProvenance 'computed' requires non-empty ruleIds and a packVersion from the resolver",
      retryable: false,
      context: {
        proposalId: proposal.proposalId,
        ruleIds,
        packVersion: proposal.packVersion,
      },
    });
  }
  if (citations.length === 0) {
    throw new AppError({
      code: "COMPUTED_DATE_EMPTY_CITATIONS",
      category: "internal",
      message:
        "dateProvenance 'computed' requires non-empty citations — a date without a statutory citation is not defensible",
      retryable: false,
      context: { proposalId: proposal.proposalId },
    });
  }
  return {
    dateProvenance: "computed",
    deadlineDate: proposal.statutoryDate,
    adjustedDate: proposal.adjustedDate ?? proposal.statutoryDate,
    ruleIds,
    citations,
    packVersion: proposal.packVersion,
  };
}

interface ReviewerAssertedDateFields {
  readonly dateProvenance: "reviewer_asserted";
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly citations: string[];
}

function buildReviewerAssertedDateFields(
  reviewerId: string,
  deadlineDate: string,
  adjustedDate: string,
  reason: string,
  baseCitations?: readonly string[],
): ReviewerAssertedDateFields {
  const citation =
    `reviewer_asserted: date ${deadlineDate} supplied by ${reviewerId} — ${reason}`;
  return {
    dateProvenance: "reviewer_asserted",
    deadlineDate,
    adjustedDate,
    citations: [citation, ...(baseCitations ?? [])],
  };
}

export function createReviewService(deps: ReviewServiceDeps) {
  const {
    reviewRepository,
    ingestionRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    routingRepository,
    extractionRepository,
    pipeline,
    logger,
  } = deps;

  async function requireVersion(
    dvId: DocumentVersionId,
  ): Promise<DocumentVersion> {
    const version = await ingestionRepository.getVersion(dvId);
    if (!version) {
      throw new AppError({
        code: "DOCUMENT_NOT_FOUND",
        category: "user_input",
        message: `Document version ${dvId} not found`,
        retryable: false,
        context: { documentVersionId: dvId },
      });
    }
    return version;
  }

  return {
    // ── Projects ──────────────────────────────────────────────

    async createProject(
      name: string,
      description: string | null,
    ): Promise<Project> {
      return reviewRepository.insertProject(name, description);
    },

    // ── Analysis ──────────────────────────────────────────────

    async startAnalysis(
      documentVersionId: DocumentVersionId,
    ): Promise<Analysis> {
      await requireVersion(documentVersionId);
      const configHash = computeConfigHash();

      const existing = await reviewRepository.getAnalysisByConfig(
        documentVersionId,
        configHash,
      );
      if (existing && existing.status === "completed") {
        logger.info(
          { documentVersionId, configHash },
          "analysis already completed with current config",
        );
        return existing;
      }

      if (existing && existing.status === "running") {
        return existing;
      }

      if (existing && existing.status === "failed") {
        await reviewRepository.updateAnalysisStatus(
          existing.analysisId,
          "running",
        );
      }

      let analysis: Analysis;
      if (existing) {
        analysis = { ...existing, status: "running" as const };
      } else {
        analysis = await reviewRepository.insertAnalysis(
          documentVersionId,
          configHash,
        );
      }

      try {
        await pipeline.parse(documentVersionId);
        await pipeline.scan(documentVersionId);
        await pipeline.extract(documentVersionId);
        await pipeline.anchor(documentVersionId);
        await pipeline.parseGrammar(documentVersionId);
        await pipeline.resolve(documentVersionId);
        await pipeline.evaluate(documentVersionId);
        await pipeline.route(documentVersionId);

        await deriveProposals(analysis.analysisId, documentVersionId);

        await reviewRepository.updateAnalysisStatus(
          analysis.analysisId,
          "completed",
        );

        logger.info(
          { documentVersionId, analysisId: analysis.analysisId },
          "analysis completed",
        );

        return {
          ...analysis,
          status: "completed" as const,
          completedAt: new Date().toISOString(),
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown error";
        await reviewRepository.updateAnalysisStatus(
          analysis.analysisId,
          "failed",
          message,
        );
        throw err;
      }
    },

    async getAnalysisStatus(
      documentVersionId: DocumentVersionId,
    ): Promise<Analysis | null> {
      const configHash = computeConfigHash();
      return reviewRepository.getAnalysisByConfig(
        documentVersionId,
        configHash,
      );
    },

    // ── Proposals ─────────────────────────────────────────────

    async getProposals(
      documentVersionId: DocumentVersionId,
    ): Promise<ReviewProposal[]> {
      return reviewRepository.getProposalsByVersion(documentVersionId);
    },

    async getProposal(
      proposalId: ProposalId,
    ): Promise<ReviewProposal | null> {
      return reviewRepository.getProposal(proposalId);
    },

    // ── Review Decisions ──────────────────────────────────────

    async submitReview(
      proposalId: ProposalId,
      input: ReviewDecisionInput,
    ): Promise<{
      event: ReviewEvent;
      records: RegisterRecord[];
    }> {
      // Idempotency: check if this key was already used
      const existingEvent =
        await reviewRepository.getReviewEventByIdempotencyKey(
          input.idempotencyKey,
        );
      if (existingEvent) {
        const existingRecords =
          await reviewRepository.getRecordsByReviewEvent(
            existingEvent.eventId,
          );
        return { event: existingEvent, records: existingRecords };
      }

      const proposal = await reviewRepository.getProposal(proposalId);
      if (!proposal) {
        throw new AppError({
          code: "PROPOSAL_NOT_FOUND",
          category: "user_input",
          message: `Proposal ${proposalId} not found`,
          retryable: false,
          context: { proposalId },
        });
      }

      if (proposal.status !== "pending_review") {
        throw new AppError({
          code: "PROPOSAL_NOT_PENDING",
          category: "user_input",
          message: `Proposal ${proposalId} is ${proposal.status}, not pending_review`,
          retryable: false,
          context: { proposalId, status: proposal.status },
        });
      }

      // INV-9: every record needs a reviewer event — enforced structurally
      // because we always create a review event before any register record.

      switch (input.action) {
        case "accept":
          return handleAccept(proposal, input);
        case "edit_and_accept":
          return handleEditAndAccept(proposal, input);
        case "reject":
          return handleReject(proposal, input);
        case "split":
          return handleSplit(proposal, input);
        default:
          throw new AppError({
            code: "INVALID_ACTION",
            category: "user_input",
            message: `Invalid review action: ${input.action}`,
            retryable: false,
            context: { action: input.action },
          });
      }
    },

    async addManualRecord(
      documentVersionId: DocumentVersionId,
      input: ManualRecordInput,
    ): Promise<{
      event: ReviewEvent;
      record: RegisterRecord;
    }> {
      const existingEvent =
        await reviewRepository.getReviewEventByIdempotencyKey(
          input.idempotencyKey,
        );
      if (existingEvent) {
        const records = await reviewRepository.getRecordsByReviewEvent(
          existingEvent.eventId,
        );
        return { event: existingEvent, record: records[0]! };
      }

      await requireVersion(documentVersionId);

      const manualDateFields = buildReviewerAssertedDateFields(
        input.reviewerId,
        input.deadlineDate,
        input.adjustedDate,
        "manual_add — date supplied directly by reviewer",
        input.citations,
      );

      const afterValues: Record<string, unknown> = {
        deadlineDate: manualDateFields.deadlineDate,
        adjustedDate: manualDateFields.adjustedDate,
        kind: input.kind,
        deliverable: input.deliverable ?? null,
        actor: input.actor ?? null,
        conditions: input.conditions ?? null,
        ruleIds: input.ruleIds ?? [],
        citations: manualDateFields.citations,
        packVersion: input.packVersion ?? null,
        dateProvenance: manualDateFields.dateProvenance,
      };

      const event = await reviewRepository.insertReviewEvent({
        proposalId: null,
        action: "manual_add",
        reviewerId: input.reviewerId,
        beforeValues: null,
        afterValues,
        diff: [],
        idempotencyKey: input.idempotencyKey,
      });

      const record = await reviewRepository.insertRegisterRecord({
        recordVersionId: randomUUID(),
        proposalId: null,
        reviewEventId: event.eventId,
        documentVersionId,
        anchorId: null,
        segmentId: null,
        quotedText: null,
        kind: input.kind,
        deadlineDate: manualDateFields.deadlineDate,
        adjustedDate: manualDateFields.adjustedDate,
        ruleIds: input.ruleIds ?? [],
        citations: manualDateFields.citations,
        packVersion: input.packVersion ?? null,
        deliverable: input.deliverable ?? null,
        actor: input.actor ?? null,
        conditions: input.conditions ?? null,
        dateProvenance: manualDateFields.dateProvenance,
        splitFromRecordId: null,
      });

      logger.info(
        {
          documentVersionId,
          recordId: record.recordId,
          reviewerId: input.reviewerId,
        },
        "manual record added",
      );

      return { event, record };
    },

    // ── Register ──────────────────────────────────────────────

    async getRegister(): Promise<RegisterRecord[]> {
      return reviewRepository.getAllActiveRecords();
    },

    async getRecord(
      recordId: RegisterRecordId,
    ): Promise<RegisterRecord | null> {
      return reviewRepository.getRegisterRecord(recordId);
    },

    // ── Provenance Sheet ──────────────────────────────────────

    async getProvenance(
      recordId: RegisterRecordId,
    ): Promise<ProvenanceSheet> {
      const record = await reviewRepository.getRegisterRecord(recordId);
      if (!record) {
        throw new AppError({
          code: "RECORD_NOT_FOUND",
          category: "user_input",
          message: `Register record ${recordId} not found`,
          retryable: false,
          context: { recordId },
        });
      }

      const [version, event] = await Promise.all([
        ingestionRepository.getVersion(record.documentVersionId),
        reviewRepository.getReviewEvent(record.reviewEventId),
      ]);

      if (!version || !event) {
        throw new AppError({
          code: "PROVENANCE_INCOMPLETE",
          category: "internal",
          message: "Document version or review event missing for provenance",
          retryable: false,
          context: { recordId },
        });
      }

      let quotedSpan: ProvenanceSheet["quotedSpan"] = null;
      let anchoringMethod: string | null = null;
      let deterministicParseResult: ProvenanceSheet["deterministicParseResult"] =
        null;
      let modelHash: string | null = null;
      let promptHash: string | null = null;
      let evaluatorPromptHash: string | null = null;

      if (record.anchorId && record.segmentId) {
        const anchorResults =
          await anchoringRepository.getResultsByVersion(
            record.documentVersionId,
          );
        const anchor = anchorResults.find(
          (a) => a.anchorId === record.anchorId,
        );
        if (anchor?.result.anchored) {
          quotedSpan = {
            text: record.quotedText ?? anchor.quotedText,
            normalizedStart: anchor.result.normalizedStart,
            normalizedEnd: anchor.result.normalizedEnd,
            originalStart: anchor.result.originalStart,
            originalEnd: anchor.result.originalEnd,
          };
          anchoringMethod = anchor.result.method;
        }

        const grammarResults =
          await grammarRepository.getResultsByVersion(
            record.documentVersionId,
          );
        const grammar = grammarResults.find(
          (g) => g.anchorId === record.anchorId,
        );
        if (grammar?.result.parsed) {
          deterministicParseResult = {
            expression: grammar.result
              .expression as unknown as Record<string, unknown>,
            kind: grammar.result.expression.kind,
          };
        }

        const modelCalls = await extractionRepository.getCallsByVersion(
          record.documentVersionId,
        );
        const segmentCall = modelCalls.find(
          (c) => c.segmentId === record.segmentId,
        );
        if (segmentCall) {
          modelHash = segmentCall.modelId;
          promptHash = segmentCall.promptHash;
        }

        evaluatorPromptHash =
          await reviewRepository.getEvaluatorPromptHash(
            record.documentVersionId,
          );
      }

      return {
        recordId: record.recordId,
        recordVersionId: record.recordVersionId,
        documentHash: version.contentHash,
        legalIdentity: version.legalIdentity,
        legislativeStatus: version.legislativeStatus,
        segmentId: (record.segmentId as SegmentId) ?? null,
        quotedSpan,
        anchoringMethod,
        deterministicParseResult,
        packVersion: record.packVersion,
        ruleIds: record.ruleIds,
        citations: record.citations,
        modelHash,
        promptHash,
        evaluatorPromptHash,
        dateProvenance: record.dateProvenance,
        reviewerId: event.reviewerId,
        reviewTimestamp: event.createdAt,
        reviewAction: event.action,
        reviewDiff: event.diff,
      };
    },
  };

  // ── Private helpers ────────────────────────────────────────

  async function deriveProposals(
    analysisId: AnalysisId,
    documentVersionId: DocumentVersionId,
  ): Promise<void> {
    const [
      anchorResults,
      evaluations,
      grammarResults,
      resolutionResults,
      assignments,
    ] = await Promise.all([
      anchoringRepository.getResultsByVersion(documentVersionId),
      evaluationRepository.getResultsByVersion(documentVersionId),
      grammarRepository.getResultsByVersion(documentVersionId),
      resolverRepository.getResultsByVersion(documentVersionId),
      routingRepository.getAssignmentsByVersion(documentVersionId),
    ]);

    const anchorMap = new Map<string, ProposalAnchorResult>(
      anchorResults.map((a) => [a.anchorId, a]),
    );
    const grammarMap = new Map<string, SpanParseResult>(
      grammarResults.map((g) => [g.anchorId, g]),
    );
    const resolutionMap = new Map<string, AnchoredResolution>(
      resolutionResults.map((r) => [r.anchorId, r]),
    );
    const assignmentMap = new Map<string, LaneAssignment>(
      assignments.map((a) => [a.anchorId, a]),
    );

    const proposalRows: ProposalInsert[] = [];

    for (const evaluation of evaluations) {
      const anchor = anchorMap.get(evaluation.anchorId);
      if (!anchor || !anchor.result.anchored) continue;

      const grammar = grammarMap.get(evaluation.anchorId);
      const resolution = resolutionMap.get(evaluation.anchorId);
      const assignment = assignmentMap.get(evaluation.anchorId);

      const anchoredResult = anchor.result;

      proposalRows.push({
        analysisId: analysisId as string,
        documentVersionId: documentVersionId as string,
        anchorId: anchor.anchorId as string,
        segmentId: anchor.segmentId as string,
        quotedText: anchor.quotedText,
        kind: anchor.kind,
        normalizedStart: anchoredResult.normalizedStart,
        normalizedEnd: anchoredResult.normalizedEnd,
        originalStart: anchoredResult.originalStart,
        originalEnd: anchoredResult.originalEnd,
        anchoringMethod: anchoredResult.method,
        parsedExpression:
          grammar?.result.parsed
            ? (grammar.result.expression as unknown as Record<
                string,
                unknown
              >)
            : null,
        resolved: resolution?.result.resolved ?? false,
        statutoryDate:
          resolution?.result.resolved
            ? resolution.result.statutoryDate
            : null,
        adjustedDate:
          resolution?.result.resolved
            ? resolution.result.adjustedDate
            : null,
        ruleIds:
          resolution?.result.resolved
            ? (resolution.result.ruleIds as string[])
            : [],
        citations:
          resolution?.result.resolved
            ? (resolution.result.citations as string[])
            : [],
        packVersion:
          resolution?.result.resolved
            ? resolution.result.packVersion
            : null,
        supportLevel: evaluation.supportLevel,
        lane: assignment?.lane ?? "blocked",
        laneReasons: assignment?.reasons ?? [],
      });
    }

    if (proposalRows.length > 0) {
      await reviewRepository.insertProposals(proposalRows);
    }

    logger.info(
      {
        analysisId,
        documentVersionId,
        proposalCount: proposalRows.length,
      },
      "proposals derived from pipeline results",
    );
  }

  async function handleAccept(
    proposal: ReviewProposal,
    input: ReviewDecisionInput,
  ): Promise<{ event: ReviewEvent; records: RegisterRecord[] }> {
    // INV: unsupported material fields cannot be approved
    if (proposal.supportLevel === "unsupported") {
      throw new AppError({
        code: "UNSUPPORTED_CANNOT_ACCEPT",
        category: "user_input",
        message:
          "Cannot accept a proposal with unsupported evidence. Use edit_and_accept to provide corrections, or reject.",
        retryable: false,
        context: {
          proposalId: proposal.proposalId,
          supportLevel: proposal.supportLevel,
        },
      });
    }

    const computed = buildComputedDateFields(proposal);

    const before = proposalSnapshot(proposal);
    const after = { ...before };

    const event = await reviewRepository.insertReviewEvent({
      proposalId: proposal.proposalId,
      action: "accept",
      reviewerId: input.reviewerId,
      beforeValues: before,
      afterValues: after,
      diff: [],
      idempotencyKey: input.idempotencyKey,
    });

    const record = await reviewRepository.insertRegisterRecord({
      recordVersionId: randomUUID(),
      proposalId: proposal.proposalId,
      reviewEventId: event.eventId,
      documentVersionId: proposal.documentVersionId,
      anchorId: proposal.anchorId,
      segmentId: proposal.segmentId,
      quotedText: proposal.quotedText,
      kind: proposal.kind,
      deadlineDate: computed.deadlineDate,
      adjustedDate: computed.adjustedDate,
      ruleIds: computed.ruleIds,
      citations: computed.citations,
      packVersion: computed.packVersion,
      deliverable: null,
      actor: null,
      conditions: null,
      dateProvenance: computed.dateProvenance,
      splitFromRecordId: null,
    });

    await reviewRepository.updateProposalStatus(
      proposal.proposalId,
      "accepted",
    );

    logger.info(
      {
        proposalId: proposal.proposalId,
        recordId: record.recordId,
        reviewerId: input.reviewerId,
      },
      "proposal accepted",
    );

    return { event, records: [record] };
  }

  async function handleEditAndAccept(
    proposal: ReviewProposal,
    input: ReviewDecisionInput,
  ): Promise<{ event: ReviewEvent; records: RegisterRecord[] }> {
    if (!input.edits) {
      throw new AppError({
        code: "EDITS_REQUIRED",
        category: "user_input",
        message: "edit_and_accept requires edits object",
        retryable: false,
        context: { proposalId: proposal.proposalId },
      });
    }

    const edits = input.edits;
    const deadlineDate =
      (edits.deadlineDate as string) ??
      proposal.statutoryDate ??
      proposal.adjustedDate;
    const adjustedDate =
      (edits.adjustedDate as string) ?? deadlineDate;

    if (!deadlineDate) {
      throw new AppError({
        code: "DEADLINE_REQUIRED",
        category: "user_input",
        message:
          "edit_and_accept on unresolved proposal requires deadlineDate in edits",
        retryable: false,
        context: { proposalId: proposal.proposalId },
      });
    }

    const dateIsReviewerAsserted =
      !proposal.resolved ||
      (edits.deadlineDate !== undefined &&
        edits.deadlineDate !== proposal.statutoryDate);

    let dateFields: ComputedDateFields | ReviewerAssertedDateFields;
    if (dateIsReviewerAsserted) {
      const reason = !proposal.resolved
        ? buildResolverFailureReason(proposal)
        : `reviewer overrode statutory date ${proposal.statutoryDate}`;
      dateFields = buildReviewerAssertedDateFields(
        input.reviewerId,
        deadlineDate,
        adjustedDate,
        reason,
        (edits.citations as string[]) ?? (proposal.citations as string[]),
      );
    } else {
      dateFields = buildComputedDateFields(proposal);
    }

    const before = proposalSnapshot(proposal);
    const after = {
      ...before,
      deadlineDate: dateFields.deadlineDate,
      adjustedDate: dateFields.adjustedDate,
      dateProvenance: dateFields.dateProvenance,
      deliverable: edits.deliverable ?? before.deliverable,
      actor: edits.actor ?? before.actor,
      conditions: edits.conditions ?? before.conditions,
      ruleIds: edits.ruleIds ?? before.ruleIds,
      citations: dateFields.citations,
    };

    const diff = computeDiff(before, after);

    const event = await reviewRepository.insertReviewEvent({
      proposalId: proposal.proposalId,
      action: "edit_and_accept",
      reviewerId: input.reviewerId,
      beforeValues: before,
      afterValues: after,
      diff,
      idempotencyKey: input.idempotencyKey,
    });

    const record = await reviewRepository.insertRegisterRecord({
      recordVersionId: randomUUID(),
      proposalId: proposal.proposalId,
      reviewEventId: event.eventId,
      documentVersionId: proposal.documentVersionId,
      anchorId: proposal.anchorId,
      segmentId: proposal.segmentId,
      quotedText: proposal.quotedText,
      kind: proposal.kind,
      deadlineDate: dateFields.deadlineDate,
      adjustedDate: dateFields.adjustedDate,
      ruleIds: (edits.ruleIds as string[]) ??
        (proposal.ruleIds as string[]),
      citations: dateFields.citations,
      packVersion: proposal.packVersion,
      deliverable: (edits.deliverable as string) ?? null,
      actor: (edits.actor as string) ?? null,
      conditions: (edits.conditions as string) ?? null,
      dateProvenance: dateFields.dateProvenance,
      splitFromRecordId: null,
    });

    await reviewRepository.updateProposalStatus(
      proposal.proposalId,
      "accepted",
    );

    logger.info(
      {
        proposalId: proposal.proposalId,
        recordId: record.recordId,
        reviewerId: input.reviewerId,
        fieldsEdited: diff.map((d) => d.field),
      },
      "proposal edited and accepted",
    );

    return { event, records: [record] };
  }

  async function handleReject(
    proposal: ReviewProposal,
    input: ReviewDecisionInput,
  ): Promise<{ event: ReviewEvent; records: RegisterRecord[] }> {
    const before = proposalSnapshot(proposal);

    const event = await reviewRepository.insertReviewEvent({
      proposalId: proposal.proposalId,
      action: "reject",
      reviewerId: input.reviewerId,
      beforeValues: before,
      afterValues: { rejected: true, reason: input.edits?.reason ?? null },
      diff: [],
      idempotencyKey: input.idempotencyKey,
    });

    await reviewRepository.updateProposalStatus(
      proposal.proposalId,
      "rejected",
    );

    logger.info(
      {
        proposalId: proposal.proposalId,
        reviewerId: input.reviewerId,
      },
      "proposal rejected",
    );

    return { event, records: [] };
  }

  async function handleSplit(
    proposal: ReviewProposal,
    input: ReviewDecisionInput,
  ): Promise<{ event: ReviewEvent; records: RegisterRecord[] }> {
    if (
      !input.splitRecords ||
      input.splitRecords.length < 2
    ) {
      throw new AppError({
        code: "SPLIT_REQUIRES_RECORDS",
        category: "user_input",
        message: "split requires at least 2 splitRecords",
        retryable: false,
        context: { proposalId: proposal.proposalId },
      });
    }

    const before = proposalSnapshot(proposal);
    const after = {
      splitInto: input.splitRecords.length,
      records: input.splitRecords,
    };

    const event = await reviewRepository.insertReviewEvent({
      proposalId: proposal.proposalId,
      action: "split",
      reviewerId: input.reviewerId,
      beforeValues: before,
      afterValues: after as unknown as Record<string, unknown>,
      diff: [
        {
          field: "split",
          before: 1,
          after: input.splitRecords.length,
        },
      ],
      idempotencyKey: input.idempotencyKey,
    });

    const records: RegisterRecord[] = [];
    const firstRecordId = randomUUID();

    for (let i = 0; i < input.splitRecords.length; i++) {
      const sr = input.splitRecords[i]!;
      const splitDateFields = buildReviewerAssertedDateFields(
        input.reviewerId,
        sr.deadlineDate,
        sr.adjustedDate,
        "split from proposal — reviewer supplied individual dates",
        sr.citations ?? (proposal.citations as string[]),
      );

      const record = await reviewRepository.insertRegisterRecord({
        recordVersionId: randomUUID(),
        proposalId: proposal.proposalId,
        reviewEventId: event.eventId,
        documentVersionId: proposal.documentVersionId,
        anchorId: proposal.anchorId,
        segmentId: proposal.segmentId,
        quotedText: proposal.quotedText,
        kind: sr.kind,
        deadlineDate: splitDateFields.deadlineDate,
        adjustedDate: splitDateFields.adjustedDate,
        ruleIds: sr.ruleIds ?? (proposal.ruleIds as string[]),
        citations: splitDateFields.citations,
        packVersion: proposal.packVersion,
        deliverable: sr.deliverable ?? null,
        actor: sr.actor ?? null,
        conditions: sr.conditions ?? null,
        dateProvenance: splitDateFields.dateProvenance,
        splitFromRecordId: i > 0 ? firstRecordId : null,
      });
      records.push(record);
    }

    await reviewRepository.updateProposalStatus(
      proposal.proposalId,
      "split",
    );

    logger.info(
      {
        proposalId: proposal.proposalId,
        recordCount: records.length,
        reviewerId: input.reviewerId,
      },
      "proposal split into multiple records",
    );

    return { event, records };
  }
}

export type ReviewService = ReturnType<typeof createReviewService>;
