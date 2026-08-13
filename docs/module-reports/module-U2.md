MODULE U2 COMPLETE — Evaluation UI (Screens 1-3)

Library decision

  Searched: Remix (MIT, full-stack framework), Astro (MIT, content framework),
  SvelteKit (MIT, full-stack framework).

  Adopted Next.js 15 + React 19 + Tailwind CSS v4. Next.js is the standard
  React framework with App Router, server/client components, and built-in API
  proxy. Tailwind v4 uses import-based setup — no config file. All dependencies
  MIT or Apache-2.0.

  New dependencies:
    next 15.5.23 (MIT)
    react 19.1.0 (MIT)
    react-dom 19.1.0 (MIT)
    tailwindcss 4.1.11 (MIT)
    @tailwindcss/postcss 4.1.11 (MIT)
    @types/react 19.1.8 (MIT)
    @types/react-dom 19.1.6 (MIT)
    @types/node 22.16.4 (MIT)
    typescript 5.8.3 (Apache-2.0)

Gate results

  Upload real bill end to end: PASS
    HB 1456 uploaded, analyzed, findings retrieved.
    dvId: 4301494d-f6f1-4841-8a14-05338db74bb1

  Stage counts match API exactly: PASS
    Fixture run:
      parsed:      36 provisions
      scanned:     47 candidates, 1 suppressed
      proposed:    24 spans
      verified:    24 anchored, 0 rejected
      parsedDates: 11 understood, 13 failed
      resolved:    6 computed, 5 need trigger
      routed:      6 exception_review, 18 blocked

    Live model run (claude-sonnet-4-6):
      parsed:      36 provisions
      scanned:     47 candidates, 1 suppressed
      proposed:    24 spans
      verified:    24 anchored, 0 rejected
      parsedDates: 10 understood, 14 failed
      resolved:    6 computed, 4 need trigger
      routed:      6 exception_review, 18 blocked

    API proxy verified: findings via localhost:3001 match backend exactly.

  Rejected span visible: PASS (synthetic verification)
    HB 35 uploaded with live model. 23 proposals, all anchored — model did
    not fabricate "within five business days of such placement" on this run.
    Inserted synthetic anchor_result (anchored=false, reason=
    fuzzy_ceiling_exceeded) for the known fabrication. API returned it as a
    rejected span. Frontend rendered it as amber-bordered card with verbatim
    quote and human-readable reason. Synthetic record deleted after
    verification.

    See follow-up note in 00-review-v1.md re: fabrication stochasticity.

  Document text escaped: PASS
    Uploaded document containing <script>alert('xss')</script> and
    <img src=x onerror=alert(1)>. Pipeline extracted temporal expressions
    only — HTML injection content was not surfaced. grep -rn
    'dangerouslySetInnerHTML' web/app/ web/lib/ returns zero results. All
    document text renders as JSX text expressions, which React auto-escapes.

  FixtureModelGateway remains default: PASS
    ```
    // src/main.ts:139
    logger.info("no MODEL_PROVIDER configured — using fixture model gateway");
    ```
    Live model activates only when MODEL_PROVIDER and MODEL_API_KEY are set.

Screens implemented

  Screen 1 — Upload (web/app/page.tsx)
    Drag-and-drop zone, file input (PDF/DOCX/text), legal identity fields
    (jurisdiction, session, type, number, stage). detectIdentity() parses
    bill type/number from filename. Submits to /api/v1/documents/upload,
    navigates to /analyze/{dvId}.

  Screen 2 — Analysis stream (web/app/analyze/[dvId]/page.tsx)
    SSE consumption via ReadableStream reader. Each stage renders with
    checkmark icon, label, and formatted counts. RejectedBadge shows
    rejection count on the verified stage. Pulsing indicator while
    streaming. "View findings" button on completion.

  Screen 3 — Findings (web/app/findings/[dvId]/page.tsx)
    SummaryBar: total, resolved, unresolved, rejected counts.
    CoverageSection: provision examination stats with caveat.
    RejectedSpansSection: amber-bordered cards with verbatim quote and
    human-readable reason.
    LaneGroup + FindingCard: findings grouped by lane in order:
    exception_review, quick_confirmation, straight_through, blocked.
    FindingCard: verbatim quoted text in blockquote, resolved date with
    citations OR plain-English unresolved reason. Same visual weight
    for resolved and unresolved (neutral gray badges).

  Presentation layer (web/lib/format.ts)
    formatUnresolvedReason: maps API fields to plain English.
    formatDate: ISO to "September 29, 2026".
    formatStageLabel, formatStageCounts: human-readable stage rendering.
    formatLane: lane codes to descriptions.
    formatRejectionReason: anchor failure reasons to plain English.
    formatKind: underscores to spaces.
    No domain logic — formatting only.

Follow-up findings (recorded in 00-review-v1.md)

  1. Fabrication is stochastic. The model produced "within five business
     days of such placement" on one HB 35 run and not on another, same
     prompt and model. Single runs cannot measure hallucination rate.

  2. Model over-extraction is an unmodelled precision problem. 6 of 24
     live-model proposals were fragments of expressions already proposed
     whole. Fixtures never produced this behavior.

  3. Grammar gap: "submitted by <date>" fails because grammar requires
     "by" at position 0. Fixed in grammar version 1.2.0.

  4. Over-extraction suppression: strict substring containment within one
     segment now suppresses fragments. Anchorer version 1.1.0.
