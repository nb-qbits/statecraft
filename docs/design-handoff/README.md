# Handoff: Docket — Legislative Deadline Dashboard

## Overview
Docket is a freemium web app for congressional staff and policy analysts. A user uploads a bill (file or URL), the app extracts its statutory deadlines, and lays them out as a dashboard: what's due, by whom (which agency/office), and by when — with overdue/needs-input/due-soon/upcoming/completed states. Free tier: up to 3 bills tracked, dashboard/calendar viewing only. Paid tier ("Pro"): unlimited bills + real calendar sync (Google/Outlook/ICS).

## About the Design Files
The bundled file (`Docket.dc.html`) is a **design reference** built as a single interactive HTML prototype (a "Design Component" — plain React-like class component with inline styles, no build step). It is **not production code to copy directly**. Recreate its screens, states, and interactions in the target codebase's actual stack (React/Next.js, Vue, native, etc.), using that codebase's real data layer, auth, payments, and component library. All data (bills, tasks, dates, agencies, admin tables) is **hardcoded sample data** — there is no real document-parsing/extraction backend, auth provider, or payment processor behind it.

## Fidelity
**High-fidelity.** Colors, type, spacing, copy, and interaction states are intentional and should be reproduced closely. Exceptions: no real file upload/parsing, no real OAuth, no real payments, no real calendar API integration, and the mobile breakpoint is implemented via a JS `viewportWidth` state + a single ~760px cutoff (not real CSS media queries — see **Note on responsive implementation** below) which a production build should replace with proper CSS breakpoints.

## The core product claim (why this revision exists)
Every deadline shown must trace to a quoted line of the source bill, and every **computed** date must cite the specific legal rule that produced it. The AI only *finds* candidate deadlines — it never computes a date; a deterministic system does that. Nothing becomes an accepted deadline without either deterministic computation or a person confirming it. Unresolved items are not failures — they are real obligations whose date depends on information the source document doesn't state. This claim now has a visual home via the three-state task model below.

## The task/finding card — three states
Every task, everywhere it appears (Dashboard "Who's accountable," Bill Detail List/Timeline, Calendar, Call-prep modal), carries one of three `determination` values:

**A — `computed`.** A date the system derived deterministically. Rendered like a normal dated task (date, relative-days label, colored status pill). The *citation for the computation itself* (e.g. "Enactment date + 24 months · computed", "Explicit date stated in statute") is intentionally **not shown by default** — it lives one level down, in the provenance drill-down (see below), so it never clutters the default card.

**B — `reviewer`.** A date a person entered because it wasn't automatically computable. Same date/status-pill layout as computed, **plus an always-visible small gold tag** ("Entered by {name}", person icon, gold `#A67326` text) directly above the date — this is a hard requirement: reviewer-supplied dates must never look identical to computed ones.

**C — `unresolved`.** No date. Rendered with the **same visual weight** as dated tasks (same row height/card, not greyed out or collapsed):
- The date/pill area is replaced by a specific reason in violet (`#5B5B8C` on `#EFEDF7`), e.g. *"Runs from an event this bill does not date: the state's prior strategy submission"* or *"Recurring obligation — needs a start date"* — never a generic "unresolved" label.
- A small **"+ Add date"** inline action expands to a `<input type="date">` + Save/Cancel, labeled with the specific question being asked (e.g. *"When was the state's prior Carbon Reduction Strategy submitted?"*). Saving promotes the task to state B (`reviewer`, with `reviewerName: 'You'`) live, in place, everywhere that task is rendered.
- A **"Needs input"** status (violet) is a first-class citizen alongside Overdue/Due soon/Upcoming/Completed: it's a dashboard stat card, a Bill Detail status filter, a slice of every 5-segment status bar, and (since unresolved tasks have no date) a **"Needs your input"** list rendered below the Calendar grid and below the Bill Detail Timeline chart instead of being silently absent.

Sample data ships with **4 unresolved / 3 reviewer-supplied / 14 computed** tasks across the 3 demo bills — an illustrative ratio, not a hard rule; tune to whatever the real extraction pipeline actually produces.

## Provenance drill-down (reusable component)
Every task card has a one-line, collapsed-by-default affordance: a small chevron + summary text —
- `AI found · verified · computed` (state A)
- `AI found · verified · entered by {name}` (state B)
- `AI found · verified · needs input` (state C)

Clicking it expands a compact, calm (not a debug log) attributed chain, 3–4 rows of `{actor, label, result}`:
1. **AI** — Identified candidate obligation — "Found matching phrase in {citation}"
2. **System** — Verified quote against source text — "Exact match confirmed"
3. **System** — Computed date / Attempted computation — the computation note, or the blocking reason
4. *(state B only)* **Person** — "Date entered by {name}" — the date entered

Build this once and reuse it everywhere a task renders — the prototype's `provenanceFor(task)` / `provenanceSummary(task)` functions generate the chain from the task's own fields (no per-task hand-authoring needed) and are a reasonable model for a real component's props.

## "Who's accountable" and Call prep modal
Agency accountability cards (Dashboard) and the "Call prep" modal (opened by clicking an agency card) now aggregate all three states. Ring/priority order for the agency urgency indicator: **overdue > needs-input > due-soon > upcoming > all caught up**. The Call-prep modal lists unresolved items inline with **"Ask them: {inputAsk}"** so a staffer calling that agency knows exactly what to request, alongside the normal dated asks.

## Reworked Processing screen
Five stages, restaged around the real pipeline (previous version's stage names were too abstract):
1. Parsing the document
2. Scanning for deadline language
3. AI identifying candidate obligations
4. Verifying each quote against the source text
5. Computing dates under applicable rules

**Note on timing**: the prototype still simulates stages on a fixed interval (900ms/stage) for demo purposes. Production should drive this from real streamed backend events (SSE/WebSocket), one stage completing whenever its real count is ready — do not hardcode timing; stages may take a few seconds each.

## New screens

### Login
Full-page, no sidebar, centered card on the navy brand color. Single primary action "Continue with Google" (navy button, Google glyph). A styled but non-functional "Sign in with email & password" secondary link sits below. This is now the default entry view — clicking through goes to Dashboard. Production needs real OAuth (Google) plus whatever secondary auth method is decided.

### Admin
A visually distinct internal console — same sidebar width and structure as the main app, but the accent color swaps from gold (`#C8983E`) to the existing "upcoming" status blue (`#4C6D96`) to signal "admin mode" without introducing a new hue. Contains: 3 aggregate stat cards (total users, total documents processed, documents this week), a Users table (name, email, plan, bills tracked, joined date), and a Documents table (bill number, jurisdiction, uploaded by, date, status — with status color-coded). Reachable via a small "Admin console" link at the bottom of the main sidebar; "Exit admin" returns to Dashboard. All data is placeholder — the layout/hierarchy is the point, not the numbers.

### Account — role badge
A small gold "REVIEWER" pill badge sits next to "Current plan" on the existing plan card — intentionally subtle, not a new section, since a fuller role/permissions system is coming later.

## Mobile breakpoint behavior
Implemented via a single JS-computed `isMobile` flag (`viewportWidth < 760`, tracked via a `resize` listener) rather than CSS media queries, because this prototype's styling is 100% inline (a constraint of the design-tool environment it was built in — **a real codebase should replace this with actual CSS breakpoints**, keeping the same visual thresholds/behavior):

- **Sidebar** → becomes a fixed bottom tab bar (4 icon+label buttons: Dashboard/Calendar/Add/Account) at `<760px`; the desktop left sidebar (with logo, plan meter, admin/sign-out links) is hidden entirely on mobile. Main content gets bottom padding to clear the bar.
- **Stat row** → `repeat(7,1fr)` desktop → `repeat(2,1fr)` mobile (now 7 cards: Bills, Agencies, Total tasks, Overdue, Needs input, Due within 21d, Completed).
- **Agency accountability grid** → auto-fill grid desktop → single column mobile.
- **Bill Detail Timeline (Gantt)** → the Timeline toggle option is **hidden on mobile**; List view (already a vertical, agency-grouped chronological list) is forced. A small note explains Timeline is available on larger screens. This was the chosen approach over a horizontally-scrollable Gantt, per the "pick one" guidance — simpler to implement correctly and List view already serves the same information chronologically.
- **Calendar** → day cells show up to 4 small colored **dots** instead of agency-name pills on mobile; the day detail panel (280px side panel on desktop) renders full-width **below** the grid on mobile instead of beside it (`flex-direction: column` vs `row`).
- **Modals** (Paywall, Call prep) → full-screen sheets on mobile: `align-items: flex-end`, `width: 100%`, top corners rounded only (`20px 20px 0 0`), `max-height: 85vh` — vs. a centered, max-420–520px card on desktop.
- **Top bar** → tighter padding and smaller title size (20px vs 25px) on mobile.

## What stayed unchanged
The navy (`#16233F`) / gold (`#C8983E`) palette, the `-apple-system`/Public Sans type stack and scale, card radii, the count-up stat animation, the agency urgency-ring concept, the bill filter chip pattern, the Dashboard/Calendar/Add-a-bill/Account nav structure, and the overall calm/professional tone — all carried through every new and revised screen per the revision brief.

## New/changed design tokens
- **Needs-input violet**: text/dot/ring `#5B5B8C`, background `#EFEDF7`, bar-segment `#8377B0`.
- **Reviewer-supplied tag**: gold `#A67326` (reuses the existing "due soon" gold, applied here to the provenance tag specifically — not a new hue).
- **Admin accent**: reuses existing "upcoming" blue `#4C6D96` in place of gold, sidebar-wide, as the sole "admin mode" signal.
- Mobile threshold: `760px` (single breakpoint).
- Everything else matches the token list from the original handoff (see below).

**Colors (unchanged core)**: Navy `#16233F` · Gold `#C8983E` · Background `#F5F5F7` · Card `#FFFFFF` / border `#E5E5EA` · Text primary `#1D1D1F` / secondary `#6E6E73` / tertiary `#86868B` / placeholder `#AEAEB2` · Overdue `#B8452F`/`#FBEAE5` · Due soon `#A67326`/`#FBF1DF` · Upcoming `#3C5A82`/`#EAF0F8` · Completed `#3F6B54`/`#E9F2EC`.

**Typography**: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Public Sans', sans-serif` for headings/numbers (600–700 weight, −0.02 to −0.03em tracking, `tabular-nums` on stat figures); `'Public Sans'` (400–600) for body/UI.

**Radii**: 7–10px controls, 10–12px cards, 20px modals (0 on mobile's bottom-sheet top-only rounding), pill for chips/status badges.

## State Management
Extends the original flat-state model with:
- Each task object: `{key, agency, obligation, citation, determination: 'computed'|'reviewer'|'unresolved', due, completed, computedNote, reviewerName, unresolvedReason, inputAsk}`
- `provenanceOpen: {[taskKey]: bool}` — per-task drill-down expand state
- `inputOpenKey`, `inputDraftValue` — the single active "Add date" inline form (only one open at a time)
- `viewportWidth` — updated on window resize, drives `isMobile`
- `view` now includes `'login'` (default) and `'admin'` alongside the existing 6 views
- `isPro`, `calendarSynced` — unchanged from the previous revision

`confirmDateInput(billId, taskKey)` mutates the matching task in place: sets `determination: 'reviewer'`, `due` to the entered value, `reviewerName: 'You'` — demonstrating the live state-machine transition from C → B. Production would instead call a real API and optimistically/pessimistically update from the response.

## Assets
No external image assets. Icons are hand-drawn inline SVG (stroke-based, `currentColor`) plus one inline Google "G" glyph path on the Login button — replace with your icon system/OAuth SDK's official Google button asset in production (do not ship a hand-drawn Google glyph to real users — use Google's official sign-in button assets for brand compliance).

## Sample Data Note
The 3 sample bills (Infrastructure Investment and Jobs Act / H.R. 3684, CHIPS and Science Act / H.R. 4346, FAA Reauthorization Act of 2024 / H.R. 3935) are real, well-known bills used for realistic demo content, but their task obligations, agencies, due dates, computation notes, and unresolved reasons are **illustrative approximations, not verified legal fact or real extraction output** — replace with real pipeline output once it exists. Admin console users/documents are entirely fictional placeholder data.

## Files
- `Docket.dc.html` — the full interactive prototype (single file, inline styles, plain JS class component; open directly in a browser).
- `screenshots/` — reference captures of key screens (see filenames for which screen/state each shows).
