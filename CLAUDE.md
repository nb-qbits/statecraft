# PolicyAction

Converts legislative documents into deadline records where every date traces to
quoted source text and a cited rule of law. The system refuses to produce a date
it cannot prove.

## Read before doing anything

Before implementing any module, search for existing open-source solutions. Report what you found and why you're building rather than adopting.

## Before implementing any module

Search for existing open-source solutions first. In the module report,
state what you found, what you're adopting, what you're building, and why.
Permitted licences: MIT, Apache-2.0, BSD, ISC.

- `docs/02-implementation-brief.md` — the standing brief. Governs every module.
- `docs/01-architecture.md` — why the design is this way.
- `docs/03-reuse-analysis.md` — what to reuse, what to build, licence policy.

Re-read the implementation brief at the start of each module.

## Operating mode

Work one module at a time, in the order given in the brief. Within a module,
proceed without asking. At the module boundary, run the gate checks, produce the
module report, and STOP. Do not start the next module.

## Non-negotiable

1. Never weaken a test, delete an assertion, skip a test, or loosen a threshold
   to get green output. If a test is wrong, say so in the report.
2. Never write a fallback that produces a value when verification fails.
   Failure produces an explicit failure state.
3. The model emits pointers (segmentId + quoted text), never values.
4. Anchoring proves a quote exists. It does not prove the quote supports the
   claim. Never name anything as though it does.
5. The support evaluator may reject or downgrade. It can never approve.
6. Every resolved date carries its rule IDs and statutory citations.
7. Screening produces `screened_no_candidate`, never a certification of absence.
8. Nothing becomes authoritative without a human decision.
9. Module reports must quote the actual implementing lines for each gate claim,
with file and line number — not describe them. A claim without quoted code
is not evidence.

## Scope

Build only what the current module specifies. The brief's out-of-scope list is
binding. If a module seems to require something on it, stop and report.

## Commands

- `npm run dev` / `npm test` / `npm run lint` / `npm run typecheck`
- `npm run db:migrate` — migrations run separately from boot, never on startup
- `docker compose up` — full local stack

## Dependencies

Permitted licences: MIT, Apache-2.0, BSD, ISC.
AGPL and SSPL require explicit approval. Record every new dependency and its
licence in the module report.