import { describe, it, expect } from "vitest";
import type { SegmentId, CandidateId } from "../shared/types.js";
import type { SegmentScanResult, CandidateMatch } from "../scanning/types.js";
import { computeProcessingCoverage } from "./coverage.js";

function makeCandidate(segmentId: string): CandidateMatch {
  return {
    candidateId: `cand_${segmentId}` as CandidateId,
    segmentId: segmentId as SegmentId,
    kind: "date",
    ruleId: "date.explicit",
    matchedText: "July 1, 2025",
    matchStart: 0,
    matchEnd: 13,
    suppressed: false,
  };
}

function makeScanResult(segmentId: string, state: "candidates_found" | "screened_no_candidate"): SegmentScanResult {
  return {
    segmentId: segmentId as SegmentId,
    coverageState: state,
    candidates: state === "candidates_found" ? [makeCandidate(segmentId)] : [],
  };
}

describe("coverage accounting", () => {
  it("empty segments → all zeros", () => {
    const result = computeProcessingCoverage([]);
    expect(result.totalSegments).toBe(0);
    expect(result.withCandidates).toBe(0);
    expect(result.screenedNoCandidate).toBe(0);
    expect(result.needsSweep).toBe(0);
    expect(result.segments).toEqual([]);
  });

  it("all candidates_found → withCandidates equals total", () => {
    const scans = [
      makeScanResult("seg_1", "candidates_found"),
      makeScanResult("seg_2", "candidates_found"),
      makeScanResult("seg_3", "candidates_found"),
    ];
    const result = computeProcessingCoverage(scans);
    expect(result.totalSegments).toBe(3);
    expect(result.withCandidates).toBe(3);
    expect(result.screenedNoCandidate).toBe(0);
    expect(result.needsSweep).toBe(0);
  });

  it("all screened_no_candidate → screenedNoCandidate equals total", () => {
    const scans = [
      makeScanResult("seg_1", "screened_no_candidate"),
      makeScanResult("seg_2", "screened_no_candidate"),
    ];
    const result = computeProcessingCoverage(scans);
    expect(result.totalSegments).toBe(2);
    expect(result.withCandidates).toBe(0);
    expect(result.screenedNoCandidate).toBe(2);
  });

  it("mixed states → counts reconcile", () => {
    const scans = [
      makeScanResult("seg_1", "candidates_found"),
      makeScanResult("seg_2", "screened_no_candidate"),
      makeScanResult("seg_3", "candidates_found"),
      makeScanResult("seg_4", "screened_no_candidate"),
      makeScanResult("seg_5", "screened_no_candidate"),
    ];
    const result = computeProcessingCoverage(scans);
    expect(result.totalSegments).toBe(5);
    expect(result.withCandidates).toBe(2);
    expect(result.screenedNoCandidate).toBe(3);
    expect(result.needsSweep).toBe(0);
    expect(
      result.withCandidates + result.screenedNoCandidate + result.needsSweep,
    ).toBe(result.totalSegments);
  });

  it("every segment appears in exactly one state", () => {
    const scans = [
      makeScanResult("seg_1", "candidates_found"),
      makeScanResult("seg_2", "screened_no_candidate"),
      makeScanResult("seg_3", "candidates_found"),
    ];
    const result = computeProcessingCoverage(scans);
    expect(result.segments.length).toBe(3);

    const segmentIds = result.segments.map((s) => s.segmentId);
    expect(new Set(segmentIds).size).toBe(3);

    for (const seg of result.segments) {
      expect(["with_candidates", "screened_no_candidate", "needs_sweep"]).toContain(seg.label);
    }
  });

  it("segment labels map correctly from CoverageState", () => {
    const scans = [
      makeScanResult("seg_1", "candidates_found"),
      makeScanResult("seg_2", "screened_no_candidate"),
    ];
    const result = computeProcessingCoverage(scans);

    const seg1 = result.segments.find((s) => s.segmentId === "seg_1");
    const seg2 = result.segments.find((s) => s.segmentId === "seg_2");
    expect(seg1?.label).toBe("with_candidates");
    expect(seg2?.label).toBe("screened_no_candidate");
  });

  it("INV-7: labels are processing_coverage, not recall — no 'certified' or 'absence' language", () => {
    const scans = [makeScanResult("seg_1", "screened_no_candidate")];
    const result = computeProcessingCoverage(scans);
    const json = JSON.stringify(result);
    expect(json).not.toContain("certified");
    expect(json).not.toContain("absence");
    expect(json).not.toContain("recall");
    expect(json).toContain("screened_no_candidate");
  });
});
