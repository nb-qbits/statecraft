# PolicyAction — Development Kickoff Runbook

From empty GitHub account to Claude Code building Module 0. Roughly two hours of setup.

---

## Step 0 — Prerequisites (20 minutes)

Install and verify:

```bash
node --version      # 20 or 22 LTS
docker --version    # Docker Desktop running
python3 --version   # 3.11+ (for the parser sidecar)
gh --version        # GitHub CLI, optional but assumed below
```

Accounts and keys to obtain now:

| What | Where | Why |
|---|---|---|
| GitHub account | github.com | Repo |
| Claude Code access | Your Claude plan or Anthropic Console | The build agent |
| Model provider key | Anthropic, or OpenRouter for multi-provider | Span proposal calls |
| Open States API key | `open.pluralpolicy.com` | Legislative metadata |

Do **not** put any of these in the repo. They go in `.env`, which is gitignored from the first commit.

---

## Step 1 — Create the repository (10 minutes)

```bash
gh repo create policyaction --private --clone
cd policyaction
```

Create the skeleton:

```bash
mkdir -p docs .claude src/modules src/platform packs/us-va/v1 \
         fixtures/documents fixtures/gold sidecar/parser scripts
```

Why these:

- `docs/` — the specification documents. Claude Code reads them.
- `.claude/` — permission settings, committed so the policy travels with the repo.
- `src/modules/` — domain logic. No framework imports allowed here.
- `src/platform/` — adapters: storage, database, model gateway, queue.
- `packs/us-va/v1/` — Virginia jurisdiction rules as versioned data.
- `fixtures/` — test documents and gold annotations.
- `sidecar/parser/` — the Python parsing service.

---

## Step 2 — Add the specification documents (5 minutes)

Copy in the four documents produced so far:

```
docs/
  01-architecture.md          # PolicyAction Revised Architecture
  02-implementation-brief.md  # Claude Code Implementation Prompt
  03-reuse-analysis.md        # Open Source Reuse Analysis
  04-component-map.svg        # The component diagram
```

Commit before anything else:

```bash
git add docs && git commit -m "docs: architecture, implementation brief, reuse analysis"
```

This matters. The specification exists in version control *before* the first line of code, so every later change to it is visible in history.

---

## Step 3 — Write CLAUDE.md (15 minutes)

`CLAUDE.md` at the repo root is loaded automatically at the start of every Claude Code session. It is **advisory** — instructions the model reads as intent. Keep it short and pointed; the detail lives in `docs/`.

Create `CLAUDE.md`:

```markdown
# PolicyAction

Converts legislative documents into deadline records where every date traces to
quoted source text and a cited rule of law. The system refuses to produce a date
it cannot prove.

## Read before doing anything

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
```

---

## Step 4 — Configure permissions (15 minutes)

`.claude/settings.json` is **mechanical** — the harness enforces it before anything runs. This is what gives you auto-approval on safe work while keeping the dangerous paths gated. Commit it.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npm test*)",
      "Bash(npx vitest*)",
      "Bash(npx tsc*)",
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(docker compose*)",
      "Bash(mkdir*)",
      "Bash(ls*)",
      "Bash(cat*)"
    ],
    "ask": [
      "Bash(npm install*)",
      "Bash(npm uninstall*)",
      "Bash(pip install*)",
      "Bash(git push*)",
      "Bash(gh *)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/*.pem)",
      "Read(./**/credentials*)",
      "Bash(git push --force*)",
      "Bash(rm -rf*)",
      "Bash(curl *)",
      "Bash(wget *)"
    ]
  }
}
```

Two deliberate choices worth understanding:

**`npm install` is on `ask`, not `allow`.** That is the licence policy made mechanical — every new dependency stops and shows you what it is before it enters the tree. This is the single most valuable prompt you will keep.

**`git push` is on `ask`.** Claude Code commits freely; you decide what leaves the machine.

Then create `.claude/settings.local.json` for anything personal, and gitignore it.

Verify inside a session with `/permissions` and `/doctor`.

---

## Step 5 — Baseline files (10 minutes)

`.gitignore`:

```
node_modules/
.next/
dist/
coverage/
.env
.env.*
!.env.example
.claude/settings.local.json
*.log
__pycache__/
.venv/
```

`.env.example` — the shape of the environment, with no real values:

```
DATABASE_URL=postgresql://policyaction:policyaction@localhost:5432/policyaction
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=policyaction-documents
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
MODEL_PROVIDER=anthropic
MODEL_API_KEY=
MODEL_ID=
OPENSTATES_API_KEY=
PARSER_SIDECAR_URL=http://localhost:8000
LOG_LEVEL=info
NODE_ENV=development
```

Commit:

```bash
git add . && git commit -m "chore: repo skeleton, CLAUDE.md, permissions"
```

---

## Step 6 — Set up the gate discipline (10 minutes)

Gates only work if they leave a trace. Two conventions:

**A branch per module.**

```bash
git checkout -b module/00-foundation
```

**A tag at each passed gate.**

```bash
git tag -a gate-00 -m "Module 0: foundation. All gate criteria pass."
```

Optionally protect `main` so modules land through a PR you review. Even solo, this gives you a diff per module rather than a stream of commits.

Create `docs/module-reports/` and save each report as `module-00.md`. These accumulate into the build's audit trail — which is fitting for a product whose whole thesis is provenance.

---

## Step 7 — Start Claude Code (10 minutes)

```bash
npm install -g @anthropic-ai/claude-code
cd policyaction
claude
```

First session, in order:

1. Run `/doctor` — confirms settings load cleanly and nothing was stripped.
2. Run `/permissions` — confirm the allow/ask/deny lists look right.
3. Paste the kickoff prompt below.

**The kickoff prompt:**

```
Read CLAUDE.md, then read docs/02-implementation-brief.md in full, then
docs/03-reuse-analysis.md.

Before writing any code, tell me:
1. Your understanding of the ten invariants, in your own words.
2. Anything in the brief that is ambiguous or that conflicts with itself.
3. Your plan for Module 0 — files you will create and why.

Do not write code yet. I want to check your reading first.
```

**Do not skip this.** The single highest-value thing you can do with an auto-approving agent is verify its comprehension before it has written anything. If its restatement of the invariants is fuzzy, fix `CLAUDE.md` now rather than debugging the consequences in Module 6.

Once the reading looks right:

```
Good. Implement Module 0 only. Run the gate checks, produce the module report
in the specified format, and stop.
```

Consider running that first message in **plan mode** (read-only) so nothing can be written until you have approved the approach.

---

## Step 8 — The per-module loop

Repeat for each of the thirteen modules:

1. **Branch.** `git checkout -b module/NN-name`
2. **Prompt.** *"Re-read docs/02-implementation-brief.md. Implement Module NN only. Stop at the gate."*
3. **Let it run.** No intervention unless it violates the operating mode.
4. **Read the report.** Specifically: did every gate criterion actually pass, or was one restated as passing? Are the adversarial tests real attacks or happy-path tests wearing a costume?
5. **Verify by hand.** Run the manual verification commands from the report yourself. Do not take the report's word for it.
6. **Check the diff for the failure mode that matters:** `git diff --stat` on test files. If test files shrank, find out why.
7. **Tag and merge.** `git tag gate-NN`, merge to `main`, save the report to `docs/module-reports/`.
8. **Next module.**

**When a gate fails:** do not proceed. The whole value of the structure is that a failure surfaces at the boundary rather than three modules later. Fix it in place, or reduce the module's scope explicitly and record the reduction.

---

## Step 9 — Run these in parallel (yours, not Claude Code's)

These do not block Module 0, and all three block later modules. Start them now.

**Probe 1 — Virginia LIS format.** Fetch three target bills from `lis.virginia.gov` or `law.lis.virginia.gov`. What is actually served: structured XML, DOCX, or PDF only? Does anything carry strike/insert markup? *Blocks Module 2. One afternoon.*

**Probe 2 — Docling fidelity.** Run one real bill through Docling in both DOCX and PDF. Does the JSON export carry character offsets? Does the DOCX backend preserve strikethrough and italics? *Blocks Module 2. One afternoon.*

**The manual baseline.** Build the deadline register for three real bills by hand, timed. Produces the Gate 4 baseline, the first draft of the materiality rules, and — more valuable than either — evidence about whether the product is worth building. *Blocks Module 12 and the pilot. One day.*

Deploy Label Studio when you get to annotation. Do not let Claude Code build an annotation UI.

---

## What "done" looks like for the slice

Thirteen tags, `gate-00` through `gate-12`, thirteen module reports in `docs/module-reports/`, and a system where:

```bash
docker compose up
```

then upload a Virginia bill, and get back deadlines where each one shows the quoted source text, the rule that produced the date, and the citation for that rule — with anything unprovable explicitly marked unresolved rather than guessed.

That is the vertical slice. Everything after is widening it.

---

## Reference

- Claude Code settings and permissions: `https://code.claude.com/docs/en/settings`
- Claude Code overview: `https://docs.claude.com/en/docs/claude-code/overview`
