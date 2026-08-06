MODULE 1 COMPLETE — Ingestion and document identity (Amendment 3: PDF support)

Gate results
  Identical bytes uploaded twice produce one version: PASS (unit + integration)
  Different bytes produce two versions: PASS (unit + integration)
  Corrupt and unsupported files fail with typed errors: PASS — DOCX magic-byte check, text null-byte check, PDF %PDF- signature check, unsupported mime type rejection. Never marked successful.
  legislativeStatus "unknown" queryable and distinguishable from enacted: PASS (unit + integration)
  Tests cover every error path: PASS — 124 unit tests (13 files), 19 integration tests
  PDF accepted at ingestion layer (storage only, no parsing): PASS — valid PDF accepted, corrupt PDF rejected, mime/content mismatch rejected, parseStatus defaults to "unparsed" on all paths

Test summary
  Unit: 124 tests across 13 files (44 in service.test.ts, including 8 new for PDF/parseStatus), all passing
  Integration: 19 tests in gate1.test.ts (3 new: PDF upload, corrupt PDF rejection, parseStatus on text)
  Coverage: 96.84% statements, 93.93% branches, 93.02% functions, 96.84% lines
  Typecheck: clean
  Lint: clean
  New adversarial cases: wrong magic bytes → CORRUPT_FILE, PDF bytes sent as text/plain → CORRUPT_FILE (null-byte detection), empty buffer as PDF → CORRUPT_FILE, parseStatus verified on every upload path (text, DOCX, PDF, dedup)

Files changed
  src/modules/shared/types.ts: added ParseStatus enum ("unparsed" | "parsed")
  src/modules/shared/types.test.ts: added ParseStatus test
  src/modules/ingestion/types.ts: added "application/pdf" to SUPPORTED_MIME_TYPES, added parseStatus to DocumentVersion
  src/modules/ingestion/service.ts: added validatePdfSignature(), PDF validation branch, parseStatus wired into insertVersion
  src/modules/ingestion/service.test.ts: 8 new tests (PDF support, parseStatus defaults), updated existing tests to use application/json for unsupported-type testing
  src/modules/ingestion/errors.ts: updated unsupportedMimeType message to list PDF as supported
  src/modules/ingestion/errors.test.ts: updated unsupportedMimeType test to use application/json
  src/platform/db/ingestion-schema.ts: added parse_status column with check constraint
  src/platform/db/ingestion-repository.ts: added parseStatus mapping to rowToDocumentVersion and insertVersion
  src/platform/server/routes/upload.ts: updated JSDoc (supported types, page-count cap note, PDF curl example)
  test/integration/gate1.test.ts: 3 new PDF tests, updated unsupported-type test, added parseStatus to UploadResult
  fixtures/sample-bill.pdf: real 1-page PDF fixture with binary content (628 bytes, FlateDecode stream)

Migrations
  0003_easy_greymalkin.sql: ALTER TABLE document_versions ADD COLUMN parse_status varchar(32) DEFAULT 'unparsed' NOT NULL; ADD CONSTRAINT chk_parse_status CHECK (parse_status IN ('unparsed','parsed'))

Environment variables
  None changed.

Invariants touched
  INV-2 (no fallback on failure): validatePdfSignature throws CORRUPT_FILE on invalid magic bytes — no fallback path
  INV-8 (provenance): parseStatus tracks parsing state; "unparsed" is the only value the ingestion layer produces — no code path can set "parsed" from here

Decisions taken
  1. PDF %PDF- signature check requires all 5 bytes (0x25 0x50 0x44 0x46 0x2D) rather than just the 4-byte prefix, matching the PDF specification header
  2. parseStatus is "unparsed" | "parsed" (not "pending" | "complete") to match the domain vocabulary — a document is either parsed or not yet parsed
  3. The PDF fixture uses FlateDecode compression for realistic binary content that triggers null-byte detection when mistyped as text/plain
  4. MAX_FILE_SIZE_BYTES stays at 50 MB as specified; page-count cap documented as deferred to the parsing module

Known limitations
  1. PDF parsing is NOT implemented — PDFs are stored only. Parsing lands in a later module (Module 2 or subsequent)
  2. No page-count cap on PDFs at ingestion time — deferred to the parsing module as specified
  3. No DOCX parsing yet — also deferred to Module 2

Manual verification
  # Typecheck
  npm run typecheck

  # Lint
  npm run lint

  # Unit tests with coverage
  npx vitest run --coverage

  # Integration tests (requires Docker stack)
  docker compose up -d --build
  docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
  docker compose exec minio mc mb local/policyaction --ignore-existing
  docker compose exec app node dist/platform/db/migrate.js
  npm run test:integration

  # Manual PDF upload (after Docker stack)
  curl -X POST http://localhost:3000/api/v1/documents/upload \
    -F 'file=@fixtures/sample-bill.pdf;type=application/pdf' \
    -F 'legalIdentity={"jurisdiction":"Virginia","session":"2025","instrumentType":"HB","number":"1234","stage":"introduced","chapter":null}'

Rollback
  git revert to pre-amendment-3 commit. Drop migration: ALTER TABLE document_versions DROP CONSTRAINT chk_parse_status; ALTER TABLE document_versions DROP COLUMN parse_status;

STOPPING. Awaiting approval before Module 2.
