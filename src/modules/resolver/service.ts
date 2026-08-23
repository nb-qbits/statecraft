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

      const { order, cycles, edgesBySource } = buildDependencyGraph(parsedOnly, segments);

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
            capRef.dependencyRef, parsedOnly, segments,
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
            result, expression, eventTextEdge, resolvedResults, parsedOnly, segments,
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
      const dep = findDependencyAnchor(capRef.dependencyRef, grammarResults, segments);
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
          const dep = findDependencyAnchor(ref, grammarResults, segments);
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

function detectCrossReferenceIssue(
  referenceEventText: string,
  depAnchorId: string,
  grammarResults: readonly GrammarEntry[],
  segments: readonly SourceSegment[],
): "broken_cross_reference" | "nonexistent_trigger" | null {
  if (/\b(second|third|fourth|each|every)\b/i.test(referenceEventText)) {
    return "nonexistent_trigger";
  }

  const depGr = grammarResults.find((g) => g.anchorId === depAnchorId);
  if (!depGr) return null;

  const seg = segments.find((s) => (s.segmentId as string) === (depGr.segmentId as string));
  if (!seg) return null;

  const actorMatch = /\b(?:the\s+)((?:head|director|secretary|administrator|commissioner|chair(?:man|person)?)\s+(?:of\s+(?:an?\s+)?(?:agency|department|commission|bureau|office|board)))/i.exec(referenceEventText);
  if (actorMatch) {
    const actor = actorMatch[1]!.toLowerCase();
    if (!seg.rawText.toLowerCase().includes(actor)) {
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

const SECTION_HEADING_RE = /\bSEC(?:TION)?\.?\s*(\d+)/i;

function findSectionNumber(segments: readonly SourceSegment[], targetAnchorId: string, grammarResults: readonly GrammarEntry[]): string | null {
  const gr = grammarResults.find((g) => (g.anchorId as string) === targetAnchorId);
  if (!gr) return null;
  const seg = segments.find((s) => (s.segmentId as string) === (gr.segmentId as string));
  if (!seg) return null;
  const textPos = seg.rawText.indexOf(gr.text);
  const textBefore = textPos >= 0 ? seg.rawText.slice(0, textPos) : seg.rawText;
  const matches = [...textBefore.matchAll(new RegExp(SECTION_HEADING_RE, "gi"))];
  if (matches.length > 0) return matches[matches.length - 1]![1]!;
  const wholeMatch = SECTION_HEADING_RE.exec(seg.rawText);
  return wholeMatch ? wholeMatch[1]! : null;
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
): ResolutionResult {
  if (baseResult.resolved) return baseResult;

  const depResult = resolvedResults.get(eventTextEdge.target);
  if (!depResult) return baseResult;

  const sectionNum = findSectionNumber(segments, eventTextEdge.target, grammarResults);
  const refLabel = formatSubsectionLabel(eventTextEdge.ref, sectionNum);
  const referenceEventText = expression.referenceEventText ?? "";

  const crossRefIssue = detectCrossReferenceIssue(
    referenceEventText, eventTextEdge.target, grammarResults, segments,
  );
  if (crossRefIssue) {
    const depGr = grammarResults.find((g) => (g.anchorId as string) === eventTextEdge.target);
    const depText = depGr?.text ?? eventTextEdge.ref;
    const explanation = crossRefIssue === "broken_cross_reference"
      ? `The described trigger references ${refLabel}, but the actor or action described does not match that subsection's content. The referenced subsection text: "${depText.slice(0, 120)}"`
      : `The trigger references a "${referenceEventText.match(/\b(second|third|fourth|each|every)\b/i)?.[0] ?? "repeated"}" occurrence under ${refLabel}, but that subsection requires only one`;
    return {
      resolved: false,
      refusalKind: crossRefIssue,
      reason: explanation,
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

  return {
    resolved: false,
    bounded: true,
    upperBound: bound,
    reason: `transitive bound: ${expression.quantity} ${expression.unit} after dependency under ${refLabel} (${depLabel}) — on or before ${bound}`,
    contingency,
    derivationDepth: depDepth + 1,
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
  segments: readonly SourceSegment[],
): import("../shared/types.js").AnchorId | null {
  const parts: string[] = [];
  const re = /\(([a-z\d]+)\)/gi;
  let m;
  while ((m = re.exec(dependencyRef)) !== null) {
    parts.push(m[1]!.toLowerCase());
  }
  if (parts.length === 0) return null;

  const sorted = [...segments].sort((a, b) => a.ordinal - b.ordinal);

  // Strategy 1: segment-boundary matching (fine-grained documents)
  const segmentIdToAnchors = new Map<string, import("../shared/types.js").AnchorId[]>();
  for (const gr of grammarResults) {
    if (gr.result.parsed) {
      const list = segmentIdToAnchors.get(gr.segmentId as string) ?? [];
      list.push(gr.anchorId);
      segmentIdToAnchors.set(gr.segmentId as string, list);
    }
  }

  let context: string[] = [];
  for (const seg of sorted) {
    const text = seg.rawText.trim();

    const parentMatch = /^\(([a-z])\)\s/i.exec(text);
    if (parentMatch) {
      context = [parentMatch[1]!.toLowerCase()];
      if (parts.length === 1 && parts[0] === context[0]) {
        const anchors = segmentIdToAnchors.get(seg.segmentId as string);
        if (anchors && anchors.length > 0) return anchors[0]!;
      }
      continue;
    }

    const childMatch = /^\((\d+)\)\s/i.exec(text);
    if (childMatch) {
      const identity = [...context, childMatch[1]!];
      if (identity.length === parts.length &&
          identity.every((p, i) => p === parts[i])) {
        const anchors = segmentIdToAnchors.get(seg.segmentId as string);
        if (anchors && anchors.length > 0) return anchors[0]!;
      }
    }
  }

  // Strategy 2: text-position matching within coarsely-segmented documents
  return findDependencyByTextPosition(parts, grammarResults, sorted);
}

const SUBSECTION_REFERENCE_PREFIX = /(?:subsection|paragraph|section|subparagraph)\s+$/i;

function isStructuralMarker(rawText: string, matchIndex: number): boolean {
  const preceding = rawText.slice(Math.max(0, matchIndex - 20), matchIndex);
  return !SUBSECTION_REFERENCE_PREFIX.test(preceding);
}

function findDependencyByTextPosition(
  parts: string[],
  grammarResults: readonly GrammarEntry[],
  segments: readonly SourceSegment[],
): import("../shared/types.js").AnchorId | null {
  for (const seg of segments) {
    const searchText = seg.normalizedText;
    const segResults = grammarResults.filter(
      (gr) =>
        (gr.segmentId as string) === (seg.segmentId as string) &&
        gr.result.parsed,
    );
    if (segResults.length === 0) continue;

    const markerStart = findMarkerPosition(parts, searchText);
    if (markerStart < 0) continue;

    const endPos = findSubsectionEnd(parts, searchText, markerStart);

    const candidates: Array<{
      anchorId: import("../shared/types.js").AnchorId;
      pos: number;
      kind: string;
    }> = [];
    for (const gr of segResults) {
      const textPos = searchText.indexOf(gr.text, markerStart);
      if (textPos >= 0 && textPos < endPos) {
        candidates.push({
          anchorId: gr.anchorId,
          pos: textPos,
          kind: gr.result.parsed ? gr.result.expression.kind : "",
        });
      }
    }
    if (candidates.length === 0) continue;

    const calYear = candidates.find(
      (c) => c.kind === "calendar_year_anchored_date",
    );
    if (calYear) return calYear.anchorId;

    candidates.sort((a, b) => a.pos - b.pos);
    return candidates[0]!.anchorId;
  }
  return null;
}

function findMarkerPosition(parts: string[], rawText: string): number {
  const markerRe = /\(([a-z\d]+)\)/gi;
  const markers: Array<{ label: string; index: number }> = [];
  let match;
  while ((match = markerRe.exec(rawText)) !== null) {
    if (isStructuralMarker(rawText, match.index)) {
      markers.push({ label: match[1]!.toLowerCase(), index: match.index });
    }
  }

  let searchFrom = 0;
  for (let i = 0; i < parts.length; i++) {
    const target = parts[i]!;
    const found = markers.find(
      (mk) => mk.label === target && mk.index >= searchFrom,
    );
    if (!found) return -1;
    searchFrom = found.index + target.length + 2;
    if (i === parts.length - 1) return searchFrom;
  }
  return -1;
}

function findSubsectionEnd(
  parts: string[],
  rawText: string,
  markerEnd: number,
): number {
  const deepest = parts[parts.length - 1]!;
  const isNumeric = /^\d+$/.test(deepest);
  const markerRe = /\(([a-z\d]+)\)/gi;
  markerRe.lastIndex = markerEnd;

  let match;
  while ((match = markerRe.exec(rawText)) !== null) {
    if (!isStructuralMarker(rawText, match.index)) continue;
    const label = match[1]!.toLowerCase();
    if (isNumeric) {
      const num = parseInt(deepest, 10);
      const labelNum = parseInt(label, 10);
      if (!isNaN(labelNum) && labelNum === num + 1) return match.index;
      if (/^[a-z]$/i.test(label)) return match.index;
    } else {
      if (/^[a-z]$/i.test(label) && label !== deepest) return match.index;
    }
  }
  return rawText.length;
}
