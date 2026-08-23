import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  users,
  userBills,
  waitlistEntries,
  calendarConnections,
  syncedEvents,
} from "./user-schema.js";

export interface UserRepository {
  createUser(): Promise<{ userId: string }>;
  getUser(userId: string): Promise<{ userId: string; plan: string } | null>;

  trackBill(userId: string, dvId: string): Promise<void>;
  untrackBill(userId: string, dvId: string): Promise<void>;
  archiveBill(userId: string, dvId: string): Promise<void>;
  getTrackedBillCount(userId: string): Promise<number>;
  isTracked(userId: string, dvId: string): Promise<boolean>;

  addWaitlistEntry(userId: string, email: string, trigger: string): Promise<{ entryId: string }>;
  getWaitlistEntries(): Promise<Array<{ entryId: string; userId: string; email: string; trigger: string; createdAt: Date }>>;

  saveCalendarConnection(
    userId: string,
    provider: string,
    accessToken: string,
    refreshToken: string | null,
    calendarId: string | null,
  ): Promise<{ connectionId: string }>;
  getCalendarConnection(userId: string): Promise<{
    connectionId: string;
    provider: string;
    accessToken: string;
    refreshToken: string | null;
    calendarId: string | null;
  } | null>;
  updateCalendarTokens(
    connectionId: string,
    accessToken: string,
    refreshToken: string | null,
  ): Promise<void>;
  updateCalendarId(connectionId: string, calendarId: string): Promise<void>;

  upsertSyncedEvent(
    connectionId: string,
    dvId: string,
    recordVersionId: string,
    googleEventId: string,
  ): Promise<void>;
  getSyncedEvents(
    connectionId: string,
    dvId: string,
  ): Promise<Array<{ syncId: string; recordVersionId: string; googleEventId: string }>>;
  deleteSyncedEvent(syncId: string): Promise<void>;
}

export function createUserRepository(
  db: NodePgDatabase<Record<string, never>>,
): UserRepository {
  return {
    async createUser() {
      const [row] = await db.insert(users).values({}).returning({ userId: users.userId });
      return { userId: row!.userId };
    },

    async getUser(userId: string) {
      const [row] = await db
        .select({ userId: users.userId, plan: users.plan })
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);
      return row ?? null;
    },

    async trackBill(userId: string, dvId: string) {
      await db
        .insert(userBills)
        .values({
          userId,
          documentVersionId: dvId,
        })
        .onConflictDoNothing();
    },

    async untrackBill(userId: string, dvId: string) {
      await db
        .delete(userBills)
        .where(
          and(
            eq(userBills.userId, userId),
            eq(userBills.documentVersionId, dvId),
          ),
        );
    },

    async archiveBill(userId: string, dvId: string) {
      await db
        .update(userBills)
        .set({ archived: "true" })
        .where(
          and(
            eq(userBills.userId, userId),
            eq(userBills.documentVersionId, dvId),
          ),
        );
    },

    async getTrackedBillCount(userId: string) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBills)
        .where(
          and(
            eq(userBills.userId, userId),
            eq(userBills.archived, "false"),
          ),
        );
      return row?.count ?? 0;
    },

    async isTracked(userId: string, dvId: string) {
      const [row] = await db
        .select({ userId: userBills.userId })
        .from(userBills)
        .where(
          and(
            eq(userBills.userId, userId),
            eq(userBills.documentVersionId, dvId),
          ),
        )
        .limit(1);
      return !!row;
    },

    async addWaitlistEntry(userId: string, email: string, trigger: string) {
      const [row] = await db
        .insert(waitlistEntries)
        .values({ userId, email, trigger })
        .returning({ entryId: waitlistEntries.entryId });
      return { entryId: row!.entryId };
    },

    async getWaitlistEntries() {
      return db
        .select({
          entryId: waitlistEntries.entryId,
          userId: waitlistEntries.userId,
          email: waitlistEntries.email,
          trigger: waitlistEntries.trigger,
          createdAt: waitlistEntries.createdAt,
        })
        .from(waitlistEntries)
        .orderBy(waitlistEntries.createdAt);
    },

    async saveCalendarConnection(
      userId: string,
      provider: string,
      accessToken: string,
      refreshToken: string | null,
      calendarId: string | null,
    ) {
      const existing = await db
        .select({ connectionId: calendarConnections.connectionId })
        .from(calendarConnections)
        .where(eq(calendarConnections.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(calendarConnections)
          .set({ accessToken, refreshToken, calendarId, provider })
          .where(eq(calendarConnections.connectionId, existing[0]!.connectionId));
        return { connectionId: existing[0]!.connectionId };
      }

      const [row] = await db
        .insert(calendarConnections)
        .values({ userId, provider, accessToken, refreshToken, calendarId })
        .returning({ connectionId: calendarConnections.connectionId });
      return { connectionId: row!.connectionId };
    },

    async getCalendarConnection(userId: string) {
      const [row] = await db
        .select({
          connectionId: calendarConnections.connectionId,
          provider: calendarConnections.provider,
          accessToken: calendarConnections.accessToken,
          refreshToken: calendarConnections.refreshToken,
          calendarId: calendarConnections.calendarId,
        })
        .from(calendarConnections)
        .where(eq(calendarConnections.userId, userId))
        .limit(1);
      return row ?? null;
    },

    async updateCalendarTokens(
      connectionId: string,
      accessToken: string,
      refreshToken: string | null,
    ) {
      await db
        .update(calendarConnections)
        .set({ accessToken, refreshToken })
        .where(eq(calendarConnections.connectionId, connectionId));
    },

    async updateCalendarId(connectionId: string, calendarId: string) {
      await db
        .update(calendarConnections)
        .set({ calendarId })
        .where(eq(calendarConnections.connectionId, connectionId));
    },

    async upsertSyncedEvent(
      connectionId: string,
      dvId: string,
      recordVersionId: string,
      googleEventId: string,
    ) {
      const existing = await db
        .select({ syncId: syncedEvents.syncId })
        .from(syncedEvents)
        .where(
          and(
            eq(syncedEvents.connectionId, connectionId),
            eq(syncedEvents.recordVersionId, recordVersionId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(syncedEvents)
          .set({ googleEventId, lastSyncedAt: new Date() })
          .where(eq(syncedEvents.syncId, existing[0]!.syncId));
      } else {
        await db.insert(syncedEvents).values({
          connectionId,
          documentVersionId: dvId,
          recordVersionId,
          googleEventId,
        });
      }
    },

    async getSyncedEvents(connectionId: string, dvId: string) {
      return db
        .select({
          syncId: syncedEvents.syncId,
          recordVersionId: syncedEvents.recordVersionId,
          googleEventId: syncedEvents.googleEventId,
        })
        .from(syncedEvents)
        .where(
          and(
            eq(syncedEvents.connectionId, connectionId),
            eq(syncedEvents.documentVersionId, dvId),
          ),
        );
    },

    async deleteSyncedEvent(syncId: string) {
      await db.delete(syncedEvents).where(eq(syncedEvents.syncId, syncId));
    },
  };
}
