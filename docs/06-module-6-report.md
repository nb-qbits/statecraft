# Module 6 Report — Legal Date Grammar

## Reuse analysis

**Searched:** chrono (MIT), dateparser, LexNLP (AGPL), compromise (MIT), natural (MIT).

**Adopted:** Chevrotain 13.2.0 (Apache-2.0) — parser toolkit for building the grammar.

**Built:** The grammar itself. `docs/03-reuse-analysis.md` states: "General date parsers
(chrono, dateparser, LexNLP) are permissive by design … Chevrotain is the tool; the grammar
is yours." chrono returns best-guess results for ambiguous input — the refusal behaviour IS
the component, so a permissive parser is structurally unsuitable.

## New dependency

| Package | Version | Licence |
|---------|---------|---------|
| chevrotain | 13.2.0 | Apache-2.0 |

## Scope coverage

### In-scope forms (all parse successfully)

| Input | Kind | Key fields |
|-------|------|------------|
| `July 1, 2025` | `fixed_date` | month: 7, day: 1, year: 2025 |
| `December 1, 2026` | `fixed_date` | month: 12, day: 1, year: 2026 |
| `within 30 days` | `relative_duration` | quantity: 30, unit: days, boundKind: within |
| `no longer than seven days` | `relative_duration` | quantity: 7, unit: days, boundKind: no_longer_than |
| `within 24 hours` | `relative_duration` | quantity: 24, unit: hours, boundKind: within |
| `within one working day` | `relative_duration` | quantity: 1, unit: days, dayKind: working |
| `within five business days` | `relative_duration` | quantity: 5, unit: days, dayKind: business |
| `within 30 days after the effective date` | `relative_duration` | preposition: after, referenceEvent: effective_date |
| `every two business days` | `recurrence` | frequency: every, quantity: 2, dayKind: business |

### Adversarial — must fail to parse (all rejected)

| Input | Why rejected |
|-------|-------------|
| `sometime next spring` | Lexer: unrecognised tokens |
| `as soon as practicable` | Lexer: unrecognised tokens |
| `within a reasonable period` | Parser: `a` / `reasonable` / `period` are not valid quantity/timeUnit |
| `30` (bare number) | Parser: no structural frame (within/every/Month) |
| `the first day of the fourth month following adjournment` | Parser: no matching rule (§ 1-214 logic, Module 7) |
| `effective date of this act` | Parser: not a temporal expression — no leading frame |
| `July 2025` (no day) | Parser: fixedDate requires Month NumberLiteral Comma NumberLiteral |
| `01/15/2025` (numeric) | Lexer: `/` is not a recognised token |
| `within days` (no quantity) | Parser: quantity rule requires NumberLiteral or NumberWord |

### `every two business days` — RECURRENCE, not duration

The grammar treats this as `RecurrenceExpression` with `kind: "recurrence"`:

```
src/modules/grammar/parser.ts:43
recurrenceExpression = this.RULE("recurrenceExpression", () => {
    this.CONSUME(Every);
    this.SUBRULE(this.quantity);
    this.OPTION(() => this.SUBRULE(this.dayKind));
    this.SUBRULE(this.timeUnit);
});
```

```
src/modules/grammar/visitor.ts:80
recurrenceExpression(ctx: Record<string, CstNode[]>): TemporalExpression {
    ...
    return { kind: "recurrence", frequency: "every", quantity, unit, dayKind: dayKindVal };
}
```

### `within 24 hours` — hour-scale TimeUnit

The grammar supports `hours` as a `TimeUnit`:

```
src/modules/grammar/types.ts:35-38
export const TimeUnit = {
  hours: "hours",
  days: "days",
} as const;
```

```
src/modules/grammar/lexer.ts:20
export const Hours = createToken({ name: "Hours", pattern: /hours?/i });
```

## Gate claims with quoted code

### G1: Chevrotain grammar, parse-or-fail

The parser is a Chevrotain `CstParser`. If input doesn't match, parsing errors
are captured and returned as explicit failure:

```
src/modules/grammar/parser.ts:11-15
export class TemporalParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }
```

```
src/modules/grammar/parse.ts:43-51
  if (parserInstance.errors.length > 0) {
    const err = parserInstance.errors[0]!;
    const pos = err.token?.startOffset ?? 0;
    return {
      parsed: false,
      reason: err.message,
      position: pos,
    };
  }
```

### G2: INV-5 — input must originate from an anchored span

The parse function requires `AnchoredSpan`, not a bare string. The brand is a
runtime Symbol that cannot be constructed without `createAnchoredSpan`:

```
src/modules/grammar/types.ts:3-10
const anchoredSpanBrand = Symbol("AnchoredSpan");

export interface AnchoredSpan {
  readonly [anchoredSpanBrand]: true;
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
}
```

```
src/modules/grammar/parse.ts:13
export function parseTemporalExpression(span: AnchoredSpan): SpanParseResult {
```

Unit test confirms compile-time rejection:

```
src/modules/grammar/parse.test.ts:230-233
  it("parseTemporalExpression requires AnchoredSpan, not bare string", () => {
    // @ts-expect-error — bare string is not AnchoredSpan
    expect(() => parseTemporalExpression("within 30 days")).toThrow();
  });
```

### G3: Output is typed expression OR explicit parse failure

The `ParseResult` discriminated union has exactly two branches:

```
src/modules/grammar/types.ts:79-81
export type ParseResult =
  | { readonly parsed: true; readonly expression: TemporalExpression }
  | { readonly parsed: false; readonly reason: string; readonly position: number };
```

### G4: No general-purpose date parser used

Zero imports of chrono, dateparser, LexNLP, or any permissive parser:

```bash
$ grep -r "chrono\|dateparser\|LexNLP\|date-fns" src/modules/grammar/
# (no output)
```

### G5: Never a partial or guessed parse

Unrecognised tokens cause lexer errors. Unmatched grammar rules cause parser
errors. Trailing text after a valid parse is rejected:

```
src/modules/grammar/parse.ts:53-64
  if (lexResult.tokens.length > 0) {
    const lastToken = lexResult.tokens[lexResult.tokens.length - 1]!;
    const lastTokenEnd = lastToken.startOffset + lastToken.image.length;
    const remainingText = trimmed.slice(lastTokenEnd).trim();
    if (remainingText.length > 0) {
      return {
        parsed: false,
        reason: `unexpected trailing text: '${remainingText}'`,
        position: lastTokenEnd,
      };
    }
  }
```

### G6: Date validation

Invalid dates (February 30) are caught after parse:

```
src/modules/grammar/parse.ts:68-77
  if (expression.kind === "fixed_date") {
    const { month, day, year } = expression;
    if (year < 1900 || year > 2200) {
      return { parsed: false, reason: `year ${year} out of range`, position: 0 };
    }
    const maxDays = new Date(year, month, 0).getDate();
    if (day < 1 || day > maxDays) {
      return { parsed: false, reason: `day ${day} invalid for month ${month}`, position: 0 };
    }
  }
```

## API verification — HB 35 actual output

```
POST /api/v1/documents/{dvId}/parse-temporal
```

```json
{
  "documentVersionId": "c2f04940-c1cb-493e-b6ed-192cd13db606",
  "grammarVersion": "1.0.0",
  "totalSpans": 5,
  "totalParsed": 5,
  "totalFailed": 0,
  "results": [
    {
      "anchorId": "anc_05eacb97037aeeb329c18e2f9101bed9",
      "segmentId": "seg_4d880a220d2451e2a783b12897411cab",
      "text": "every two business days",
      "parsed": true,
      "expression": {
        "kind": "recurrence",
        "frequency": "every",
        "quantity": 2,
        "unit": "days",
        "dayKind": "business"
      }
    },
    {
      "anchorId": "anc_9b7674f56fdb853c1c15c0e987f883b3",
      "segmentId": "seg_4d880a220d2451e2a783b12897411cab",
      "text": "within one working day",
      "parsed": true,
      "expression": {
        "kind": "relative_duration",
        "quantity": 1,
        "unit": "days",
        "dayKind": "working",
        "preposition": null,
        "referenceEvent": null,
        "boundKind": "within"
      }
    },
    {
      "anchorId": "anc_fd318f991d7eac8df96998c53e0c0630",
      "segmentId": "seg_4d880a220d2451e2a783b12897411cab",
      "text": "within 24 hours",
      "parsed": true,
      "expression": {
        "kind": "relative_duration",
        "quantity": 24,
        "unit": "hours",
        "dayKind": null,
        "preposition": null,
        "referenceEvent": null,
        "boundKind": "within"
      }
    },
    {
      "anchorId": "anc_0098d1057e425a4890f3d212b5c2b7ca",
      "segmentId": "seg_c66620e4300873f44fc5a9085adfea0e",
      "text": "within 30 days",
      "parsed": true,
      "expression": {
        "kind": "relative_duration",
        "quantity": 30,
        "unit": "days",
        "dayKind": null,
        "preposition": null,
        "referenceEvent": null,
        "boundKind": "within"
      }
    },
    {
      "anchorId": "anc_d8909e712e21125db63203cd6826ab54",
      "segmentId": "seg_c66620e4300873f44fc5a9085adfea0e",
      "text": "no longer than seven days",
      "parsed": true,
      "expression": {
        "kind": "relative_duration",
        "quantity": 7,
        "unit": "days",
        "dayKind": null,
        "preposition": null,
        "referenceEvent": null,
        "boundKind": "no_longer_than"
      }
    }
  ]
}
```

All five anchored HB 35 spans parse successfully. The adversarial span
"within five business days of such placement" failed anchoring in Module 5
(not found in the normalized text), so it never reaches the grammar.
Only anchored spans are parsed — this is by design.

## API verification — adversarial refusal output

To exercise the grammar's refusal path through the production API, a dedicated
fixture (`fixtures/documents/adversarial-temporal.txt`) was constructed containing
five vague temporal phrases verbatim. Fixture model gateway entries propose them
as extracted spans, anchoring succeeds (exact match), and they reach the grammar.

```
POST /api/v1/documents/{dvId}/parse-temporal
```

```json
{
  "documentVersionId": "85929839-202b-4a10-8b2c-cb68385304a1",
  "grammarVersion": "1.0.0",
  "totalSpans": 5,
  "totalParsed": 0,
  "totalFailed": 5,
  "results": [
    {
      "anchorId": "anc_66f7eb49c362b6a913587c274dab6d99",
      "segmentId": "seg_013d9511497a6935104d9a75eacfc6e4",
      "text": "sometime next spring",
      "parsed": false,
      "reason": "unexpected character 's'",
      "position": 0
    },
    {
      "anchorId": "anc_6ab8637a3c97ee3a06e5a76b0a35d528",
      "segmentId": "seg_013d9511497a6935104d9a75eacfc6e4",
      "text": "as soon as practicable",
      "parsed": false,
      "reason": "unexpected character 'a'",
      "position": 0
    },
    {
      "anchorId": "anc_8eac6913848b58cf5b0a5fd2c3841f0e",
      "segmentId": "seg_2056cf22e77f6bce76dd3d2055b82062",
      "text": "within a reasonable period",
      "parsed": false,
      "reason": "unexpected character 'a'",
      "position": 7
    },
    {
      "anchorId": "anc_610ad29a19bb482237870c484bad4325",
      "segmentId": "seg_2056cf22e77f6bce76dd3d2055b82062",
      "text": "30",
      "parsed": false,
      "reason": "Expecting: one of these possible Token sequences:\n  1. [Every]\n  2. [Within]\n  3. [NoLongerThan]\n  4. [Month]\nbut found: '30'",
      "position": 0
    },
    {
      "anchorId": "anc_6218217765bd8de908a783e5b8bc969f",
      "segmentId": "seg_8afefe7c4f7ad360aa3d71f95fe9f8b9",
      "text": "the first day of the fourth month following adjournment",
      "parsed": false,
      "reason": "unexpected character 'f'",
      "position": 4
    }
  ]
}
```

All five adversarial phrases:
- Survived the full pipeline (scan found modal candidates in their segments,
  fixture model gateway proposed them as spans, anchoring found them via exact
  match in segment text)
- Reached the grammar
- Were rejected with `parsed: false`, a specific reason, and a character position

The refusal path is exercised end-to-end through the running system, not just unit tests.

## Reproducing

```bash
./scripts/gate6-demo.sh fixtures/documents/va-hb35-restorative-housing.pdf Virginia HB 35-demo
./scripts/gate6-demo.sh fixtures/documents/adversarial-temporal.txt Virginia HB 999-demo
```

## Test results

```
Unit tests:  428 passed (31 files), including 29 grammar-specific tests
Integration: 62 passed (6 gate files), including 7 gate6 tests
Typecheck:   clean
Lint:        clean
```

## Files created/modified

### Created
- `src/modules/grammar/types.ts` — domain types, branded AnchoredSpan, TemporalExpression union
- `src/modules/grammar/lexer.ts` — Chevrotain token definitions
- `src/modules/grammar/parser.ts` — CstParser with grammar rules
- `src/modules/grammar/visitor.ts` — CST visitor producing typed expressions
- `src/modules/grammar/parse.ts` — `parseTemporalExpression(AnchoredSpan)` entry point
- `src/modules/grammar/parse.test.ts` — 29 unit tests (in-scope, adversarial, INV-5)
- `src/modules/grammar/service.ts` — grammar service (loads anchored results, parses)
- `src/platform/server/routes/grammar.ts` — POST /api/v1/documents/:dvId/parse-temporal
- `src/platform/db/grammar-schema.ts` — grammar_results table schema
- `src/platform/db/grammar-repository.ts` — grammar persistence
- `src/platform/db/migrations/0010_grammar_results.sql` — migration
- `test/integration/gate6.test.ts` — 7 integration tests (HB 35 acceptance + adversarial refusal)
- `fixtures/documents/adversarial-temporal.txt` — adversarial fixture for refusal testing
- `scripts/gate6-demo.sh` — end-to-end verification script (takes fixture path, runs full pipeline)

### Modified
- `src/modules/shared/types.ts` — added GrammarStatus
- `src/modules/ingestion/types.ts` — added grammarStatus/grammarVersion to DocumentVersion
- `src/modules/ingestion/service.ts` — includes grammarStatus in insertVersion
- `src/platform/db/ingestion-schema.ts` — grammar columns + check constraint
- `src/platform/db/ingestion-repository.ts` — maps grammar columns
- `src/platform/db/schema.ts` — re-exports grammarResults
- `src/platform/db/migrations/meta/_journal.json` — migration 0010
- `src/main.ts` — wires grammar repository/service/routes + adversarial fixture model entries
- `src/modules/parsing/service.test.ts` — grammarStatus fixture
- `src/modules/scanning/service.test.ts` — grammarStatus fixture
- `src/modules/extraction/service.test.ts` — grammarStatus fixture
- `src/modules/anchoring/service.test.ts` — grammarStatus fixture
