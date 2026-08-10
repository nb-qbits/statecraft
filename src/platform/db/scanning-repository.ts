import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { scanCandidates } from "./scanning-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { CandidateMatch } from "../../modules/scanning/types.js";
import type { DocumentVersionId, CandidateId, SegmentId, ScanStatus } from "../../modules/shared/types.js";
import type { CandidateKind } from "../../modules/scanning/types.js";

function rowToCandidate(row: typeof scanCandidates.$inferSelect): CandidateMatch {
  return {
    candidateId: row.candidateId as CandidateId,
    segmentId: row.segmentId as SegmentId,
    kind: row.kind as CandidateKind,
    ruleId: row.ruleId,
    matchedText: row.matchedText,
    matchStart: row.matchStart,
    matchEnd: row.matchEnd,
    suppressed: row.suppressed,
  };
}

export interface ScanningRepository {
  insertCandidates(candidates: CandidateMatch[], documentVersionId: DocumentVersionId, scannerVersion: string): Promise<void>;
  getCandidatesByVersion(documentVersionId: DocumentVersionId): Promise<CandidateMatch[]>;
  deleteCandidatesByVersion(documentVersionId: DocumentVersionId): Promise<void>;
  updateScanStatus(documentVersionId: DocumentVersionId, status: ScanStatus, scannerVersion: string): Promise<void>;
}

export function createScanningRepository(
  db: NodePgDatabase,
): ScanningRepository {
  return {
    async insertCandidates(
      candidates: CandidateMatch[],
      documentVersionId: DocumentVersionId,
      scannerVersion: string,
    ): Promise<void> {
      if (candidates.length === 0) return;

      await db.insert(scanCandidates).values(
        candidates.map((c) => ({
          candidateId: c.candidateId,
          segmentId: c.segmentId,
          documentVersionId,
          kind: c.kind,
          ruleId: c.ruleId,
          matchedText: c.matchedText,
          matchStart: c.matchStart,
          matchEnd: c.matchEnd,
          suppressed: c.suppressed,
          scannerVersion,
        })),
      );
    },

    async getCandidatesByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<CandidateMatch[]> {
      const rows = await db
        .select()
        .from(scanCandidates)
        .where(eq(scanCandidates.documentVersionId, documentVersionId));

      return rows.map(rowToCandidate);
    },

    async deleteCandidatesByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(scanCandidates)
        .where(eq(scanCandidates.documentVersionId, documentVersionId));
    },

    async updateScanStatus(
      documentVersionId: DocumentVersionId,
      status: ScanStatus,
      scannerVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ scanStatus: status, scannerVersion })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
