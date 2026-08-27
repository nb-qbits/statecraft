import type {
  DocumentVersionId,
  SegmentId,
  ContentHash,
  Fidelity,
} from "../shared/types.js";

export interface OffsetMap {
  readonly normalizedToOriginal: readonly number[];
  readonly originalToNormalized: readonly number[];
}

export type OffsetRun = readonly [start: number, mappedStart: number, length: number];

export interface CompressedOffsetMap {
  readonly n2o: readonly OffsetRun[];
  readonly o2n: readonly OffsetRun[];
}

export interface RunProperty {
  readonly italic: boolean;
  readonly strikethrough: boolean;
}

export interface ParsedRun {
  readonly text: string;
  readonly properties: RunProperty;
}

export interface ParsedParagraph {
  readonly structuralPath: string;
  readonly runs: readonly ParsedRun[];
}

export type ParseResult = ParseSuccess | ParseFailure;

export type NonBodyRunType = "marginal_note" | "running_header" | "page_footer" | "back_matter";

export interface NonBodyRun {
  readonly type: NonBodyRunType;
  readonly text: string;
  readonly pageNumber: number;
}

export interface CharacterAccounting {
  readonly inputChars: number;
  readonly strippedChars: number;
  readonly preprocessedChars: number;
  readonly segmentRawChars: number;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly paragraphs: readonly ParsedParagraph[];
  readonly parserAdapter: string;
  readonly parserVersion: string;
  readonly fidelity: Fidelity;
  readonly characterAccounting?: CharacterAccounting;
  readonly nonBodyContent?: readonly NonBodyRun[];
  readonly warnings?: readonly string[];
}

export interface ParseFailure {
  readonly ok: false;
  readonly reason: string;
  readonly parserAdapter: string;
  readonly parserVersion: string;
}

export interface DocumentParser {
  readonly adapterId: string;
  readonly version: string;
  parse(bytes: Buffer, mimeType: string): ParseResult;
}

export interface SourceSegment {
  readonly segmentId: SegmentId;
  readonly documentVersionId: DocumentVersionId;
  readonly structuralPath: string;
  readonly ordinal: number;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly contentHash: ContentHash;
  readonly offsetMap: OffsetMap;
  readonly parserAdapter: string;
  readonly parserVersion: string;
  readonly fidelity: Fidelity;
}

export interface NormalizeResult {
  readonly normalized: string;
  readonly offsetMap: OffsetMap;
}
