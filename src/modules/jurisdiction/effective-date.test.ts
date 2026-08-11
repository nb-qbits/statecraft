import { describe, it, expect } from "vitest";
import { deriveEffectiveDate } from "./effective-date.js";
import type { SessionMetadata } from "./types.js";

function session(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionType: "regular",
    adjournmentDate: "2026-03-08",
    actType: "ordinary",
    specifiedDate: null,
    passageDate: null,
    ...overrides,
  };
}

describe("§ 1-214 effective-date derivation", () => {
  describe("(A) Regular session — default: July 1 following adjournment", () => {
    it("regular session adjourned March 8, 2026 → July 1, 2026", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "regular",
        adjournmentDate: "2026-03-08",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-07-01");
      expect(result.ruleId).toBe("va-1-214-A-default");
      expect(result.citation).toBe("Va. Code § 1-214(A)");
      expect(result.packVersion).toBe("1.0.0");
    });

    it("regular session adjourned January 2025 → July 1, 2025", () => {
      const result = deriveEffectiveDate(session({
        adjournmentDate: "2025-01-15",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2025-07-01");
      expect(result.ruleId).toBe("va-1-214-A-default");
    });

    it("regular session adjourned in August → July 1 of NEXT year", () => {
      const result = deriveEffectiveDate(session({
        adjournmentDate: "2026-08-15",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2027-07-01");
      expect(result.ruleId).toBe("va-1-214-A-default");
    });

    it("regular session adjourned July 1 itself → July 1 of NEXT year", () => {
      const result = deriveEffectiveDate(session({
        adjournmentDate: "2026-07-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2027-07-01");
      expect(result.ruleId).toBe("va-1-214-A-default");
    });
  });

  describe("(A) Regular session — specified date override", () => {
    it("specified date October 1, 2026 overrides July 1 default", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "regular",
        adjournmentDate: "2026-03-08",
        specifiedDate: "2026-10-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-10-01");
      expect(result.ruleId).toBe("va-1-214-A-specified");
      expect(result.citation).toBe("Va. Code § 1-214(A)");
    });
  });

  describe("(B) Special session — default: first day of fourth month following adjournment month", () => {
    it("special session adjourns June 2026 → October 1, 2026", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "special",
        adjournmentDate: "2026-06-15",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-10-01");
      expect(result.ruleId).toBe("va-1-214-B-default");
      expect(result.citation).toBe("Va. Code § 1-214(B)");
    });

    it("special session adjourns September 2026 → January 1, 2027 (crosses year boundary)", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "special",
        adjournmentDate: "2026-09-20",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2027-01-01");
      expect(result.ruleId).toBe("va-1-214-B-default");
    });

    it("special session adjourns November 2026 → March 1, 2027", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "special",
        adjournmentDate: "2026-11-10",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2027-03-01");
      expect(result.ruleId).toBe("va-1-214-B-default");
    });

    it("special session adjourns January 2026 → May 1, 2026", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "special",
        adjournmentDate: "2026-01-30",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-05-01");
      expect(result.ruleId).toBe("va-1-214-B-default");
    });
  });

  describe("(B) Special session — specified date override", () => {
    it("specified date overrides the fourth-month default", () => {
      const result = deriveEffectiveDate(session({
        sessionType: "special",
        adjournmentDate: "2026-06-15",
        specifiedDate: "2027-01-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2027-01-01");
      expect(result.ruleId).toBe("va-1-214-B-specified");
      expect(result.citation).toBe("Va. Code § 1-214(B)");
    });
  });

  describe("(C) General appropriation act", () => {
    it("default: from passage", () => {
      const result = deriveEffectiveDate(session({
        actType: "general_appropriation",
        passageDate: "2026-04-15",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-04-15");
      expect(result.ruleId).toBe("va-1-214-C-default");
      expect(result.citation).toBe("Va. Code § 1-214(C)");
    });

    it("specified date overrides from-passage", () => {
      const result = deriveEffectiveDate(session({
        actType: "general_appropriation",
        passageDate: "2026-04-15",
        specifiedDate: "2026-07-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-07-01");
      expect(result.ruleId).toBe("va-1-214-C-specified");
      expect(result.citation).toBe("Va. Code § 1-214(C)");
    });

    it("missing passageDate and no specifiedDate → unresolved", () => {
      const result = deriveEffectiveDate(session({
        actType: "general_appropriation",
        passageDate: null,
      }));
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("passageDate");
    });
  });

  describe("(D) Emergency act", () => {
    it("default: from passage", () => {
      const result = deriveEffectiveDate(session({
        actType: "emergency",
        passageDate: "2026-02-20",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-02-20");
      expect(result.ruleId).toBe("va-1-214-D-default");
      expect(result.citation).toBe("Va. Code § 1-214(D)");
    });

    it("specified date overrides from-passage", () => {
      const result = deriveEffectiveDate(session({
        actType: "emergency",
        specifiedDate: "2026-05-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2026-05-01");
      expect(result.ruleId).toBe("va-1-214-D-specified");
      expect(result.citation).toBe("Va. Code § 1-214(D)");
    });

    it("missing passageDate and no specifiedDate → unresolved", () => {
      const result = deriveEffectiveDate(session({
        actType: "emergency",
        passageDate: null,
      }));
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("passageDate");
    });
  });

  describe("(E) Decennial reapportionment", () => {
    it("takes effect immediately (from passage)", () => {
      const result = deriveEffectiveDate(session({
        actType: "decennial_reapportionment",
        passageDate: "2031-06-01",
      }));
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.date).toBe("2031-06-01");
      expect(result.ruleId).toBe("va-1-214-E");
      expect(result.citation).toBe("Va. Code § 1-214(E)");
    });

    it("missing passageDate → unresolved", () => {
      const result = deriveEffectiveDate(session({
        actType: "decennial_reapportionment",
        passageDate: null,
      }));
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("passageDate");
    });
  });

  describe("Missing session metadata → unresolved", () => {
    it("missing sessionType → unresolved", () => {
      const result = deriveEffectiveDate({
        sessionType: "" as "regular",
        adjournmentDate: "2026-03-08",
        actType: "ordinary",
        specifiedDate: null,
        passageDate: null,
      });
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("sessionType");
    });

    it("regular session with missing adjournmentDate → unresolved", () => {
      const result = deriveEffectiveDate(session({
        adjournmentDate: "",
      }));
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("adjournmentDate");
    });
  });

  describe("INV-6: every result carries ruleId, citation, packVersion", () => {
    it("resolved result has all three fields", () => {
      const result = deriveEffectiveDate(session());
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.ruleId).toMatch(/^va-1-214-/);
      expect(result.citation).toMatch(/^Va\. Code § 1-214/);
      expect(result.packVersion).toBe("1.0.0");
    });
  });

  describe("Each branch returns a DISTINCT ruleId", () => {
    it("all nine ruleIds are unique", () => {
      const cases: SessionMetadata[] = [
        session({ sessionType: "regular", adjournmentDate: "2026-03-08" }),
        session({ sessionType: "regular", adjournmentDate: "2026-03-08", specifiedDate: "2026-10-01" }),
        session({ sessionType: "special", adjournmentDate: "2026-06-15" }),
        session({ sessionType: "special", adjournmentDate: "2026-06-15", specifiedDate: "2027-01-01" }),
        session({ actType: "general_appropriation", passageDate: "2026-04-15" }),
        session({ actType: "general_appropriation", specifiedDate: "2026-07-01" }),
        session({ actType: "emergency", passageDate: "2026-02-20" }),
        session({ actType: "emergency", specifiedDate: "2026-05-01" }),
        session({ actType: "decennial_reapportionment", passageDate: "2031-06-01" }),
      ];

      const ruleIds = cases.map(c => {
        const r = deriveEffectiveDate(c);
        expect(r.resolved).toBe(true);
        return r.resolved ? r.ruleId : "";
      });

      expect(new Set(ruleIds).size).toBe(ruleIds.length);
    });
  });
});
