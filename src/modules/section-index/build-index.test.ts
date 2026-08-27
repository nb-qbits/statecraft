import { describe, it, expect } from "vitest";
import type { SourceSegment } from "../parsing/types.js";
import type { DocumentVersionId, SegmentId, ContentHash } from "../shared/types.js";
import { buildSectionIndex, parseCitationString, normalizeSectionId } from "./build-index.js";

const DVID = "dv-test" as DocumentVersionId;

function makeSegment(
  structuralPath: string,
  rawText: string,
  ordinal: number,
): SourceSegment {
  return {
    segmentId: `seg_${ordinal}` as SegmentId,
    documentVersionId: DVID,
    structuralPath,
    ordinal,
    rawText,
    normalizedText: rawText,
    contentHash: `hash_${ordinal}` as ContentHash,
    offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    parserAdapter: "plain-text",
    parserVersion: "1.0.0",
    fidelity: "none",
  };
}

describe("parseCitationString", () => {
  it("parses § prefix with subsections", () => {
    expect(parseCitationString("§ 45.2-118(E)")).toEqual({
      sectionId: "45.2-118",
      subsectionPath: ["E"],
    });
  });

  it("parses federal citation with nested subsections", () => {
    expect(parseCitationString("§ 2(a)(1)")).toEqual({
      sectionId: "2",
      subsectionPath: ["a", "1"],
    });
  });

  it("parses Section prefix", () => {
    expect(parseCitationString("Section 45.2-118")).toEqual({
      sectionId: "45.2-118",
      subsectionPath: [],
    });
  });

  it("strips trailing period", () => {
    expect(parseCitationString("§ 45.2-118.")).toEqual({
      sectionId: "45.2-118",
      subsectionPath: [],
    });
  });

  it("parses bare number", () => {
    expect(parseCitationString("45.2-118")).toEqual({
      sectionId: "45.2-118",
      subsectionPath: [],
    });
  });

  it("parses deep federal citation", () => {
    expect(parseCitationString("§ 2(a)(1)(A)(i)")).toEqual({
      sectionId: "2",
      subsectionPath: ["a", "1", "A", "i"],
    });
  });
});

describe("normalizeSectionId", () => {
  it("strips § prefix", () => {
    expect(normalizeSectionId("§ 45.2-114")).toBe("45.2-114");
  });

  it("strips Section prefix", () => {
    expect(normalizeSectionId("Section 2")).toBe("2");
  });
});

describe("buildSectionIndex — Virginia Chapter 1126", () => {
  function makeChapter1126Segments(): SourceSegment[] {
    return [
      makeSegment(
        "/body/p[0]",
        "CHAPTER 1126 An Act to amend the Code of Virginia by adding in Chapter 1 of Title 45.2 an article numbered 3, consisting of sections numbered 45.2-114 through 45.2-122, relating to Virginia Clean Energy Innovation Bank",
        0,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[0]",
        "§ 45.2-114. Virginia Clean Energy Innovation Bank; Bank Advisory Board.",
        1,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[1]",
        "A. The Virginia Clean Energy Innovation Bank is established in the Department.",
        2,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[2]",
        "B. 1. The Virginia Clean Energy Innovation Bank Advisory Board is established.",
        3,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[3]",
        "2. The Bank Advisory Board shall have a total membership of eight members.",
        4,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[4]",
        "3. The nonlegislative citizen members shall be appointed for five-year staggered terms.",
        5,
      ),
      makeSegment(
        "/body/section[45.2-114]/p[5]",
        "4. The Bank Advisory Board shall annually elect a chair and vice-chair.",
        6,
      ),
      makeSegment(
        "/body/section[45.2-115]/p[0]",
        "§ 45.2-115. Definitions.",
        7,
      ),
      makeSegment(
        "/body/section[45.2-116]/p[0]",
        "§ 45.2-116. Duties of the Bank.",
        8,
      ),
      makeSegment(
        "/body/section[45.2-116]/p[1]",
        "A. The Bank shall:",
        9,
      ),
      makeSegment(
        "/body/section[45.2-116]/p[2]",
        "1. Advise the Director on the management of the Bank.",
        10,
      ),
      makeSegment(
        "/body/section[45.2-116]/p[3]",
        "C. In carrying out its powers and duties, the Bank may:",
        11,
      ),
      makeSegment(
        "/body/section[45.2-117]/p[0]",
        "§ 45.2-117. Bank lending practices; consumer protection.",
        12,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[0]",
        "§ 45.2-118. Strategic plan.",
        13,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[1]",
        "A. By December 15, 2026, and each December 15 in even-numbered years thereafter, the Bank shall develop and adopt a strategic plan.",
        14,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[2]",
        "B. Elements of the strategic plan shall be informed by the Bank's analysis.",
        15,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[3]",
        "C. The Bank shall establish annual targets.",
        16,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[4]",
        "D. The Bank's targets shall ensure no less than 40 percent of benefits flow to disadvantaged communities.",
        17,
      ),
      makeSegment(
        "/body/section[45.2-118]/p[5]",
        "E. The Bank shall submit a draft strategic plan to the Bank Advisory Board no later than August 1.",
        18,
      ),
      makeSegment(
        "/body/section[45.2-119]/p[0]",
        "§ 45.2-119. Investment strategy; content; process.",
        19,
      ),
      makeSegment(
        "/body/section[45.2-119]/p[1]",
        "A. No later than December 15, 2026, and every four years thereafter, the Bank shall adopt a long-term investment strategy.",
        20,
      ),
      makeSegment(
        "/body/section[45.2-120]/p[0]",
        "§ 45.2-120. Public outreach.",
        21,
      ),
      makeSegment(
        "/body/section[45.2-121]/p[0]",
        "§ 45.2-121. Form and audit of accounts and records.",
        22,
      ),
      makeSegment(
        "/body/section[45.2-122]/p[0]",
        "§ 45.2-122. Annual report.",
        23,
      ),
    ];
  }

  it("builds valid index with all 9 sections", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.valid).toBe(true);
    expect(index.errors).toHaveLength(0);
    expect(index.declaredSections).toHaveLength(9);
  });

  it("resolves enacted sections", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.resolve("§ 45.2-114")).not.toBeNull();
    expect(index.resolve("§ 45.2-118")).not.toBeNull();
    expect(index.resolve("§ 45.2-122")).not.toBeNull();
  });

  it("resolves with Section prefix", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.resolve("Section 45.2-118")).not.toBeNull();
  });

  it("resolves with bare number", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.resolve("45.2-120")).not.toBeNull();
  });

  it("resolves subsection references", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    const result = index.resolve("§ 45.2-118(E)");
    expect(result).not.toBeNull();
    expect(result!.citation).toBe("§ 45.2-118(E)");
  });

  it("returns null for external references", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.resolve("§ 56-576")).toBeNull();
    expect(index.resolve("§ 551")).toBeNull();
    expect(index.resolve("§ 45X")).toBeNull();
    expect(index.resolve("§ 45.2-1600")).toBeNull();
    expect(index.resolve("§ 45.2-113")).toBeNull();
    expect(index.resolve("§ 45.2-123")).toBeNull();
  });

  it("assigns section-level citation to section heading", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.getCitationForSegment("seg_13" as SegmentId)).toBe("§ 45.2-118");
  });

  it("assigns subsection citation to lettered subsection", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.getCitationForSegment("seg_14" as SegmentId)).toBe("§ 45.2-118(A)");
    expect(index.getCitationForSegment("seg_15" as SegmentId)).toBe("§ 45.2-118(B)");
    expect(index.getCitationForSegment("seg_18" as SegmentId)).toBe("§ 45.2-118(E)");
  });

  it("assigns nested citation B.1 correctly", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.getCitationForSegment("seg_3" as SegmentId)).toBe("§ 45.2-114(B)(1)");
    expect(index.getCitationForSegment("seg_4" as SegmentId)).toBe("§ 45.2-114(B)(2)");
    expect(index.getCitationForSegment("seg_5" as SegmentId)).toBe("§ 45.2-114(B)(3)");
  });

  it("handles subsection C after A with number children", () => {
    const index = buildSectionIndex(makeChapter1126Segments(), "us-va");
    expect(index.getCitationForSegment("seg_9" as SegmentId)).toBe("§ 45.2-116(A)");
    expect(index.getCitationForSegment("seg_10" as SegmentId)).toBe("§ 45.2-116(A)(1)");
    expect(index.getCitationForSegment("seg_11" as SegmentId)).toBe("§ 45.2-116(C)");
  });
});

describe("buildSectionIndex — Federal PLAW-114publ117", () => {
  function makePLAWSegments(): SourceSegment[] {
    return [
      makeSegment(
        "/body/section[1]/p[0]",
        "SECTION 1. SHORT TITLE. This Act may be cited as the GONE Act.",
        0,
      ),
      makeSegment(
        "/body/section[2]/p[0]",
        "SEC. 2. IDENTIFYING AND CLOSING OUT EXPIRED FEDERAL GRANT AWARDS.",
        1,
      ),
      makeSegment(
        "/body/section[2]/p[1]",
        "(a) EXPIRED FEDERAL GRANT AWARD REPORT.— (1) IN GENERAL.—Not later than 180 days after the date of the enactment of this Act, the Director shall instruct the head of each agency to submit a report that— (A) lists each Federal grant award; (B) provides the total number of Federal grant awards—",
        2,
      ),
      makeSegment(
        "/body/section[2]/p[2]",
        "(i) by time period of expiration; (ii) with zero dollar balances; and (iii) with undisbursed balances; (C) describes the challenges; and (D) explains why the 30 oldest Federal grant awards have not been closed out. (2) USE OF DATA SYSTEMS.—An agency may use existing systems. (3) EXPLANATION OF MISSING INFORMATION.—If the head is unable to submit all info.",
        3,
      ),
      makeSegment(
        "/body/section[2]/p[3]",
        "(b) NOTICE FROM AGENCIES.— (1) IN GENERAL.—Not later than 1 year after submission, the head shall provide notice. (2) NOTICE TO CONGRESS.—Not later than 90 days after all notices, the Secretary shall compile and submit a report.",
        4,
      ),
      makeSegment(
        "/body/section[2]/p[4]",
        "(c) INSPECTOR GENERAL REVIEW.—Not later than 1 year after the date on which the head provides notice to Congress under subsection (b)(2), the Inspector General shall conduct a risk assessment.",
        5,
      ),
      makeSegment(
        "/body/section[2]/p[5]",
        "(d) REPORT ON ACCOUNTABILITY AND OVERSIGHT.—Not later than 6 months after the date on which the second report is submitted pursuant to subsection (b)(2), the Director shall submit to Congress a report.",
        6,
      ),
      makeSegment(
        "/body/section[2]/p[6]",
        "(e) DEFINITIONS.—In this section: (1) AGENCY.—The term agency has the meaning given that term in section 551 of title 5, United States Code.",
        7,
      ),
    ];
  }

  it("builds valid index", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.valid).toBe(true);
  });

  it("resolves SECTION 1 and SEC. 2", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.resolve("§ 1")).not.toBeNull();
    expect(index.resolve("§ 2")).not.toBeNull();
    expect(index.resolve("Section 1")).not.toBeNull();
  });

  it("resolves subsection-level citations", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.resolve("§ 2(a)")).not.toBeNull();
    expect(index.resolve("§ 2(b)")).not.toBeNull();
    expect(index.resolve("§ 2(c)")).not.toBeNull();
    expect(index.resolve("§ 2(d)")).not.toBeNull();
    expect(index.resolve("§ 2(e)")).not.toBeNull();
  });

  it("resolves deep federal citations", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.resolve("§ 2(a)(1)")).not.toBeNull();
    expect(index.resolve("§ 2(b)(1)")).not.toBeNull();
    expect(index.resolve("§ 2(b)(2)")).not.toBeNull();
  });

  it("returns null for external references", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.resolve("§ 551")).toBeNull();
    expect(index.resolve("section 551")).toBeNull();
    expect(index.resolve("§ 3")).toBeNull();
    expect(index.resolve("§ 45X")).toBeNull();
  });

  it("assigns primary citation to subsection segments", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    expect(index.getCitationForSegment("seg_2" as SegmentId)).toBe("§ 2(a)");
    expect(index.getCitationForSegment("seg_4" as SegmentId)).toBe("§ 2(b)");
    expect(index.getCitationForSegment("seg_5" as SegmentId)).toBe("§ 2(c)");
    expect(index.getCitationForSegment("seg_6" as SegmentId)).toBe("§ 2(d)");
  });

  it("resolves within-segment anchors to most specific citation", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    const seg2Text = "(a) EXPIRED FEDERAL GRANT AWARD REPORT.— (1) IN GENERAL.—Not later than 180 days";
    const offset1 = seg2Text.indexOf("(1)");

    expect(index.getCitationForAnchor("seg_2" as SegmentId, 0)).toBe("§ 2(a)");
    expect(index.getCitationForAnchor("seg_2" as SegmentId, offset1 + 5)).toBe("§ 2(a)(1)");
  });

  it("resolves within-segment anchor for (b)(1) and (b)(2)", () => {
    const index = buildSectionIndex(makePLAWSegments(), "us-fed");
    const seg4Text = "(b) NOTICE FROM AGENCIES.— (1) IN GENERAL.—Not later than 1 year after submission, the head shall provide notice. (2) NOTICE TO CONGRESS.—Not later than 90 days";
    const offset2 = seg4Text.indexOf("(2)");

    expect(index.getCitationForAnchor("seg_4" as SegmentId, 5)).toBe("§ 2(b)");
    expect(index.getCitationForAnchor("seg_4" as SegmentId, offset2 + 5)).toBe("§ 2(b)(2)");
  });
});

describe("buildSectionIndex — validation failures", () => {
  it("fails when declared section is missing", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 45.2-114 through 45.2-116",
        0,
      ),
      makeSegment("/body/section[45.2-114]/p[0]", "§ 45.2-114. First.", 1),
      makeSegment("/body/section[45.2-116]/p[0]", "§ 45.2-116. Third.", 2),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.errors.some(e => e.includes("45.2-115"))).toBe(true);
  });

  it("fails when section outside declared range is found", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 45.2-114 through 45.2-115",
        0,
      ),
      makeSegment("/body/section[45.2-114]/p[0]", "§ 45.2-114. First.", 1),
      makeSegment("/body/section[45.2-115]/p[0]", "§ 45.2-115. Second.", 2),
      makeSegment("/body/section[99-999]/p[0]", "§ 99-999. Rogue.", 3),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.errors.some(e => e.includes("99-999"))).toBe(true);
  });

  it("fails on sequence gap", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 10-100 through 10-103",
        0,
      ),
      makeSegment("/body/section[10-100]/p[0]", "§ 10-100. A.", 1),
      makeSegment("/body/section[10-101]/p[0]", "§ 10-101. B.", 2),
      makeSegment("/body/section[10-103]/p[0]", "§ 10-103. D.", 3),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.errors.some(e => e.includes("10-102"))).toBe(true);
  });

  it("invalid index refuses all resolves and citations", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 45.2-114 through 45.2-116",
        0,
      ),
      makeSegment("/body/section[45.2-114]/p[0]", "§ 45.2-114. First.", 1),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.resolve("§ 45.2-114")).toBeNull();
    expect(index.getCitationForSegment("seg_1" as SegmentId)).toBeNull();
    expect(index.getCitationForAnchor("seg_1" as SegmentId, 0)).toBeNull();
  });

  it("corrupted fixture with duplicated section fails validation", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 10-100 through 10-102",
        0,
      ),
      makeSegment("/body/section[10-100]/p[0]", "§ 10-100. A.", 1),
      makeSegment("/body/section[10-100]/p[1]", "§ 10-100. A duplicate.", 2),
      makeSegment("/body/section[10-101]/p[0]", "§ 10-101. B.", 3),
      makeSegment("/body/section[10-102]/p[0]", "§ 10-102. C.", 4),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(true);
  });
});

describe("buildSectionIndex — no enacting clause", () => {
  it("builds index from structural paths without declared range", () => {
    const segments = [
      makeSegment("/body/p[0]", "Some document.", 0),
      makeSegment("/body/section[1-100]/p[0]", "§ 1-100. Title.", 1),
      makeSegment("/body/section[1-101]/p[0]", "§ 1-101. Title.", 2),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(true);
    expect(index.declaredSections).toBeNull();
  });

  it("resolves without declared range", () => {
    const segments = [
      makeSegment("/body/p[0]", "Some document.", 0),
      makeSegment("/body/section[1-100]/p[0]", "§ 1-100. Title.", 1),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.resolve("§ 1-100")).not.toBeNull();
    expect(index.resolve("§ 1-999")).toBeNull();
  });
});

describe("buildSectionIndex — corrupted fixture (Gate 3d)", () => {
  it("refuses when section is missing from declared range", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 45.2-114 through 45.2-118",
        0,
      ),
      makeSegment("/body/section[45.2-114]/p[0]", "§ 45.2-114. A.", 1),
      makeSegment("/body/section[45.2-115]/p[0]", "§ 45.2-115. B.", 2),
      makeSegment("/body/section[45.2-117]/p[0]", "§ 45.2-117. D.", 3),
      makeSegment("/body/section[45.2-118]/p[0]", "§ 45.2-118. E.", 4),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.errors.some(e => e.includes("45.2-116"))).toBe(true);
    expect(index.resolve("§ 45.2-114")).toBeNull();
    expect(index.getCitationForSegment("seg_1" as SegmentId)).toBeNull();
  });

  it("refuses when rogue section appears outside declared range", () => {
    const segments = [
      makeSegment(
        "/body/p[0]",
        "Act adding sections numbered 10-1 through 10-2",
        0,
      ),
      makeSegment("/body/section[10-1]/p[0]", "§ 10-1. A.", 1),
      makeSegment("/body/section[10-2]/p[0]", "§ 10-2. B.", 2),
      makeSegment("/body/section[10-99]/p[0]", "§ 10-99. Rogue.", 3),
    ];
    const index = buildSectionIndex(segments, "us-va");
    expect(index.valid).toBe(false);
    expect(index.errors.some(e => e.includes("10-99"))).toBe(true);
  });
});
