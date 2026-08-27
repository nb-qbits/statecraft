import type { ObjectStorage } from "../../platform/storage/storage.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId } from "../shared/types.js";
import type { SourceSegment, ParseResult } from "./types.js";
import { AppError } from "../shared/errors.js";
import { normalizeForEvidenceMatchV1 } from "./normalize.js";
import { computeSegmentId, computeContentHash, assignOrdinals } from "./segment-identity.js";
import type { DocumentParser } from "./types.js";

type AsyncParserFn = {
  (bytes: Buffer): Promise<import("./types.js").ParseResult>;
  parserVersion: string;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

export interface ParsingServiceDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  storage: ObjectStorage;
  plainTextParser: DocumentParser;
  parseDocx: AsyncParserFn;
  parsePdf: AsyncParserFn;
  logger: Logger;
}

export function createParsingService(deps: ParsingServiceDeps) {
  const {
    ingestionRepository,
    parsingRepository,
    storage,
    plainTextParser,
    parseDocx,
    parsePdf,
    logger,
  } = deps;

  return {
    async parseDocument(documentVersionId: DocumentVersionId): Promise<SourceSegment[]> {
      const version = await ingestionRepository.getVersion(documentVersionId);
      if (!version) {
        throw new AppError({
          code: "DOCUMENT_NOT_FOUND",
          category: "user_input",
          message: `Document version ${documentVersionId} not found`,
          retryable: false,
          context: { documentVersionId },
        });
      }

      if (version.parseStatus === "parsed") {
        const currentParserVersion = version.mimeType === DOCX_MIME
          ? parseDocx.parserVersion
          : version.mimeType === PDF_MIME
            ? parsePdf.parserVersion
            : plainTextParser.version;
        const existing = await parsingRepository.getSegmentsByVersion(documentVersionId);
        if (existing.length > 0 && existing[0]!.parserVersion === currentParserVersion) {
          logger.info({ documentVersionId }, "already parsed, returning existing segments");
          return existing;
        }
        logger.info(
          { documentVersionId, storedVersion: existing[0]?.parserVersion, currentVersion: currentParserVersion },
          "parser version changed, re-parsing",
        );
        await parsingRepository.deleteSegmentsByVersion(documentVersionId);
        await parsingRepository.updateParseStatus(documentVersionId, "unparsed");
      }

      if (version.parseStatus === "parse_failed") {
        throw new AppError({
          code: "PARSE_ALREADY_FAILED",
          category: "user_input",
          message: `Document version ${documentVersionId} previously failed parsing. Manual intervention required.`,
          retryable: false,
          context: { documentVersionId },
        });
      }

      const storageKey = `documents/${version.contentHash}`;
      const bytes = await storage.get(storageKey);

      let parseResult: ParseResult;

      if (version.mimeType === DOCX_MIME) {
        parseResult = await parseDocx(bytes);
      } else if (version.mimeType === PDF_MIME) {
        parseResult = await parsePdf(bytes);
      } else {
        parseResult = plainTextParser.parse(bytes, version.mimeType);
      }

      if (!parseResult.ok) {
        await parsingRepository.updateParseStatus(documentVersionId, "parse_failed");
        throw new AppError({
          code: "PARSE_FAILED",
          category: "unsupported_document",
          message: `Parsing failed: ${parseResult.reason}`,
          retryable: false,
          context: {
            documentVersionId,
            adapter: parseResult.parserAdapter,
            version: parseResult.parserVersion,
            reason: parseResult.reason,
          },
        });
      }

      const groups = parseResult.paragraphs.map((p) => {
        const rawText = p.runs.map(r => r.text).join("");
        const contentHash = computeContentHash(rawText);
        return {
          structuralPath: p.structuralPath,
          contentHash,
          rawText,
          runs: p.runs,
        };
      });

      const ordinals = assignOrdinals(
        groups.map(g => ({
          structuralPath: g.structuralPath,
          contentHash: g.contentHash,
        })),
      );

      const segments: SourceSegment[] = groups.map((g, i) => {
        const { normalized, offsetMap } = normalizeForEvidenceMatchV1(g.rawText);
        return {
          segmentId: computeSegmentId(
            documentVersionId,
            g.structuralPath,
            g.contentHash,
            ordinals[i]!,
          ),
          documentVersionId,
          structuralPath: g.structuralPath,
          ordinal: ordinals[i]!,
          rawText: g.rawText,
          normalizedText: normalized,
          contentHash: g.contentHash,
          offsetMap,
          parserAdapter: parseResult.parserAdapter,
          parserVersion: parseResult.parserVersion,
          fidelity: parseResult.fidelity,
        };
      });

      await parsingRepository.insertSegments(segments);
      if (parseResult.nonBodyContent && parseResult.nonBodyContent.length > 0) {
        await parsingRepository.storeNonBodyContent(documentVersionId, parseResult.nonBodyContent);
      }
      await parsingRepository.updateParseStatus(documentVersionId, "parsed");

      if (parseResult.warnings && parseResult.warnings.length > 0) {
        logger.warn(
          {
            documentVersionId,
            warnings: parseResult.warnings,
          },
          "parser reconciliation warnings",
        );
      }

      logger.info(
        {
          documentVersionId,
          segmentCount: segments.length,
          adapter: parseResult.parserAdapter,
          fidelity: parseResult.fidelity,
        },
        "document parsed successfully",
      );

      return segments;
    },
  };
}
