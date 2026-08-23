export interface LegalIdentity {
  jurisdiction: string;
  session: string;
  instrumentType: string;
  number: string;
  stage: string;
  chapter: string | null;
  shortTitle?: string;
}

export interface UploadResult {
  documentVersionId: string;
  documentId: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
}

export interface StageEvent {
  stage: string;
  status: string;
  counts: Record<string, number>;
  error?: string;
}

export interface FindingOccurrence {
  occurrenceDate: string;
  adjustedDate: string;
  ruleIds: string[];
  citations: string[];
  sequenceNumber: number;
}

export interface Finding {
  anchorId: string;
  proposalId: string;
  segmentId: string;
  structuralPath: string;
  provisionLabel: string;
  quotedText: string;
  kind: string;
  actor: string | null;
  actorQuotedText: string | null;
  dependsOnDescription: string | null;
  anchored: boolean;
  anchorMethod: string | null;
  anchorFailureReason: string | null;
  originalStart: number | null;
  originalEnd: number | null;
  grammarParsed: boolean;
  grammarFailureReason: string | null;
  parsedExpression: Record<string, unknown> | null;
  referenceEventText: string | null;
  resolved: boolean;
  statutoryDate: string | null;
  adjustedDate: string | null;
  rrule: string | null;
  occurrences: FindingOccurrence[];
  horizon: string | null;
  ruleIds: string[];
  citations: string[];
  packVersion: string | null;
  dateProvenance: "computed" | "generic_default" | "reviewer_asserted" | "verbatim_from_instrument" | null;
  unresolvedReason: string | null;
  missingInputs: string[] | null;
  lane: string;
  laneReasons: string[];
  supportLevel: string;
  refusalKind: string | null;
  bounded: boolean;
  upperBound: string | null;
  contingency: string | null;
  derivationDepth: number | null;
  deterministicChecks: Record<string, unknown> | null;
  status: string;
  stale: boolean;
  staleStages: string[];
}

export interface RejectedSpan {
  quotedText: string;
  reason: string;
}

export interface SuppressedSpan {
  quotedText: string;
  segmentId: string;
  reason: string;
  containedBy: string | null;
}

export interface EngineVersions {
  current: Record<string, string>;
  staleStages: string[];
}

export interface FindingsResponse {
  legalIdentity: LegalIdentity;
  findings: Finding[];
  coverage: {
    totalSegments: number;
    withCandidates: number;
    screenedNoCandidate: number;
    needsSweep: number;
  };
  laneSummary: Record<string, number>;
  rejectedSpans: RejectedSpan[];
  suppressedSpans: SuppressedSpan[];
  engineVersions?: EngineVersions;
}

export async function uploadDocument(
  file: File,
  identity: LegalIdentity,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("legalIdentity", JSON.stringify(identity));

  const res = await fetch("/api/v1/documents/upload", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: { code?: string; message?: string } } | null = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const code = parsed?.error?.code;
    const message = parsed?.error?.message ?? `Upload failed (${res.status})`;
    const err = new Error(message);
    if (code) (err as Error & { code: string }).code = code;
    throw err;
  }

  return res.json();
}

export async function* streamAnalysis(
  dvId: string,
  signal?: AbortSignal,
  options?: { forceReparse?: boolean },
): AsyncGenerator<StageEvent> {
  const qs = options?.forceReparse ? "?forceReparse=true" : "";
  const res = await fetch(`/api/v1/documents/${dvId}/analyze${qs}`, {
    method: "POST",
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analysis failed (${res.status}): ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;
      for (const part of parts) {
        if (part.startsWith("data: ")) {
          const event: StageEvent = JSON.parse(part.slice(6));
          yield event;
          if (event.stage === "complete" || event.status === "failed") {
            reader.cancel();
            return;
          }
        }
      }
    }

    if (buffer.startsWith("data: ")) {
      yield JSON.parse(buffer.slice(6));
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function checkAnalysisReady(dvId: string): Promise<boolean> {
  const res = await fetch(`/api/v1/documents/${dvId}/findings`);
  if (!res.ok) return false;
  const data: FindingsResponse = await res.json();
  return data.findings.length > 0
    || data.coverage.screenedNoCandidate > 0
    || data.coverage.withCandidates > 0;
}

export async function supplyInput(
  dvId: string,
  anchorId: string,
  reviewerId: string,
  edits: Record<string, unknown>,
): Promise<{ event: unknown; records: unknown[] }> {
  const res = await fetch(`/api/v1/documents/${dvId}/anchors/${anchorId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `supply-${anchorId}-${Date.now()}`,
    },
    body: JSON.stringify({
      action: "edit_and_accept",
      reviewerId,
      edits,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = "This finding is out of date — refresh and try again.";
    try {
      const body = JSON.parse(text);
      if (body?.error?.message) message = body.error.message;
    } catch { /* use default */ }
    throw new Error(message);
  }

  return res.json();
}

export async function editRecordDate(
  dvId: string,
  anchorId: string,
  reviewerId: string,
  deadlineDate: string,
): Promise<{ event: unknown; record: unknown }> {
  const res = await fetch(
    `/api/v1/documents/${dvId}/anchors/${anchorId}/record`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `edit-${anchorId}-${Date.now()}`,
      },
      body: JSON.stringify({ reviewerId, deadlineDate }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    let message = "Failed to update date.";
    try {
      const body = JSON.parse(text);
      if (body?.error?.message) message = body.error.message;
    } catch { /* use default */ }
    throw new Error(message);
  }

  return res.json();
}

export interface UserInfo {
  userId: string;
  plan: string;
  trackedBills: number;
  billLimit: number;
  calendarConnected: boolean;
  calendarProvider: string | null;
}

export async function fetchUserInfo(): Promise<UserInfo> {
  const res = await fetch("/api/v1/user/me");
  if (!res.ok) throw new Error("Failed to fetch user info");
  return res.json();
}

export async function submitWaitlist(
  email: string,
  trigger: "bill_limit" | "calendar_sync",
): Promise<{ entryId: string }> {
  const res = await fetch("/api/v1/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, trigger }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Waitlist submit failed: ${text}`);
  }
  return res.json();
}

export async function syncBillTracking(
  dvIds: string[],
): Promise<{ trackedBills: number; added: number }> {
  const res = await fetch("/api/v1/user/bills/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dvIds }),
  });
  if (!res.ok) return { trackedBills: dvIds.length, added: 0 };
  return res.json();
}

export async function archiveBill(dvId: string): Promise<void> {
  const res = await fetch(`/api/v1/user/bills/${dvId}/archive`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to archive bill");
}

export async function syncCalendar(
  dvId: string,
): Promise<{ synced: boolean; created: number; updated: number; deleted: number }> {
  const res = await fetch(`/api/v1/calendar/sync/${dvId}`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar sync failed: ${text}`);
  }
  return res.json();
}

export async function fetchCalendarSyncStatus(
  dvId: string,
): Promise<{ connected: boolean; provider?: string; synced: boolean; eventCount: number }> {
  const res = await fetch(`/api/v1/calendar/sync/${dvId}/status`);
  if (!res.ok) return { connected: false, synced: false, eventCount: 0 };
  return res.json();
}

export interface ReResolveResult {
  documentVersionId: string;
  status: string;
  previousVersions?: { grammar: string; resolver: string };
  currentVersions?: { grammar: string; resolver: string };
  before: { resolved: number; unresolved: number };
  after: { resolved: number; unresolved: number };
  conflicts: Array<{
    conflictId: string;
    anchorId: string;
    previousStatutoryDate: string;
    newStatutoryDate: string | null;
    newResolved: boolean;
    status: string;
  }>;
}

export async function reResolve(dvId: string): Promise<ReResolveResult> {
  const res = await fetch(`/api/v1/documents/${dvId}/re-resolve`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Re-resolve failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchFindings(
  dvId: string,
): Promise<FindingsResponse> {
  const res = await fetch(`/api/v1/documents/${dvId}/findings`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Findings fetch failed (${res.status}): ${text}`);
  }
  return res.json();
}
