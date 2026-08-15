# Build the New UI from the Docket Design Handoff

You have been given: `README.md`, `Docket.dc.html`, and a `screenshots/` folder from Claude Design. This is a design reference, not code to copy — recreate it in this codebase's real stack (Next.js, existing component patterns) wired to the real API.

Read the design README in full before writing any component. It documents the three-state task model, the provenance drill-down, the mobile breakpoint behavior, and the new screens (Login, Admin). Follow it closely — it is high-fidelity and the copy, states, and interactions in it are intentional.

---

## 0. Build as new, do not edit in place

Build this in a new route structure. Do not modify the existing `web/app/plan/[dvId]/` or `web/app/findings/[dvId]/` pages — reference them only to see what data they read and how, since the new UI must show the same substance in the new design. Once the new UI is verified working end to end, we will decide together whether to retire the old pages.

---

## 1. Critical: field mapping (do not guess this)

The design's task state model uses `determination: 'computed' | 'reviewer' | 'unresolved'`. This does not match the API's field names directly. Map explicitly:

| Design field | Real API field(s) | Notes |
|---|---|---|
| `determination: 'computed'` | `dateProvenance === 'computed'` AND `resolved === true` | Both conditions, not just one |
| `determination: 'reviewer'` | `dateProvenance === 'reviewer_asserted'` AND `resolved === true` | |
| `determination: 'unresolved'` | `resolved === false` | Regardless of `dateProvenance` |
| `computedNote` | Derived from `ruleIds` + `citations` | Format as e.g. "Va. Code § 1-214(A) · Va. Code § 1-210(E)" |
| `reviewerName` | The reviewer identity on the review event | |
| `unresolvedReason` | `unresolvedReason` field, or derive from `missingInputs` | Must be the SPECIFIC reason already returned by the API — do not write a generic message |
| `inputAsk` | Derived from `referenceEventText` where present | "When did {referenceEventText} occur?" — if referenceEventText is null, use the honest fallback: "This document does not name what starts this clock." |
| `citation` (shown in provenance drill-down step 1) | The anchored quote's `provisionLabel` | |

**If a design field has no clean real-data source, do not fabricate a plausible-looking value.** Stop and report the gap — do not invent copy to fill it.

**One design assumption to correct:** the design's `computedNote` example is "Enactment date + 24 months · computed" — a single short string. Our real citations can be multi-part (e.g. a recurring obligation may carry both a §1-214 and a §1-210(E) citation, or an occurrence-specific rollover note). Render the full citation list in the provenance drill-down (step 3), and use a shortened first-citation form for the collapsed one-line summary if needed. Do not truncate silently — if there's more than one citation, the collapsed summary should still be accurate, e.g. "AI found · verified · computed (2 rules)".

---

## 2. What is real vs. what stays deferred

Build these against real data now:

- Login screen UI — but stub the actual OAuth flow behind a clearly-marked TODO. Do not attempt real Google OAuth in this pass; that is a separate module (see §5).
- Dashboard, Bill Detail (List + Timeline), Calendar, Account — all wired to real findings/plan data via the API.
- The three-state task card and provenance drill-down — wired per the mapping table above, on every screen that renders a task.
- The "+ Add date" inline action — wire to the existing supply-input endpoint (the one using `anchorId`, per the H-8 fix). Confirm it works after the mapping in §1 correctly identifies unresolved tasks.
- "Needs input" as a first-class status everywhere the design specifies (stat card, filter, status bar segment, dedicated list under Calendar/Timeline).
- Mobile breakpoint behavior exactly as documented — implement with real CSS breakpoints (media queries / Tailwind responsive classes), not the prototype's JS `viewportWidth` hack. Use the same 760px threshold and the same per-component behavior described in the README.

Build these as UI shells only, clearly non-functional, this pass:

- **Admin console** — build the screen and tables exactly as designed, but populate from real queries where trivially available (real user count, real document count, real recent documents) and placeholder/zero where not (no real per-user plan data exists yet — show the table structure with an honest empty or placeholder state, not fabricated rows). Do not build user management actions.
- **"Sync to calendar" button** — wire to the existing ICS export endpoint (real, already built) rather than a real Google/Outlook calendar API sync. Label it accurately if the design's copy implies live sync — e.g. "Download .ics" if that's what it actually does, or note the gap if the design's copy says "Sync" and expects push integration.
- **Pro/paywall/upgrade** — build the modal and copy as designed, but the "Upgrade to Pro" action does nothing real (no Stripe). Leave a clear TODO. Do not flip any real plan state.
- **Account role badge** — hardcode "Reviewer" for now; no real role system exists yet.

---

## 3. Do not lose these from the old UI

The old plan/findings pages already do some things correctly that must carry over:

- Coverage-before-findings, with the exact caveat language: "This is processing coverage — not a claim about how many deadlines exist in this document." The new design doesn't explicitly show this screen — find the right place for it (likely folded into the stat row or a coverage note on Bill Detail) and do not drop it.
- The jurisdiction/pack-not-found honest degradation (if Module numbers 14/15 work has landed by the time you do this) — a task with no jurisdiction pack available must render as `unresolved` with that specific reason, using the same card, not a special-cased broken state.
- Never render raw error objects to the user, anywhere. Every error path gets human copy.

---

## 4. Gate

Run against real data — at minimum HB 35 and CHAPTER 1126 (or whatever real bills currently produce the most complete finding set), live through the browser:

- All three task states render correctly per the mapping table, with real data, on Dashboard, Bill Detail (both List and Timeline), and Calendar.
- Provenance drill-down expands correctly for a computed, a reviewer-supplied, and an unresolved task, each showing accurate attribution.
- "+ Add date" on an unresolved task successfully resolves it via the real API and the card updates live to state B.
- Mobile breakpoint verified at <760px width for: sidebar → bottom tab bar, stat row reflow, Timeline hidden (List forced), Calendar day-cell dots, full-screen modals.
- Admin console renders with real counts where available, honest placeholders where not.
- Login screen renders; clicking through goes to Dashboard (no real OAuth yet, per §5).

Paste actual screen contents/screenshots, not descriptions, for each of the above.

---

## 5. Explicitly out of scope for this pass

State these back to me as confirmed-deferred in your completion report, not silently skipped:

- Real Google OAuth
- Real Stripe/payment processing
- Real admin user-management actions
- Real calendar push-sync (Google/Outlook APIs)
- Any new role/permission enforcement beyond the cosmetic badge

Do not build partial versions of these — a half-built OAuth flow or a fake-but-clickable payment form is worse than a clearly labeled TODO.
