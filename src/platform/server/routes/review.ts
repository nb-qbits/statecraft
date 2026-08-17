import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type {
  DocumentVersionId,
  ProposalId,
  RegisterRecordId,
  AnchorId,
} from "../../../modules/shared/types.js";
import type { ReviewService } from "../../../modules/review/service.js";
import type { ReviewRepository } from "../../db/review-repository.js";
import type {
  ReviewAction,
  SplitRecordInput,
} from "../../../modules/review/types.js";

function handleError(
  err: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  logger: Logger,
): unknown {
  if (err instanceof AppError) {
    let status: number;
    switch (err.category) {
      case "user_input":
        status =
          err.code === "DOCUMENT_NOT_FOUND" ||
          err.code === "PROPOSAL_NOT_FOUND" ||
          err.code === "RECORD_NOT_FOUND"
            ? 404
            : err.code === "SUPERSEDED_PROPOSAL"
              ? 409
              : 400;
        break;
      case "provider_failure":
        status = 502;
        break;
      default:
        status = 500;
    }
    logger.warn({ err: err.toJSON() }, "review operation failed");
    return reply.status(status).send({ error: err.toJSON() });
  }
  logger.error({ err }, "unexpected review error");
  return reply.status(500).send({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
}

export function registerReviewRoutes(
  app: FastifyInstance,
  reviewService: ReviewService,
  reviewRepository: ReviewRepository,
  logger: Logger,
): void {
  // ── POST /api/v1/projects ────────────────────────────────

  app.post<{
    Body: { name: string; description?: string };
  }>("/api/v1/projects", async (req, reply) => {
    const idempotencyKey = req.headers["idempotency-key"] as
      | string
      | undefined;
    if (idempotencyKey) {
      const cached =
        await reviewRepository.getIdempotencyResponse(idempotencyKey);
      if (cached) {
        return reply.status(cached.status).send(cached.body);
      }
    }

    try {
      const { name, description } = req.body ?? {};
      if (!name) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", message: "name required" } });
      }

      const project = await reviewService.createProject(
        name,
        description ?? null,
      );

      const body = { project };
      if (idempotencyKey) {
        await reviewRepository.setIdempotencyResponse(
          idempotencyKey,
          "POST /api/v1/projects",
          201,
          body,
        );
      }
      return reply.status(201).send(body);
    } catch (err) {
      return handleError(err, reply, logger);
    }
  });

  // ── POST /api/v1/documents/:dvId/analyse ─────────────────

  app.post<{
    Params: { documentVersionId: string };
  }>(
    "/api/v1/documents/:documentVersionId/analyse",
    async (req, reply) => {
      const { documentVersionId } = req.params;
      const idempotencyKey = req.headers["idempotency-key"] as
        | string
        | undefined;

      if (idempotencyKey) {
        const cached =
          await reviewRepository.getIdempotencyResponse(idempotencyKey);
        if (cached) {
          return reply.status(cached.status).send(cached.body);
        }
      }

      try {
        const analysis = await reviewService.startAnalysis(
          documentVersionId as DocumentVersionId,
        );

        const body = { analysis };
        if (idempotencyKey) {
          await reviewRepository.setIdempotencyResponse(
            idempotencyKey,
            `POST /api/v1/documents/${documentVersionId}/analyse`,
            200,
            body,
          );
        }
        return reply.status(200).send(body);
      } catch (err) {
        return handleError(err, reply, logger);
      }
    },
  );

  // ── GET /api/v1/documents/:dvId/analysis/status ──────────

  app.get<{
    Params: { documentVersionId: string };
  }>(
    "/api/v1/documents/:documentVersionId/analysis/status",
    async (req, reply) => {
      const { documentVersionId } = req.params;
      try {
        const analysis = await reviewService.getAnalysisStatus(
          documentVersionId as DocumentVersionId,
        );
        if (!analysis) {
          return reply.status(404).send({
            error: {
              code: "ANALYSIS_NOT_FOUND",
              message: "No analysis found for this document version",
            },
          });
        }
        return reply.status(200).send({ analysis });
      } catch (err) {
        return handleError(err, reply, logger);
      }
    },
  );

  // ── GET /api/v1/documents/:dvId/proposals ────────────────

  app.get<{
    Params: { documentVersionId: string };
  }>(
    "/api/v1/documents/:documentVersionId/proposals",
    async (req, reply) => {
      const { documentVersionId } = req.params;
      try {
        const proposals = await reviewService.getProposals(
          documentVersionId as DocumentVersionId,
        );
        return reply.status(200).send({
          documentVersionId,
          totalProposals: proposals.length,
          proposals,
        });
      } catch (err) {
        return handleError(err, reply, logger);
      }
    },
  );

  // ── POST /api/v1/proposals/:proposalId/review ────────────

  app.post<{
    Params: { proposalId: string };
    Body: {
      action: ReviewAction;
      reviewerId: string;
      edits?: Record<string, unknown>;
      splitRecords?: SplitRecordInput[];
    };
  }>("/api/v1/proposals/:proposalId/review", async (req, reply) => {
    const { proposalId } = req.params;
    const idempotencyKey = req.headers["idempotency-key"] as
      | string
      | undefined;

    if (!idempotencyKey) {
      return reply.status(400).send({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Idempotency-Key header is required for review submissions",
        },
      });
    }

    const cached =
      await reviewRepository.getIdempotencyResponse(idempotencyKey);
    if (cached) {
      return reply.status(cached.status).send(cached.body);
    }

    try {
      const { action, reviewerId, edits, splitRecords } = req.body ?? {};
      if (!action || !reviewerId) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "action and reviewerId are required",
          },
        });
      }

      const input: Parameters<typeof reviewService.submitReview>[1] = {
        action,
        reviewerId,
        idempotencyKey,
      };
      if (edits !== undefined) {
        (input as unknown as Record<string, unknown>).edits = edits;
      }
      if (splitRecords !== undefined) {
        (input as unknown as Record<string, unknown>).splitRecords =
          splitRecords;
      }

      const result = await reviewService.submitReview(
        proposalId as ProposalId,
        input,
      );

      const body = {
        event: result.event,
        records: result.records,
      };

      await reviewRepository.setIdempotencyResponse(
        idempotencyKey,
        `POST /api/v1/proposals/${proposalId}/review`,
        200,
        body,
      );

      return reply.status(200).send(body);
    } catch (err) {
      return handleError(err, reply, logger);
    }
  });

  // ── POST /api/v1/documents/:dvId/anchors/:anchorId/review ─

  app.post<{
    Params: { documentVersionId: string; anchorId: string };
    Body: {
      action: ReviewAction;
      reviewerId: string;
      edits?: Record<string, unknown>;
      splitRecords?: SplitRecordInput[];
    };
  }>(
    "/api/v1/documents/:documentVersionId/anchors/:anchorId/review",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;
      const anchorId = req.params.anchorId as AnchorId;
      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

      if (!idempotencyKey) {
        return reply.status(400).send({
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Idempotency-Key header is required for review submissions",
          },
        });
      }

      const cached = await reviewRepository.getIdempotencyResponse(idempotencyKey);
      if (cached) {
        return reply.status(cached.status).send(cached.body);
      }

      try {
        const proposal = await reviewRepository.getLatestProposalByAnchor(dvId, anchorId);
        if (!proposal) {
          return reply.status(404).send({
            error: {
              code: "PROPOSAL_NOT_FOUND",
              message: `No proposal found for anchor ${anchorId} in document ${dvId}`,
            },
          });
        }

        const { action, reviewerId, edits, splitRecords } = req.body ?? {};
        if (!action || !reviewerId) {
          return reply.status(400).send({
            error: { code: "INVALID_INPUT", message: "action and reviewerId are required" },
          });
        }

        const input: Parameters<typeof reviewService.submitReview>[1] = {
          action,
          reviewerId,
          idempotencyKey,
        };
        if (edits !== undefined) {
          (input as unknown as Record<string, unknown>).edits = edits;
        }
        if (splitRecords !== undefined) {
          (input as unknown as Record<string, unknown>).splitRecords = splitRecords;
        }

        const result = await reviewService.submitReview(
          proposal.proposalId as ProposalId,
          input,
        );

        const body = { event: result.event, records: result.records };

        await reviewRepository.setIdempotencyResponse(
          idempotencyKey,
          `POST /api/v1/documents/${dvId}/anchors/${anchorId}/review`,
          200,
          body,
        );

        return reply.status(200).send(body);
      } catch (err) {
        return handleError(err, reply, logger);
      }
    },
  );

  // ── POST /api/v1/documents/:dvId/records ─────────────────

  app.post<{
    Params: { documentVersionId: string };
    Body: {
      reviewerId: string;
      deadlineDate: string;
      adjustedDate: string;
      kind: string;
      deliverable?: string;
      actor?: string;
      conditions?: string;
      ruleIds?: string[];
      citations?: string[];
      packVersion?: string;
    };
  }>(
    "/api/v1/documents/:documentVersionId/records",
    async (req, reply) => {
      const { documentVersionId } = req.params;
      const idempotencyKey = req.headers["idempotency-key"] as
        | string
        | undefined;

      if (!idempotencyKey) {
        return reply.status(400).send({
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Idempotency-Key header is required for manual records",
          },
        });
      }

      const cached =
        await reviewRepository.getIdempotencyResponse(idempotencyKey);
      if (cached) {
        return reply.status(cached.status).send(cached.body);
      }

      try {
        const { reviewerId, deadlineDate, adjustedDate, kind, ...rest } =
          req.body ?? {};
        if (!reviewerId || !deadlineDate || !adjustedDate || !kind) {
          return reply.status(400).send({
            error: {
              code: "INVALID_INPUT",
              message:
                "reviewerId, deadlineDate, adjustedDate, and kind are required",
            },
          });
        }

        const result = await reviewService.addManualRecord(
          documentVersionId as DocumentVersionId,
          {
            reviewerId,
            idempotencyKey,
            deadlineDate,
            adjustedDate,
            kind,
            ...rest,
          },
        );

        const body = { event: result.event, record: result.record };

        await reviewRepository.setIdempotencyResponse(
          idempotencyKey,
          `POST /api/v1/documents/${documentVersionId}/records`,
          201,
          body,
        );

        return reply.status(201).send(body);
      } catch (err) {
        return handleError(err, reply, logger);
      }
    },
  );

  // ── GET /api/v1/register ─────────────────────────────────

  app.get("/api/v1/register", async (_req, reply) => {
    try {
      const records = await reviewService.getRegister();
      return reply.status(200).send({
        totalRecords: records.length,
        records,
      });
    } catch (err) {
      return handleError(err, reply, logger);
    }
  });

  // ── GET /api/v1/register/:recordId ───────────────────────

  app.get<{
    Params: { recordId: string };
  }>("/api/v1/register/:recordId", async (req, reply) => {
    const { recordId } = req.params;
    try {
      const record = await reviewService.getRecord(
        recordId as RegisterRecordId,
      );
      if (!record) {
        return reply.status(404).send({
          error: { code: "RECORD_NOT_FOUND", message: "Record not found" },
        });
      }
      return reply.status(200).send({ record });
    } catch (err) {
      return handleError(err, reply, logger);
    }
  });

  // ── GET /api/v1/register/:recordId/provenance ────────────

  app.get<{
    Params: { recordId: string };
  }>("/api/v1/register/:recordId/provenance", async (req, reply) => {
    const { recordId } = req.params;
    try {
      const provenance = await reviewService.getProvenance(
        recordId as RegisterRecordId,
      );
      return reply.status(200).send({ provenance });
    } catch (err) {
      return handleError(err, reply, logger);
    }
  });
}
