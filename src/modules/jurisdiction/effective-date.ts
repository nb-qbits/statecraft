import type { SessionMetadata, EffectiveDateResult } from "./types.js";
import { formatDate } from "./holidays.js";

const PACK_VERSION = "1.0.0";

export function deriveEffectiveDate(session: SessionMetadata): EffectiveDateResult {
  if (!session.sessionType) {
    return {
      resolved: false,
      reason: "sessionType is required",
      missingInputs: ["sessionType"],
    };
  }

  if (!session.adjournmentDate && session.actType !== "emergency" &&
      session.actType !== "general_appropriation" &&
      session.actType !== "decennial_reapportionment") {
    return {
      resolved: false,
      reason: "adjournmentDate is required for regular and special session acts",
      missingInputs: ["adjournmentDate"],
    };
  }

  if (session.actType === "decennial_reapportionment") {
    return deriveReapportionment(session);
  }

  if (session.actType === "emergency") {
    return deriveEmergency(session);
  }

  if (session.actType === "general_appropriation") {
    return deriveGeneralAppropriation(session);
  }

  if (session.sessionType === "regular") {
    return deriveRegularSession(session);
  }

  if (session.sessionType === "special") {
    return deriveSpecialSession(session);
  }

  return {
    resolved: false,
    reason: `unknown sessionType: ${session.sessionType}`,
    missingInputs: ["sessionType"],
  };
}

function deriveReapportionment(session: SessionMetadata): EffectiveDateResult {
  if (!session.passageDate) {
    return {
      resolved: false,
      reason: "passageDate is required for decennial reapportionment acts (takes effect immediately)",
      missingInputs: ["passageDate"],
    };
  }

  return {
    resolved: true,
    date: session.passageDate,
    ruleId: "va-1-214-E",
    citation: "Va. Code § 1-214(E)",
    packVersion: PACK_VERSION,
  };
}

function deriveEmergency(session: SessionMetadata): EffectiveDateResult {
  if (session.specifiedDate) {
    return {
      resolved: true,
      date: session.specifiedDate,
      ruleId: "va-1-214-D-specified",
      citation: "Va. Code § 1-214(D)",
      packVersion: PACK_VERSION,
    };
  }

  if (!session.passageDate) {
    return {
      resolved: false,
      reason: "passageDate is required for emergency acts (takes effect from passage)",
      missingInputs: ["passageDate"],
    };
  }

  return {
    resolved: true,
    date: session.passageDate,
    ruleId: "va-1-214-D-default",
    citation: "Va. Code § 1-214(D)",
    packVersion: PACK_VERSION,
  };
}

function deriveGeneralAppropriation(session: SessionMetadata): EffectiveDateResult {
  if (session.specifiedDate) {
    return {
      resolved: true,
      date: session.specifiedDate,
      ruleId: "va-1-214-C-specified",
      citation: "Va. Code § 1-214(C)",
      packVersion: PACK_VERSION,
    };
  }

  if (!session.passageDate) {
    return {
      resolved: false,
      reason: "passageDate is required for general appropriation acts (takes effect from passage)",
      missingInputs: ["passageDate"],
    };
  }

  return {
    resolved: true,
    date: session.passageDate,
    ruleId: "va-1-214-C-default",
    citation: "Va. Code § 1-214(C)",
    packVersion: PACK_VERSION,
  };
}

function deriveRegularSession(session: SessionMetadata): EffectiveDateResult {
  if (session.specifiedDate) {
    return {
      resolved: true,
      date: session.specifiedDate,
      ruleId: "va-1-214-A-specified",
      citation: "Va. Code § 1-214(A)",
      packVersion: PACK_VERSION,
    };
  }

  if (!session.adjournmentDate) {
    return {
      resolved: false,
      reason: "adjournmentDate is required for regular session acts",
      missingInputs: ["adjournmentDate"],
    };
  }

  const adj = new Date(session.adjournmentDate + "T12:00:00Z");
  const july1 = new Date(Date.UTC(adj.getUTCFullYear(), 6, 1));

  if (july1 <= adj) {
    const nextJuly1 = new Date(Date.UTC(adj.getUTCFullYear() + 1, 6, 1));
    return {
      resolved: true,
      date: formatDate(nextJuly1),
      ruleId: "va-1-214-A-default",
      citation: "Va. Code § 1-214(A)",
      packVersion: PACK_VERSION,
    };
  }

  return {
    resolved: true,
    date: formatDate(july1),
    ruleId: "va-1-214-A-default",
    citation: "Va. Code § 1-214(A)",
    packVersion: PACK_VERSION,
  };
}

function deriveSpecialSession(session: SessionMetadata): EffectiveDateResult {
  if (session.specifiedDate) {
    return {
      resolved: true,
      date: session.specifiedDate,
      ruleId: "va-1-214-B-specified",
      citation: "Va. Code § 1-214(B)",
      packVersion: PACK_VERSION,
    };
  }

  if (!session.adjournmentDate) {
    return {
      resolved: false,
      reason: "adjournmentDate is required for special session acts",
      missingInputs: ["adjournmentDate"],
    };
  }

  const adj = new Date(session.adjournmentDate + "T12:00:00Z");
  const adjMonth = adj.getUTCMonth();
  const adjYear = adj.getUTCFullYear();
  const targetMonth = adjMonth + 4;
  const targetYear = adjYear + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;

  const firstDay = new Date(Date.UTC(targetYear, normalizedMonth, 1));

  return {
    resolved: true,
    date: formatDate(firstDay),
    ruleId: "va-1-214-B-default",
    citation: "Va. Code § 1-214(B)",
    packVersion: PACK_VERSION,
  };
}
