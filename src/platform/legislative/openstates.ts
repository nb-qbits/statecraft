import type {
  LegislativeMetadataSource,
  LegislativeMetadata,
} from "../../modules/ingestion/legislative-metadata.js";
import type { LegalIdentity } from "../../modules/ingestion/types.js";
import type { LegislativeStatus } from "../../modules/shared/types.js";
import type { Logger } from "../logger/logger.js";

const OPENSTATES_API_URL = "https://v3.openstates.org";

interface OpenStatesBillResult {
  id: string;
  identifier: string;
  title: string;
  latest_action_date: string | null;
  latest_action_description: string | null;
  openstates_url: string;
  actions: Array<{
    description: string;
    date: string;
    classification: string[];
  }>;
}

function deriveStatusFromActions(
  actions: OpenStatesBillResult["actions"],
): LegislativeStatus {
  for (let i = actions.length - 1; i >= 0; i--) {
    const classifications = actions[i]!.classification;
    if (classifications.includes("became-law") || classifications.includes("executive-signature")) {
      return "enacted";
    }
    if (classifications.includes("executive-veto")) {
      return "vetoed";
    }
    if (classifications.includes("failure") || classifications.includes("withdrawal")) {
      return "failed";
    }
    if (classifications.includes("passage")) {
      return "enrolled";
    }
    if (classifications.includes("engrossment")) {
      return "engrossed";
    }
  }
  return "introduced";
}

export function createOpenStatesSource(
  apiKey: string,
  logger: Logger,
): LegislativeMetadataSource {
  return {
    provider: "openstates",

    async lookup(identity: LegalIdentity): Promise<LegislativeMetadata | null> {
      const jurisdiction = identity.jurisdiction.toLowerCase();
      const session = identity.session;
      const identifier = `${identity.instrumentType} ${identity.number}`;

      const params = new URLSearchParams({
        jurisdiction,
        session,
        identifier,
        include: "actions",
      });

      const url = `${OPENSTATES_API_URL}/bills?${params.toString()}`;

      try {
        const response = await fetch(url, {
          headers: {
            "X-API-KEY": apiKey,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          logger.warn(
            { status: response.status, url },
            "Open States API request failed",
          );
          return null;
        }

        const data = (await response.json()) as {
          results: OpenStatesBillResult[];
        };

        if (data.results.length === 0) {
          logger.info(
            { jurisdiction, session, identifier },
            "no bill found in Open States",
          );
          return null;
        }

        const bill = data.results[0]!;
        const legislativeStatus = deriveStatusFromActions(bill.actions);

        return {
          legislativeStatus,
          authoritativeSource: bill.openstates_url,
          asOfDate: bill.latest_action_date,
        };
      } catch (err) {
        logger.error(
          { err, jurisdiction, session, identifier },
          "Open States lookup failed",
        );
        return null;
      }
    },
  };
}
