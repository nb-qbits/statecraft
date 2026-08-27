export type Jurisdiction = "us-va" | "us-fed";

export interface SubMarker {
  readonly offset: number;
  readonly citation: string;
}

export interface EnactedUnit {
  readonly sectionId: string;
  readonly subsectionPath: readonly string[];
  readonly citation: string;
}

export interface CitationSegmentRange {
  readonly segmentId: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface SectionIndex {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly declaredSections: readonly string[] | null;
  readonly sections: ReadonlyMap<string, EnactedUnit>;
  getCitationForSegment(segmentId: string): string | null;
  getCitationForAnchor(segmentId: string, normalizedStart: number): string | null;
  getSectionForSegment(segmentId: string): string | null;
  getSegmentsForCitation(citation: string): readonly CitationSegmentRange[];
  resolve(citation: string): EnactedUnit | null;
}
