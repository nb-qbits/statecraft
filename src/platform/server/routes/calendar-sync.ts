import type { FastifyInstance } from "fastify";
import { google } from "googleapis";
import type { UserRepository } from "../../db/user-repository.js";
import type { ReviewRepository } from "../../db/review-repository.js";
import type { Logger } from "../../logger/logger.js";
import type { RegisterRecord } from "../../../modules/review/types.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";

export interface CalendarSyncDeps {
  userRepository: UserRepository;
  reviewRepository: ReviewRepository;
  ingestionRepository: {
    getVersion(dvId: DocumentVersionId): Promise<{
      legalIdentity: { jurisdiction: string; instrumentType: string; number: string; chapter: string | null };
    } | null>;
  };
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  logger: Logger;
}

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const APP_CALENDAR_NAME = "PolicyAction Deadlines";

function makeOAuth2Client(deps: CalendarSyncDeps) {
  return new google.auth.OAuth2(
    deps.googleClientId,
    deps.googleClientSecret,
    deps.googleRedirectUri,
  );
}

function buildEventBody(record: RegisterRecord, billLabel: string, isEstimated: boolean) {
  const descParts: string[] = [];
  if (isEstimated) {
    descParts.push("⚠ ESTIMATED — not verified for this jurisdiction");
  }
  if (record.dateProvenance === "reviewer_asserted") {
    descParts.push("📝 Date supplied by a reviewer (not computed from the instrument)");
  }
  descParts.push(`Statutory date: ${record.deadlineDate}`);
  descParts.push(`Adjusted date: ${record.adjustedDate}`);
  if (record.deliverable) descParts.push(`Deliverable: ${record.deliverable}`);
  if (record.actor) descParts.push(`Actor: ${record.actor}`);
  descParts.push(`Rules: ${record.ruleIds.join(", ")}`);
  descParts.push(`Citations: ${record.citations.join(", ")}`);

  const summary = record.deliverable
    ? `${billLabel}: ${record.deliverable}`
    : `${billLabel}: ${record.quotedText ?? `Deadline ${record.adjustedDate}`}`;

  const event: Record<string, unknown> = {
    summary: isEstimated ? `[ESTIMATED] ${summary}` : summary,
    description: descParts.join("\n"),
    start: { date: record.adjustedDate },
    end: { date: nextDay(record.adjustedDate) },
    transparency: "transparent",
  };

  if (record.rrule) {
    event.recurrence = [`RRULE:${record.rrule}`];
  }

  return event;
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function registerCalendarSyncRoutes(
  app: FastifyInstance,
  deps: CalendarSyncDeps,
): void {
  const { userRepository, reviewRepository, ingestionRepository, logger } = deps;

  // Step 1: Start OAuth — redirect user to Google consent
  app.get("/api/v1/calendar/google/auth", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }

    const user = await userRepository.getUser(userId);
    if (user?.plan === "free") {
      return reply.status(403).send({
        error: { code: "PAID_FEATURE", message: "Calendar sync requires a paid plan" },
      });
    }

    const oauth2 = makeOAuth2Client(deps);
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state: userId,
      prompt: "consent",
    });

    return reply.redirect(url);
  });

  // Step 2: Google callback — exchange code for tokens
  app.get("/api/v1/calendar/google/callback", async (req, reply) => {
    const { code, state: userId } = req.query as { code: string; state: string };
    if (!code || !userId) {
      return reply.status(400).send({ error: { code: "MISSING_CODE", message: "OAuth code missing" } });
    }

    try {
      const oauth2 = makeOAuth2Client(deps);
      const { tokens } = await oauth2.getToken(code);
      oauth2.setCredentials(tokens);

      // Create dedicated calendar
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const calRes = await calendar.calendars.insert({
        requestBody: {
          summary: APP_CALENDAR_NAME,
          description: "Legislative deadlines tracked by PolicyAction",
          timeZone: "America/New_York",
        },
      });
      const calendarId = calRes.data.id!;

      await userRepository.saveCalendarConnection(
        userId,
        "google",
        tokens.access_token!,
        tokens.refresh_token ?? null,
        calendarId,
      );

      logger.info({ userId, calendarId }, "Google Calendar connected");

      // Redirect back to the app
      return reply.redirect("/docket?calendar=connected");
    } catch (err) {
      logger.error({ err }, "Google OAuth callback failed");
      return reply.redirect("/docket?calendar=error");
    }
  });

  // Step 3: Sync a bill's deadlines to Google Calendar
  app.post<{ Params: { dvId: string } }>(
    "/api/v1/calendar/sync/:dvId",
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) {
        return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
      }

      const dvId = req.params.dvId as DocumentVersionId;
      const conn = await userRepository.getCalendarConnection(userId);
      if (!conn || !conn.calendarId) {
        return reply.status(400).send({
          error: { code: "NO_CALENDAR", message: "No calendar connected. Connect Google Calendar first." },
        });
      }

      try {
        const oauth2 = makeOAuth2Client(deps);
        oauth2.setCredentials({
          access_token: conn.accessToken,
          refresh_token: conn.refreshToken,
        });

        // Refresh token if needed
        oauth2.on("tokens", async (tokens) => {
          if (tokens.access_token) {
            await userRepository.updateCalendarTokens(
              conn.connectionId,
              tokens.access_token,
              tokens.refresh_token ?? conn.refreshToken,
            );
          }
        });

        const calendar = google.calendar({ version: "v3", auth: oauth2 });
        const records = await reviewRepository.getRegisterRecordsByVersion(dvId);

        if (records.length === 0) {
          return reply.status(404).send({
            error: { code: "NO_RECORDS", message: "No register records to sync" },
          });
        }

        const version = await ingestionRepository.getVersion(dvId);
        const identity = version?.legalIdentity;
        const billLabel = identity
          ? (identity.chapter
            ? `Chapter ${identity.chapter}`
            : `${identity.instrumentType} ${identity.number}`)
          : `Bill ${dvId.slice(0, 8)}`;

        const existingSynced = await userRepository.getSyncedEvents(conn.connectionId, dvId);
        const syncedByRecord = new Map(existingSynced.map((s) => [s.recordVersionId, s]));

        const activeRecordVersionIds = new Set(records.map((r) => r.recordVersionId as string));

        let created = 0;
        let updated = 0;
        let deleted = 0;

        for (const record of records) {
          const isEstimated = record.dateProvenance === "generic_default";
          const eventBody = buildEventBody(record, billLabel, isEstimated);

          // Handle RRULE EXDATE/RDATE for per-occurrence adjustments
          if (record.rrule) {
            const occurrences = await reviewRepository.getOccurrencesByRecord(
              record.recordVersionId,
            );
            const recurrence = [`RRULE:${record.rrule}`];
            for (const occ of occurrences) {
              if (occ.occurrenceDate !== occ.adjustedDate) {
                recurrence.push(`EXDATE;VALUE=DATE:${occ.occurrenceDate.replace(/-/g, "")}`);
                recurrence.push(`RDATE;VALUE=DATE:${occ.adjustedDate.replace(/-/g, "")}`);
              }
            }
            eventBody.recurrence = recurrence;
          }

          const existing = syncedByRecord.get(record.recordVersionId);

          if (existing) {
            // Update
            await calendar.events.update({
              calendarId: conn.calendarId,
              eventId: existing.googleEventId,
              requestBody: eventBody,
            });
            await userRepository.upsertSyncedEvent(
              conn.connectionId,
              dvId,
              record.recordVersionId,
              existing.googleEventId,
            );
            updated++;
          } else {
            // Create
            const res = await calendar.events.insert({
              calendarId: conn.calendarId,
              requestBody: eventBody,
            });
            await userRepository.upsertSyncedEvent(
              conn.connectionId,
              dvId,
              record.recordVersionId,
              res.data.id!,
            );
            created++;
          }
        }

        // Delete events for records that no longer exist
        for (const [recordVersionId, synced] of syncedByRecord) {
          if (!activeRecordVersionIds.has(recordVersionId)) {
            try {
              await calendar.events.delete({
                calendarId: conn.calendarId,
                eventId: synced.googleEventId,
              });
            } catch {
              // Event may already be deleted
            }
            await userRepository.deleteSyncedEvent(synced.syncId);
            deleted++;
          }
        }

        logger.info({ userId, dvId, created, updated, deleted }, "calendar sync complete");

        return reply.send({ synced: true, created, updated, deleted });
      } catch (err) {
        logger.error({ err, dvId }, "calendar sync failed");
        return reply.status(500).send({
          error: { code: "SYNC_FAILED", message: "Calendar sync failed" },
        });
      }
    },
  );

  // Check sync status for a specific bill
  app.get<{ Params: { dvId: string } }>(
    "/api/v1/calendar/sync/:dvId/status",
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) {
        return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
      }

      const dvId = req.params.dvId;
      const conn = await userRepository.getCalendarConnection(userId);
      if (!conn) {
        return reply.send({ connected: false, synced: false, eventCount: 0 });
      }

      const events = await userRepository.getSyncedEvents(conn.connectionId, dvId);
      return reply.send({
        connected: true,
        provider: conn.provider,
        synced: events.length > 0,
        eventCount: events.length,
      });
    },
  );

  // Disconnect calendar
  app.delete("/api/v1/calendar/disconnect", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }

    const conn = await userRepository.getCalendarConnection(userId);
    if (!conn) {
      return reply.send({ ok: true });
    }

    logger.info({ userId, connectionId: conn.connectionId }, "calendar disconnected");
    return reply.send({ ok: true });
  });
}
