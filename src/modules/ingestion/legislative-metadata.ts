import type { LegalIdentity } from "./types.js";
import type { LegislativeStatus } from "../shared/types.js";

export interface LegislativeMetadata {
  readonly legislativeStatus: LegislativeStatus;
  readonly authoritativeSource: string | null;
  readonly asOfDate: string | null;
}

export interface LegislativeMetadataSource {
  readonly provider: string;
  lookup(identity: LegalIdentity): Promise<LegislativeMetadata | null>;
}

export function createNullMetadataSource(): LegislativeMetadataSource {
  return {
    provider: "none",
    async lookup(): Promise<null> {
      return null;
    },
  };
}
