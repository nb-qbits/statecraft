import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { resolve, RESOLVER_VERSION } from "./resolve.js";
import { extractEnactmentDate, enactmentDateToInput } from "./enactment-date.js";
import { tryLoadPack } from "../jurisdiction/pack-loader.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type {
  AnchoredResolution,
  DerivedEffectiveDate,
  ParsedAnchoredExpression,
  ResolutionInput,
  ResolutionResult,
} from "./types.js";
import type { TemporalExpression, CapDate, CapDateRef } from "../grammar/types.js";
import type { SessionMetadata } from "../jurisdiction/types.js";
import type { SourceSegment } from "../parsing/types.js";
import { buildSectionIndex } from "../section-index/build-index.js";
import type { SectionIndex } from "../section-index/types.js";
import type { Jurisdiction } from "../section-index/types.js";
import {
  REFUSAL_CYCLE_DETECTED,
  REFUSAL_BROKEN_CROSS_REFERENCE,
  REFUSAL_NONEXISTENT_TRIGGER,
  TRANSITIVE_BOUND,
} from "../shared/rule-registry.js";

export { RESOLVER_VERSION };

export interface ResolverServiceDeps {
  ingestionRepository: IngestionRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  parsingRepository: ParsingRepository;
  logger: Logger;
}

export interface DocumentResolutionResult {
  readonly documentVersionId: DocumentVersionId;
  readonly resolverVersion: string;
  readonly results: readonly AnchoredResolution[];
  readonly totalExpressions: number;
  readonly totalResolved: number;
  readonly totalUnresolved: number;
}

export function createResolverService(deps: ResolverServiceDeps) {
  const {
    ingestionRepository,
    grammarRepository,
    resolverRepository,
    parsingRepository,
    logger,
  } = deps;

  return {
    async resolveDocument(
      documentVersionId: DocumentVersionId,
      externalInputs: readonly ResolutionInput[] = [],
    ): Promise<DocumentResolutionResult> {
      let suppliedInputs: readonly ResolutionInput[] = externalInputs;
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

      if (version.grammarStatus !== "parsed_grammar") {
        throw new AppError({
          code: "DOCUMENT_NOT_PARSED_GRAMMAR",
          category: "user_input",
          message: `Document version ${documentVersionId} has not had grammar parsed yet (status: ${version.grammarStatus})`,
          retryable: false,
          context: { documentVersionId, grammarStatus: version.grammarStatus },
        });
      }

      if (version.resolutionStatus === "resolved_resolver") {
        await resolverRepository.deleteResultsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "clearing previous resolution results before re-resolving",
        );
      }

      const grammarResults =
        await grammarRepository.getResultsByVersion(documentVersionId);

      const parsedOnly = grammarResults.filter((r) => r.result.parsed);

      const jurisdiction = version.legalIdentity.jurisdiction;
      const pack = tryLoadPack(jurisdiction, "1");

      if (pack.packVersion.startsWith("default/")) {
        logger.info(
          { documentVersionId, jurisdiction },
          "using default pack — dates will be estimated, not jurisdiction-verified",
        );
      }

      const segments = await parsingRepository.getSegmentsByVersion(documentVersionId);
      const segmentTexts = segments.map(s => s.rawText);
      const enactmentResult = extractEnactmentDate(segmentTexts);
      if (enactmentResult.found) {
        const enactmentInput = enactmentDateToInput(enactmentResult);
        suppliedInputs = [...suppliedInputs, enactmentInput];
        logger.info(
          { documentVersionId, enactmentDate: enactmentResult.date },
          "extracted enactment date from document text",
        );
      }

      let derivedEffectiveDate: DerivedEffectiveDate | undefined;
      const sessionRecord = pack.getSessionMetadata(version.legalIdentity.session);
      if (sessionRecord) {
        const sessionMeta: SessionMetadata = {
          sessionType: sessionRecord.sessionType,
          adjournmentDate: sessionRecord.adjournmentDate,
          actType: "ordinary",
          specifiedDate: null,
          passageDate: null,
        };
        const edResult = pack.deriveEffectiveDate(sessionMeta);
        if (edResult.resolved) {
          derivedEffectiveDate = {
            date: edResult.date,
            ruleId: edResult.ruleId,
            citation: edResult.citation,
            sessionSource: sessionRecord.source,
          };
          logger.info(
            {
              documentVersionId,
              session: version.legalIdentity.session,
              effectiveDate: edResult.date,
              ruleId: edResult.ruleId,
            },
            "derived effective date from jurisdiction pack",
          );
        }
      }

      const sectionIndex = buildSectionIndex(segments, jurisdiction as Jurisdiction);
      const { order, cycles, edgesBySource } = buildDependencyGraph(parsedOnly, segments, sectionIndex);

      const resolvedResults = new Map<string, ResolutionResult>();
      const resolutions: AnchoredResolution[] = [];

      for (const anchorId of order) {
        const gr = parsedOnly.find((g) => g.anchorId === anchorId);
        if (!gr || !gr.result.parsed) continue;
        let expression = gr.result.expression as TemporalExpression;

        if (expression.kind === "relative_duration" && expression.capDate &&
            "yearSource" in expression.capDate) {
          const capRef = expression.capDate as CapDateRef;
          const depAnchorId = findDependencyAnchor(
            capRef.dependencyRef, parsedOnly, segments, sectionIndex, gr.segmentId as string,
          );
          if (depAnchorId) {
            const depResult = resolvedResults.get(depAnchorId as string);
            if (depResult && depResult.resolved && "statutoryDate" in depResult) {
              const depYear = parseInt(depResult.statutoryDate.slice(0, 4), 10);
              const capYear = depYear + capRef.yearOffset;
              const concreteCapDate: CapDate = {
                month: capRef.month,
                day: capRef.day,
                year: capYear,
                capKind: capRef.capKind,
              };
              expression = { ...expression, capDate: concreteCapDate };
            }
          }
        }

        const pae: ParsedAnchoredExpression = {
          anchorId: gr.anchorId,
          segmentId: gr.segmentId,
          text: gr.text,
          expression,
        };

        let result = resolve(pae, suppliedInputs, pack, derivedEffectiveDate);

        const myEdges = edgesBySource.get(anchorId) ?? [];
        const eventTextEdge = myEdges.find((e) => e.kind === "event_text_ref");

        if (!result.resolved && eventTextEdge && expression.kind === "relative_duration") {
          result = applyTransitiveBounding(
            result, expression, eventTextEdge, resolvedResults, parsedOnly, segments, sectionIndex,
          );
        }

        resolvedResults.set(gr.anchorId as string, result);

        resolutions.push({
          anchorId: gr.anchorId,
          segmentId: gr.segmentId,
          text: gr.text,
          expression: gr.result.expression as TemporalExpression,
          result,
        });
      }

      for (const anchorId of cycles) {
        const gr = parsedOnly.find((g) => g.anchorId === anchorId);
        if (!gr || !gr.result.parsed) continue;
        const expression = gr.result.expression as TemporalExpression;

        resolutions.push({
          anchorId: gr.anchorId,
          segmentId: gr.segmentId,
          text: gr.text,
          expression,
          result: {
            resolved: false,
            refusalKind: "cycle_detected" as const,
            reason: "this finding is part of a dependency cycle and cannot be resolved",
            ruleIds: [REFUSAL_CYCLE_DETECTED],
            citations: [],
            missingInputs: [],
            warnings: [],
            inputs: [...suppliedInputs],
          },
        });
      }

      await resolverRepository.insertResults(
        documentVersionId,
        resolutions,
        RESOLVER_VERSION,
      );
      await resolverRepository.updateResolutionStatus(
        documentVersionId,
        "resolved_resolver",
        RESOLVER_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalExpressions: resolutions.length,
          totalResolved: resolutions.filter((r) => r.result.resolved).length,
          totalUnresolved: resolutions.filter((r) => !r.result.resolved).length,
        },
        "resolution complete",
      );

      return buildResult(documentVersionId, resolutions);
    },
  };
}

function buildResult(
  documentVersionId: DocumentVersionId,
  results: readonly AnchoredResolution[],
): DocumentResolutionResult {
  return {
    documentVersionId,
    resolverVersion: RESOLVER_VERSION,
    results,
    totalExpressions: results.length,
    totalResolved: results.filter((r) => r.result.resolved).length,
    totalUnresolved: results.filter((r) => !r.result.resolved).length,
  };
}

interface DependencyEdge {
  readonly target: string;
  readonly kind: "cap_date_ref" | "event_text_ref";
  readonly ref: string;
}

interface TopologicalSortResult {
  order: string[];
  cycles: string[];
}

interface DependencyGraphResult {
  order: string[];
  cycles: string[];
  edgesBySource: Map<string, DependencyEdge[]>;
}

const EVENT_TEXT_REF_RE = /(?:under|pursuant to|described in|required (?:under|by))\s+(?:sub)?(?:section|paragraph)\s+((?:\([a-z\d]+\))+)/i;

export function extractSubsectionRef(text: string): string | null {
  const m = EVENT_TEXT_REF_RE.exec(text);
  return m ? m[1]! : null;
}

function buildDependencyGraph(
  grammarResults: readonly GrammarEntry[],
  segments: readonly SourceSegment[],
  sectionIndex: SectionIndex,
): DependencyGraphResult {
  const anchorIds = grammarResults
    .filter((g) => g.result.parsed)
    .map((g) => g.anchorId as string);

  const edges = new Map<string, string[]>();
  const edgesBySource = new Map<string, DependencyEdge[]>();
  for (const id of anchorIds) {
    edges.set(id, []);
    edgesBySource.set(id, []);
  }

  for (const gr of grammarResults) {
    if (!gr.result.parsed) continue;
    const expr = gr.result.expression;

    if (expr.kind === "relative_duration" && expr.capDate &&
        "yearSource" in expr.capDate) {
      const capRef = expr.capDate as CapDateRef;
      const dep = findDependencyAnchor(capRef.dependencyRef, grammarResults, segments, sectionIndex, gr.segmentId as string);
      if (dep) {
        const depList = edges.get(gr.anchorId as string) ?? [];
        depList.push(dep as string);
        edges.set(gr.anchorId as string, depList);
        const edgeList = edgesBySource.get(gr.anchorId as string) ?? [];
        edgeList.push({ target: dep as string, kind: "cap_date_ref", ref: capRef.dependencyRef });
        edgesBySource.set(gr.anchorId as string, edgeList);
      }
    }

    if (expr.kind === "relative_duration" && expr.referenceEventText) {
      const ref = extractSubsectionRef(expr.referenceEventText);
      if (ref) {
        const refParts: string[] = [];
        const re = /\(([a-z\d]+)\)/gi;
        let m;
        while ((m = re.exec(ref)) !== null) {
          refParts.push(m[1]!.toLowerCase());
        }
        if (refParts.length > 0) {
          const dep = findDependencyAnchor(ref, grammarResults, segments, sectionIndex, gr.segmentId as string);
          if (dep && dep !== gr.anchorId) {
            const depList = edges.get(gr.anchorId as string) ?? [];
            if (!depList.includes(dep as string)) {
              depList.push(dep as string);
              edges.set(gr.anchorId as string, depList);
            }
            const edgeList = edgesBySource.get(gr.anchorId as string) ?? [];
            edgeList.push({ target: dep as string, kind: "event_text_ref", ref });
            edgesBySource.set(gr.anchorId as string, edgeList);
          }
        }
      }
    }
  }

  const { order, cycles } = topologicalSort(anchorIds, edges);
  return { order, cycles, edgesBySource };
}

function incrementSubsectionLabel(label: string): string | null {
  if (/^\d+$/.test(label)) return String(parseInt(label, 10) + 1);
  if (/^[a-z]$/.test(label) && label !== "z") return String.fromCharCode(label.charCodeAt(0) + 1);
  return null;
}

function findNextSiblingOffset(
  sectionIndex: SectionIndex,
  segmentId: string,
  sectionNum: string,
  subsectionRef: string,
): number | null {
  const parts: string[] = [];
  const re = /\(([a-z\d]+)\)/gi;
  let m;
  while ((m = re.exec(subsectionRef)) !== null) {
    parts.push(m[1]!);
  }
  if (parts.length === 0) return null;

  for (let depth = parts.length - 1; depth >= 0; depth--) {
    const prefix = parts.slice(0, depth).map(p => `(${p})`).join("");
    const next = incrementSubsectionLabel(parts[depth]!);
    if (!next) continue;
    const sibCitation = `§ ${sectionNum}${prefix}(${next})`;
    const sibRanges = sectionIndex.getSegmentsForCitation(sibCitation);
    const sibRange = sibRanges.find(r => r.segmentId === segmentId);
    if (sibRange) return sibRange.startOffset;
  }

  return null;
}

function detectCrossReferenceIssue(
  referenceEventText: string,
  depAnchorId: string,
  grammarResults: readonly GrammarEntry[],
  segments: readonly SourceSegment[],
  sectionIndex: SectionIndex,
  subsectionRef: string,
): "broken_cross_reference" | "nonexistent_trigger" | null {
  if (/\b(second|third|fourth|each|every)\b/i.test(referenceEventText)) {
    return "nonexistent_trigger";
  }

  const depGr = grammarResults.find((g) => g.anchorId === depAnchorId);
  if (!depGr) return null;

  const seg = segments.find((s) => (s.segmentId as string) === (depGr.segmentId as string));
  if (!seg) return null;

  const sectionNum = sectionIndex.getSectionForSegment(depGr.segmentId as string);
  const targetCitation = sectionNum ? `§ ${sectionNum}${subsectionRef}` : null;
  const ranges = targetCitation ? sectionIndex.getSegmentsForCitation(targetCitation) : [];
  const targetRange = ranges.find(r => r.segmentId === (depGr.segmentId as string));

  let checkText: string;
  if (targetRange) {
    const inclusiveEnd = findNextSiblingOffset(
      sectionIndex, depGr.segmentId as string, sectionNum!, subsectionRef,
    );
    if (inclusiveEnd !== null) {
      checkText = seg.normalizedText.slice(targetRange.startOffset, inclusiveEnd);
    } else {
      checkText = seg.normalizedText.slice(targetRange.startOffset);
    }
  } else {
    checkText = seg.rawText;
  }

  const actorMatch = /\b(?:the\s+)((?:head|director|secretary|administrator|commissioner|chair(?:man|person)?)\s+(?:of\s+(?:an?\s+|each\s+|every\s+|the\s+|such\s+)?(?:agency|department|commission|bureau|office|board)))/i.exec(referenceEventText);
  if (actorMatch) {
    const actor = actorMatch[1]!.toLowerCase().replace(/\bof\s+(?:an?|each|every|the|such)\s+/i, "of ");
    const narrowedText = checkText.toLowerCase().replace(/\bof\s+(?:an?|each|every|the|such)\s+/gi, "of ");
    if (!narrowedText.includes(actor)) {
      return "broken_cross_reference";
    }
  }

  return null;
}

function computeTransitiveBound(
  depDate: string,
  quantity: number,
  unit: string,
): string {
  const d = new Date(depDate + "T00:00:00Z");
  if (unit === "months") {
    d.setUTCMonth(d.getUTCMonth() + quantity);
  } else if (unit === "years") {
    d.setUTCFullYear(d.getUTCFullYear() + quantity);
  } else {
    d.setUTCDate(d.getUTCDate() + quantity);
  }
  return d.toISOString().slice(0, 10);
}

function findSectionForAnchor(sectionIndex: SectionIndex, grammarResults: readonly GrammarEntry[], targetAnchorId: string): string | null {
  const gr = grammarResults.find((g) => (g.anchorId as string) === targetAnchorId);
  if (!gr) return null;
  return sectionIndex.getSectionForSegment(gr.segmentId as string);
}

function formatSubsectionLabel(ref: string, sectionNumber?: string | null): string {
  const parts = ref.replace(/^\(/, "(");
  return sectionNumber ? `§${sectionNumber}${parts}` : `§${parts}`;
}

function applyTransitiveBounding(
  baseResult: ResolutionResult,
  expression: {
    quantity: number;
    unit: string;
    referenceEventText?: string | null;
  },
  eventTextEdge: DependencyEdge,
  resolvedResults: Map<string, ResolutionResult>,
  grammarResults: readonly GrammarEntry[],
  segments: readonly SourceSegment[],
  sectionIndex: SectionIndex,
): ResolutionResult {
  if (baseResult.resolved) return baseResult;

  const depResult = resolvedResults.get(eventTextEdge.target);
  if (!depResult) return baseResult;

  const sectionNum = findSectionForAnchor(sectionIndex, grammarResults, eventTextEdge.target);
  const refLabel = formatSubsectionLabel(eventTextEdge.ref, sectionNum);
  const referenceEventText = expression.referenceEventText ?? "";

  const crossRefIssue = detectCrossReferenceIssue(
    referenceEventText, eventTextEdge.target, grammarResults, segments,
    sectionIndex, eventTextEdge.ref,
  );
  if (crossRefIssue) {
    const depGr = grammarResults.find((g) => (g.anchorId as string) === eventTextEdge.target);
    const depText = depGr?.text ?? eventTextEdge.ref;
    const crossRefRuleId = crossRefIssue === "broken_cross_reference"
      ? REFUSAL_BROKEN_CROSS_REFERENCE
      : REFUSAL_NONEXISTENT_TRIGGER;
    const explanation = crossRefIssue === "broken_cross_reference"
      ? `The described trigger references ${refLabel}, but the actor or action described does not match that subsection's content. The referenced subsection text: "${depText.slice(0, 120)}"`
      : `The trigger references a "${referenceEventText.match(/\b(second|third|fourth|each|every)\b/i)?.[0] ?? "repeated"}" occurrence under ${refLabel}, but that subsection requires only one`;
    return {
      resolved: false,
      refusalKind: crossRefIssue,
      reason: explanation,
      ruleIds: [crossRefRuleId],
      citations: [],
      missingInputs: baseResult.missingInputs as string[],
      warnings: baseResult.warnings as string[],
      inputs: baseResult.inputs as ResolutionInput[],
    };
  }

  let depDate: string | null = null;
  let depDepth = 0;
  let depLabel: string;

  if (depResult.resolved && "statutoryDate" in depResult) {
    depDate = depResult.statutoryDate;
    depLabel = `due ${depDate}`;
  } else if (!depResult.resolved && "bounded" in depResult && depResult.bounded) {
    depDate = depResult.upperBound;
    depDepth = (depResult.derivationDepth ?? 0);
    depLabel = `itself due on or before ${depDate}`;
  } else {
    return baseResult;
  }

  const bound = computeTransitiveBound(depDate, expression.quantity, expression.unit);

  const contingency = `Contingent on: the obligation under ${refLabel}, ${depLabel}. If filed later, this date moves with it.`;

  const baseRuleIds = "ruleIds" in baseResult ? [...baseResult.ruleIds as readonly string[]] : [];
  const baseCitations = "citations" in baseResult ? [...baseResult.citations as readonly string[]] : [];

  return {
    resolved: false,
    bounded: true,
    upperBound: bound,
    reason: `transitive bound: ${expression.quantity} ${expression.unit} after dependency under ${refLabel} (${depLabel}) — on or before ${bound}`,
    contingency,
    derivationDepth: depDepth + 1,
    ruleIds: [...baseRuleIds, TRANSITIVE_BOUND],
    citations: baseCitations,
    missingInputs: baseResult.missingInputs as string[],
    warnings: baseResult.warnings as string[],
    inputs: baseResult.inputs as ResolutionInput[],
  };
}

function topologicalSort(
  nodes: string[],
  edges: Map<string, string[]>,
): TopologicalSortResult {
  // edges: node → [dependencies]. Topological order: dependencies first.
  // Kahn's algorithm on the reverse graph.
  const reverseEdges = new Map<string, string[]>();
  for (const n of nodes) reverseEdges.set(n, []);
  for (const [node, deps] of edges) {
    for (const dep of deps) {
      const rev = reverseEdges.get(dep) ?? [];
      rev.push(node);
      reverseEdges.set(dep, rev);
    }
  }

  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n, (edges.get(n) ?? []).length);

  const queue: string[] = [];
  for (const [n, d] of degree) {
    if (d === 0) queue.push(n);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const dependent of reverseEdges.get(current) ?? []) {
      const newDeg = (degree.get(dependent) ?? 1) - 1;
      degree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  const orderSet = new Set(order);
  const cycles = nodes.filter((n) => !orderSet.has(n));
  return { order, cycles };
}

type GrammarEntry = {
  anchorId: import("../shared/types.js").AnchorId;
  segmentId: import("../shared/types.js").SegmentId;
  text: string;
  result: import("../grammar/types.js").ParseResult;
};

function findDependencyAnchor(
  dependencyRef: string,
  grammarResults: readonly GrammarEntry[],
  _segments: readonly SourceSegment[],
  sectionIndex: SectionIndex,
  sourceSegmentId: string,
): import("../shared/types.js").AnchorId | null {
  const parts: string[] = [];
  const re = /\(([a-z\d]+)\)/gi;
  let m;
  while ((m = re.exec(dependencyRef)) !== null) {
    parts.push(m[1]!.toLowerCase());
  }
  if (parts.length === 0) return null;

  const sourceSection = sectionIndex.getSectionForSegment(sourceSegmentId);
  if (!sourceSection) return null;

  const targetCitation = `§ ${sourceSection}(${parts.join(")(")})`;
  const ranges = sectionIndex.getSegmentsForCitation(targetCitation);
  if (ranges.length === 0) return null;

  const segmentIdToAnchors = new Map<string, import("../shared/types.js").AnchorId[]>();
  for (const gr of grammarResults) {
    if (gr.result.parsed) {
      const list = segmentIdToAnchors.get(gr.segmentId as string) ?? [];
      list.push(gr.anchorId);
      segmentIdToAnchors.set(gr.segmentId as string, list);
    }
  }

  const pickBestAnchor = (anchors: import("../shared/types.js").AnchorId[]) => {
    const calYear = anchors.find(aid => {
      const gr = grammarResults.find(g => g.anchorId === aid);
      return gr?.result.parsed && gr.result.expression.kind === "calendar_year_anchored_date";
    });
    return calYear ?? anchors[0]!;
  };

  for (const range of ranges) {
    const anchors = segmentIdToAnchors.get(range.segmentId);
    if (anchors && anchors.length > 0) return pickBestAnchor(anchors);
  }

  return null;
}
