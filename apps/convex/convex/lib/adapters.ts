import { syncWorkAggregate } from "./workAggregate";
import type { MutationCtx } from "../_generated/server";
import { syncRevisionThreadStats } from "./revisionThreadStats";
import { substringTokens, workSearchText } from "./workSearch";
import { syncWorkSummary, workSummaryFromDoc } from "./workSummary";
import type {
  AlignmentOverride,
  AppContext,
  Notification,
  NotificationPrefsRecord,
  PushSubscriptionRecord,
} from "@mf100/application";
import type {
  ApprovalConfirmation,
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentFile,
  CommentThread,
  DocumentDraft,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
  SocialProfile,
  Team,
  MemberGroup,
  NotationRule,
  ProofreadingRun,
  RequiredCheck,
  ReviewAssignment,
  Revision,
  RuleCategory,
  RuleCategoryManager,
  RuleProposal,
  RuleRevision,
  UploadAttempt,
  UploadItem,
  UploadSession,
  Work,
  WorkPermissionGrant,
} from "@mf100/domain";
import { approversOf } from "@mf100/domain";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import type { Scheduler } from "convex/server";
import { vapidKeysFromEnv } from "./webpush.ts";
import { personProfileOf, userDisplayName } from "./users.ts";

/**
 * application 層のポートを Convex の ctx.db で実装するアダプタ。
 * - ドメインの `id` ⇔ Convex の `_id`。`_creationTime` はドメインに持ち込まない。
 * - 1 mutation = 1 トランザクションなので、ユースケース内の複数書込みは原子的に確定する。
 * - query から使う場合は読み取りのみ（書込みメソッドは呼ばれない）。
 */
type Strip<T> = Omit<T, "_id" | "_creationTime">;

function fromDoc<T extends TableNames, D extends Doc<T>>(doc: D): Strip<D> & { id: string } {
  const { _id, _creationTime, ...rest } = doc;
  void _creationTime;
  return { ...(rest as Strip<D>), id: _id as string };
}

/** works の行をドメインの Work に（索引で直接引いたところで使う。works.listMyWorks） */
export const workFromDoc = (doc: Doc<"works">): Work => {
  const { searchTokens: _tokens, ...work } = doc;
  void _tokens;
  return fromDoc(work as Doc<"works">) as Work;
};

/** id を持たない行（ruleId などの業務キーで引く表） */
function strip<D extends { _id: unknown; _creationTime: number }>(
  doc: D,
): Omit<D, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}

function toFields<T extends { id: string }>(entity: T): Omit<T, "id"> {
  const { id, ...rest } = entity;
  void id;
  return rest;
}

/** optional フィールドに undefined を渡すと Convex が拒否するため落とす。 */
function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export class ConvexClock {
  now(): number {
    return Date.now();
  }
}

/** Web Push の鍵が環境変数に揃っているか（デモ・テストでは揃っていない） */
export function pushConfigured(): boolean {
  return typeof process !== "undefined" && vapidKeysFromEnv(process.env) !== null;
}

/**
 * mutation の ctx（または db だけ）から業務の文脈を作る。ctx を渡すと、通知を作ったときに
 * 受信者の端末への送信（Web Push）を予約する。db だけ（テスト・読取）なら予約しない。
 */
export async function syncWorkRoles(db: DatabaseWriter, work: Work) {
  const workId = work.id as Id<"works">;
  const existing = await db
    .query("workRoles")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .collect();
  for (const row of existing) await db.delete(row._id);
  const rows: Array<{ userId: string; role: "creator" | "approver" | "manager" }> = [
    ...work.creatorIds.map((userId) => ({ userId, role: "creator" as const })),
    ...work.managerIds.map((userId) => ({ userId, role: "manager" as const })),
    // 校了者は全員（複数の校了者。古い行は approverId の 1 人）
    ...approversOf(work).map((userId) => ({ userId, role: "approver" as const })),
  ];
  // 同じ人が同じ職責に重ねて入らないようにする
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.role}:${r.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert("workRoles", { workId, ...r });
  }
  await db.patch(workId, { rolesVersion: 1, searchTokens: substringTokens(workSearchText(work)) });
  await syncWorkSummary(db, work.id);
}

export function createAppContext(
  dbOrCtx: DatabaseWriter | { db: DatabaseWriter; scheduler?: Scheduler },
  clock: { now(): number } = new ConvexClock(),
): AppContext {
  const db: DatabaseWriter = "db" in dbOrCtx ? dbOrCtx.db : dbOrCtx;
  const scheduler = "db" in dbOrCtx ? dbOrCtx.scheduler : undefined;
  /**
   * このトランザクションで端末へ送る通知の ID と、それを運ぶ予約（push.enqueue）。
   * 1 件の操作が複数の人に通知を作っても、予約は 1 本にまとめる（前の予約を取り消して ID を足した予約に置き換える。
   * 同じトランザクション内なので取り消した予約は走らない）。以前は通知 1 件ごとに予約していたので、同時に走った予約が
   * workpool の起動（batch-worker の `workers`）で書き込み競合を起こし、やり直しになっていた（Convex Insights 2026-10-25）
   */
  const pushBatch: { ids: string[]; scheduled: Id<"_scheduled_functions"> | null } = {
    ids: [],
    scheduled: null,
  };
  const syncRoles = async (work: Work) => {
    await syncWorkRoles(db, work);
    if ("db" in dbOrCtx && "runMutation" in dbOrCtx)
      await syncWorkAggregate(dbOrCtx as MutationCtx, work);
  };

  return {
    clock,
    people: {
      async displayName(id) {
        const doc = await db.get("users", id as Id<"users">).catch(() => null);
        return (doc && userDisplayName(doc)) || null;
      },
      // 委員 = 一度でもサインインした Nogiku ユーザー（users.search と同じ範囲）
      async listMembers(limit) {
        const users = await db.query("users").take(Math.min(limit, 5000));
        return users.filter((u) => u.nogikuSubject !== undefined).map(personProfileOf);
      },
      async profiles(ids) {
        const out = [];
        for (const id of new Set(ids)) {
          const u = await db.get("users", id as Id<"users">).catch(() => null);
          if (u && u.nogikuSubject !== undefined) out.push(personProfileOf(u));
        }
        return out;
      },
    },
    works: {
      async findById(id) {
        const doc = await db.get("works", id as Id<"works">).catch(() => null);
        return doc ? workFromDoc(doc) : null;
      },
      async insert(work) {
        const id = await db.insert("works", compact(work as Strip<Doc<"works">>));
        const created = { ...work, id } as Work;
        await syncRoles(created);
        return created;
      },
      async update(work) {
        await db.replace(work.id as Id<"works">, compact(toFields(work) as Strip<Doc<"works">>));
        await syncRoles(work);
      },
      async list(limit) {
        const docs = await db.query("works").take(limit);
        return docs.map(workFromDoc);
      },
    },
    revisions: {
      async findById(id) {
        const doc = await db.get("revisions", id as Id<"revisions">).catch(() => null);
        return doc ? (fromDoc(doc) as Revision) : null;
      },
      async listByWork(workId) {
        const docs = await db
          .query("revisions")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .collect();
        return docs.map((d) => fromDoc(d) as Revision);
      },
      async insert(revision) {
        const id = await db.insert("revisions", compact(revision as Strip<Doc<"revisions">>));
        await syncWorkSummary(db, revision.workId);
        return { ...revision, id } as Revision;
      },
      async update(revision) {
        await db.replace(
          revision.id as Id<"revisions">,
          compact(toFields(revision) as Strip<Doc<"revisions">>),
        );
        await syncWorkSummary(db, revision.workId);
      },
      async listOpenExpired(now, limit) {
        const docs = await db
          .query("revisions")
          .withIndex("by_state_deadline", (q) => q.eq("reviewState", "open").lte("deadlineAt", now))
          .take(limit);
        return docs.map((d) => fromDoc(d) as Revision);
      },
      async listOpenDueWithin({ after, upTo }, { cursor, limit }) {
        const result = await db
          .query("revisions")
          .withIndex("by_state_deadline", (q) =>
            q.eq("reviewState", "open").gt("deadlineAt", after).lte("deadlineAt", upTo),
          )
          .paginate({ numItems: limit, cursor });
        return {
          page: result.page.map((d) => fromDoc(d) as Revision),
          continueCursor: result.isDone ? null : result.continueCursor,
        };
      },
    },
    artifacts: {
      async findById(id) {
        const doc = await db.get("artifacts", id as Id<"artifacts">).catch(() => null);
        return doc ? (fromDoc(doc) as Artifact) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db
          .query("artifacts")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .collect();
        return docs.map((d) => fromDoc(d) as Artifact);
      },
      async insert(artifact) {
        const id = await db.insert("artifacts", compact(artifact as Strip<Doc<"artifacts">>));
        return { ...artifact, id } as Artifact;
      },
    },
    uploads: {
      async findById(id) {
        const doc = await db.get("uploadSessions", id as Id<"uploadSessions">).catch(() => null);
        return doc ? (fromDoc(doc) as UploadSession) : null;
      },
      async insert(session) {
        const id = await db.insert(
          "uploadSessions",
          compact(session as Strip<Doc<"uploadSessions">>),
        );
        return { ...session, id } as UploadSession;
      },
      async update(session) {
        await db.replace(
          session.id as Id<"uploadSessions">,
          compact(toFields(session) as Strip<Doc<"uploadSessions">>),
        );
      },
      async listItems(sessionId) {
        const docs = await db
          .query("uploadItems")
          .withIndex("by_session", (q) => q.eq("sessionId", sessionId as Id<"uploadSessions">))
          .collect();
        return docs.map((d) => fromDoc(d) as UploadItem);
      },
      async findItem(itemId) {
        const doc = await db.get("uploadItems", itemId as Id<"uploadItems">).catch(() => null);
        return doc ? (fromDoc(doc) as UploadItem) : null;
      },
      async insertItem(item) {
        const id = await db.insert("uploadItems", compact(item as Strip<Doc<"uploadItems">>));
        return { ...item, id } as UploadItem;
      },
      async listOpenExpired(now, limit) {
        const docs = await db
          .query("uploadSessions")
          .withIndex("by_state_expires", (q) => q.eq("state", "open").lte("expiresAt", now))
          .take(limit);
        return docs.map((d) => fromDoc(d) as UploadSession);
      },
      async updateItem(item) {
        await db.replace(
          item.id as Id<"uploadItems">,
          compact(toFields(item) as Strip<Doc<"uploadItems">>),
        );
      },
      async listAbandonedUnpurged(limit) {
        const docs = await db
          .query("uploadSessions")
          .withIndex("by_state_purged_expires", (q) =>
            q.eq("state", "abandoned").eq("purgedAt", undefined),
          )
          .take(limit);
        return docs.map((d) => fromDoc(d) as UploadSession);
      },
    },
    attempts: {
      async findById(id) {
        const doc = await db.get("uploadAttempts", id as Id<"uploadAttempts">).catch(() => null);
        return doc ? (fromDoc(doc) as UploadAttempt) : null;
      },
      async insert(attempt) {
        const id = await db.insert("uploadAttempts", compact(attempt));
        return { ...attempt, id } as UploadAttempt;
      },
      async update(attempt) {
        await db.replace(
          "uploadAttempts",
          attempt.id as Id<"uploadAttempts">,
          compact(toFields(attempt)),
        );
      },
      async listByTarget(target, targetId) {
        const docs = await db
          .query("uploadAttempts")
          .withIndex("by_target", (q) => q.eq("target", target).eq("targetId", targetId))
          .take(100);
        return docs.map((d) => fromDoc(d) as UploadAttempt);
      },
      async listOrphanCandidates(reservedBefore, limit) {
        const discarded = await db
          .query("uploadAttempts")
          .withIndex("by_purged_and_state_and_created", (q) =>
            q.eq("purgedAt", undefined).eq("state", "discarded"),
          )
          .take(limit);
        const expired =
          discarded.length >= limit
            ? []
            : await db
                .query("uploadAttempts")
                .withIndex("by_purged_and_state_and_created", (q) =>
                  q
                    .eq("purgedAt", undefined)
                    .eq("state", "reserved")
                    .lte("createdAt", reservedBefore),
                )
                .take(limit - discarded.length);
        return [...discarded, ...expired].map((d) => fromDoc(d) as UploadAttempt);
      },
    },
    threads: {
      async findById(id) {
        const doc = await db.get("commentThreads", id as Id<"commentThreads">).catch(() => null);
        return doc ? (fromDoc(doc) as CommentThread) : null;
      },
      async findByMigratedFrom(feedbackThreadId) {
        const doc = await db
          .query("commentThreads")
          .withIndex("by_migrated_from", (q) =>
            q.eq("migratedFromFeedbackThreadId", feedbackThreadId),
          )
          .first();
        return doc ? (fromDoc(doc) as CommentThread) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db
          .query("commentThreads")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .collect();
        return docs
          .filter((d) => d.deletedAt === undefined)
          .map((d) => fromDoc(d) as CommentThread);
      },
      async insert(thread) {
        const id = await db.insert(
          "commentThreads",
          compact(thread as Strip<Doc<"commentThreads">>),
        );
        await syncRevisionThreadStats(db, thread.revisionId);
        return { ...thread, id } as CommentThread;
      },
      async update(thread) {
        await db.replace(
          thread.id as Id<"commentThreads">,
          compact(toFields(thread) as Strip<Doc<"commentThreads">>),
        );
        await syncRevisionThreadStats(db, thread.revisionId);
      },
      async appendEvent(event) {
        return await db.insert(
          "commentEvents",
          compact({ ...event, threadId: event.threadId as Id<"commentThreads"> }),
        );
      },
      async listEvents(threadId) {
        const docs = await db
          .query("commentEvents")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId as Id<"commentThreads">))
          .collect();
        return docs.map((d) => {
          const { _id, _creationTime, ...rest } = d;
          void _creationTime;
          return { ...rest, id: _id as string } as CommentEvent;
        });
      },
      async setEventReactions(eventId, reactions) {
        // 空にしたらフィールドごと外す（undefined を渡すと patch は項目を消す）
        await db.patch("commentEvents", eventId as Id<"commentEvents">, {
          reactions: reactions.length > 0 ? reactions : undefined,
        });
      },
      async setReplyBody(eventId, { body, bodyFormat }) {
        const id = eventId as Id<"commentEvents">;
        const doc = await db.get("commentEvents", id);
        if (!doc) return;
        // payload は丸ごと置き換わるので、ほかの項目（メンション・添付）を写す
        const { bodyFormat: _previous, ...rest } = (doc.payload ?? {}) as Record<string, unknown>;
        void _previous;
        await db.patch("commentEvents", id, {
          payload: { ...rest, body, ...(bodyFormat ? { bodyFormat } : {}) },
        });
      },
      async readAt(userId, threadId) {
        const doc = await db
          .query("commentReads")
          .withIndex("by_user_thread", (q) =>
            q.eq("userId", userId).eq("threadId", threadId as Id<"commentThreads">),
          )
          .first();
        return doc?.readAt ?? null;
      },
      async markRead(userId, threadId, at) {
        const tid = threadId as Id<"commentThreads">;
        const doc = await db
          .query("commentReads")
          .withIndex("by_user_thread", (q) => q.eq("userId", userId).eq("threadId", tid))
          .first();
        if (!doc) await db.insert("commentReads", { userId, threadId: tid, readAt: at });
        else if (doc.readAt < at) await db.patch("commentReads", doc._id, { readAt: at });
      },
      async readsOf(userId, threadIds) {
        const docs = await Promise.all(
          threadIds.map((id) =>
            db
              .query("commentReads")
              .withIndex("by_user_thread", (q) =>
                q.eq("userId", userId).eq("threadId", id as Id<"commentThreads">),
              )
              .first(),
          ),
        );
        const out = new Map<string, number>();
        for (const d of docs) if (d) out.set(d.threadId as string, d.readAt);
        return out;
      },
      async listSubscribers(threadId) {
        const docs = await db
          .query("threadSubscriptions")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId as Id<"commentThreads">))
          .take(1000);
        return docs.map((d) => d.userId);
      },
      async isSubscribed(userId, threadId) {
        const doc = await db
          .query("threadSubscriptions")
          .withIndex("by_user_thread", (q) =>
            q.eq("userId", userId).eq("threadId", threadId as Id<"commentThreads">),
          )
          .first();
        return doc !== null;
      },
      async setSubscribed(userId, threadId, on, at) {
        const tid = threadId as Id<"commentThreads">;
        const docs = await db
          .query("threadSubscriptions")
          .withIndex("by_user_thread", (q) => q.eq("userId", userId).eq("threadId", tid))
          .collect();
        if (!on) for (const d of docs) await db.delete("threadSubscriptions", d._id);
        else if (docs.length === 0)
          await db.insert("threadSubscriptions", { userId, threadId: tid, subscribedAt: at });
      },
    },
    assignments: {
      async listByRevision(revisionId) {
        const docs = await db
          .query("reviewAssignments")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .collect();
        return docs.map(stripAssignment);
      },
      async find(revisionId, reviewerId) {
        const doc = await db
          .query("reviewAssignments")
          .withIndex("by_revision_reviewer", (q) =>
            q.eq("revisionId", revisionId as Id<"revisions">).eq("reviewerId", reviewerId),
          )
          .unique();
        return doc ? stripAssignment(doc) : null;
      },
      async upsert(assignment) {
        const existing = await db
          .query("reviewAssignments")
          .withIndex("by_revision_reviewer", (q) =>
            q
              .eq("revisionId", assignment.revisionId as Id<"revisions">)
              .eq("reviewerId", assignment.reviewerId),
          )
          .unique();
        const fields = compact({
          ...assignment,
          revisionId: assignment.revisionId as Id<"revisions">,
        });
        if (existing) await db.replace(existing._id, fields);
        else await db.insert("reviewAssignments", fields);
      },
      async delete(revisionId, reviewerId) {
        const existing = await db
          .query("reviewAssignments")
          .withIndex("by_revision_reviewer", (q) =>
            q.eq("revisionId", revisionId as Id<"revisions">).eq("reviewerId", reviewerId),
          )
          .unique();
        if (existing) await db.delete(existing._id);
      },
    },
    checks: {
      async findById(id) {
        const doc = await db.get("requiredChecks", id as Id<"requiredChecks">).catch(() => null);
        return doc ? (fromDoc(doc) as RequiredCheck) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db
          .query("requiredChecks")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .collect();
        return docs.map((d) => fromDoc(d) as RequiredCheck);
      },
      async insert(check) {
        const id = await db.insert(
          "requiredChecks",
          compact({ ...check, revisionId: check.revisionId as Id<"revisions"> }),
        );
        return { ...check, id } as RequiredCheck;
      },
      async update(check) {
        await db.replace(
          check.id as Id<"requiredChecks">,
          compact({ ...toFields(check), revisionId: check.revisionId as Id<"revisions"> }),
        );
      },
    },
    pushSubscriptions: {
      async findById(id) {
        const doc = await db
          .get("pushSubscriptions", id as Id<"pushSubscriptions">)
          .catch(() => null);
        return doc ? (fromDoc(doc) as PushSubscriptionRecord) : null;
      },
      async findByEndpoint(endpoint) {
        const doc = await db
          .query("pushSubscriptions")
          .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
          .first();
        return doc ? (fromDoc(doc) as PushSubscriptionRecord) : null;
      },
      async listByUser(userId) {
        const docs = await db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(20);
        return docs.map((d) => fromDoc(d) as PushSubscriptionRecord);
      },
      async insert(sub) {
        const id = await db.insert("pushSubscriptions", compact(sub));
        return { ...sub, id } as PushSubscriptionRecord;
      },
      async update(sub) {
        await db.replace(sub.id as Id<"pushSubscriptions">, compact(toFields(sub)));
      },
      async delete(id) {
        await db.delete(id as Id<"pushSubscriptions">);
      },
    },
    notificationPrefs: {
      async find(userId) {
        const doc = await db
          .query("notificationPrefs")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first();
        return doc ? (strip(doc) as NotificationPrefsRecord) : null;
      },
      async save(prefs) {
        const doc = await db
          .query("notificationPrefs")
          .withIndex("by_user", (q) => q.eq("userId", prefs.userId))
          .first();
        if (doc) await db.replace(doc._id, prefs);
        else await db.insert("notificationPrefs", prefs);
      },
    },
    notifications: {
      async insert(n) {
        const id = await db.insert("notifications", compact(n));
        // 端末への通知: 受信者が端末を登録していれば、送信を予約する（送る内容は送る時点で作り直す）
        if (scheduler && pushConfigured()) {
          const hasDevice = await db
            .query("pushSubscriptions")
            .withIndex("by_user", (q) => q.eq("userId", n.recipientId))
            .first();
          if (hasDevice) {
            pushBatch.ids.push(id);
            if (pushBatch.scheduled) await scheduler.cancel(pushBatch.scheduled);
            pushBatch.scheduled = await scheduler.runAfter(0, internal.push.enqueue, {
              notificationIds: [...pushBatch.ids],
            });
          }
        }
        return { ...n, id } as Notification;
      },
      async listForUser(userId, limit) {
        const docs = await db
          .query("notifications")
          .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
          .order("desc")
          .take(limit);
        return docs.map((d) => fromDoc(d) as Notification);
      },
      async listUnreadForUser(userId, { createdAtOrBefore, limit }) {
        const docs = await db
          .query("notifications")
          .withIndex("by_recipient_read_created", (q) =>
            q.eq("recipientId", userId).eq("readAt", undefined).lte("createdAt", createdAtOrBefore),
          )
          .take(limit);
        return docs.map((d) => fromDoc(d) as Notification);
      },
      async findById(id) {
        const doc = await db.get("notifications", id as Id<"notifications">).catch(() => null);
        return doc ? (fromDoc(doc) as Notification) : null;
      },
      async update(n) {
        await db.replace(n.id as Id<"notifications">, compact(toFields(n)));
      },
      async countUnread(userId) {
        const docs = await db
          .query("notifications")
          .withIndex("by_recipient_read_created", (q) =>
            q.eq("recipientId", userId).eq("readAt", undefined),
          )
          .take(100);
        return docs.length;
      },
    },
    groups: {
      async list() {
        return (await db.query("memberGroups").take(1000)).map((d) => fromDoc(d) as MemberGroup);
      },
      async findById(id) {
        const doc = await db.get("memberGroups", id as Id<"memberGroups">).catch(() => null);
        return doc ? (fromDoc(doc) as MemberGroup) : null;
      },
      async insert(group) {
        const id = await db.insert("memberGroups", compact(group));
        return { ...group, id } as MemberGroup;
      },
      async update(group) {
        await db.replace(group.id as Id<"memberGroups">, compact(toFields(group)));
      },
      async remove(id) {
        await db.delete(id as Id<"memberGroups">);
      },
    },
    workSummaries: {
      async findByWork(workId) {
        const doc = await db
          .query("workSummaries")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .unique();
        return doc && workSummaryFromDoc(doc);
      },
    },
    home: {
      async listPins(userId) {
        const docs = await db
          .query("workPins")
          .withIndex("by_userId_and_pinnedAt", (q) => q.eq("userId", userId))
          .order("desc")
          .take(100);
        return docs.map((d) => strip(d));
      },
      async addPin(pin) {
        await db.insert("workPins", { ...pin, workId: pin.workId as Id<"works"> });
      },
      async removePin(userId, workId) {
        const docs = await db
          .query("workPins")
          .withIndex("by_userId_and_workId", (q) =>
            q.eq("userId", userId).eq("workId", workId as Id<"works">),
          )
          .collect();
        for (const d of docs) await db.delete("workPins", d._id);
      },
    },
    proofreadingRuns: {
      async findById(id) {
        const d = await db.get("proofreadingRuns", id as Id<"proofreadingRuns">).catch(() => null);
        return d ? (fromDoc(d) as ProofreadingRun) : null;
      },
      async findByRevision(revisionId) {
        const d = await db
          .query("proofreadingRuns")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
          .first();
        return d ? (fromDoc(d) as ProofreadingRun) : null;
      },
      async insert(run) {
        const id = await db.insert("proofreadingRuns", compact(run));
        return { ...run, id } as ProofreadingRun;
      },
      async update(run) {
        await db.replace(run.id as Id<"proofreadingRuns">, compact(toFields(run)));
      },
    },
    notation: {
      async listCategories() {
        return (await db.query("ruleCategories").collect()).map((d) => strip(d) as RuleCategory);
      },
      async upsertCategory(c) {
        const cur = await db
          .query("ruleCategories")
          .withIndex("by_code", (q) => q.eq("code", c.code))
          .unique();
        if (cur) await db.replace(cur._id, c);
        else await db.insert("ruleCategories", c);
      },
      async listRules() {
        return (await db.query("notationRules").collect()).map((d) => strip(d) as NotationRule);
      },
      async listRulesInCategories(codes) {
        const groups = await Promise.all(
          [...new Set(codes)].map((code) =>
            db
              .query("notationRules")
              .withIndex("by_category", (q) => q.eq("categoryCode", code))
              .collect(),
          ),
        );
        return groups.flat().map((d) => strip(d) as NotationRule);
      },
      async findRule(ruleId) {
        const d = await db
          .query("notationRules")
          .withIndex("by_ruleId", (q) => q.eq("ruleId", ruleId))
          .unique();
        return d ? (strip(d) as NotationRule) : null;
      },
      async insertRule(rule) {
        await db.insert("notationRules", compact(rule));
        if (scheduler && process.env.RULE_EMBEDDINGS_ENABLED === "true")
          await scheduler.runAfter(0, internal.semanticRules.indexRule, { ruleId: rule.ruleId });
      },
      async updateRule(rule) {
        const d = await db
          .query("notationRules")
          .withIndex("by_ruleId", (q) => q.eq("ruleId", rule.ruleId))
          .unique();
        if (!d) throw new Error(`rule not found: ${rule.ruleId}`);
        await db.replace(d._id, compact(rule));
        if (scheduler && process.env.RULE_EMBEDDINGS_ENABLED === "true")
          await scheduler.runAfter(0, internal.semanticRules.indexRule, { ruleId: rule.ruleId });
      },
      async appendRevision(r) {
        await db.insert("ruleRevisions", compact({ ...r, rule: compact(r.rule) }));
      },
      async listRevisions(ruleId) {
        const docs = await db
          .query("ruleRevisions")
          .withIndex("by_rule", (q) => q.eq("ruleId", ruleId))
          .collect();
        return docs.map((d) => strip(d) as RuleRevision);
      },
      async listManagers() {
        return (await db.query("ruleCategoryManagers").collect()).map(
          (d) => strip(d) as RuleCategoryManager,
        );
      },
      async addManager(m) {
        await db.insert("ruleCategoryManagers", m);
      },
      async removeManager(userId, categoryCode) {
        const rows = await db
          .query("ruleCategoryManagers")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const r of rows) if (r.categoryCode === categoryCode) await db.delete(r._id);
      },
      async findProposal(id) {
        const d = await db.get("ruleProposals", id as Id<"ruleProposals">).catch(() => null);
        return d ? (fromDoc(d) as RuleProposal) : null;
      },
      async findOpenProposalByKey(key) {
        const d = await db
          .query("ruleProposals")
          .withIndex("by_key", (q) => q.eq("dedupeKey", key).eq("status", "open"))
          .first();
        return d ? (fromDoc(d) as RuleProposal) : null;
      },
      async listProposals(status, limit) {
        const docs =
          status === null
            ? await db.query("ruleProposals").order("desc").take(limit)
            : await db
                .query("ruleProposals")
                .withIndex("by_status", (q) => q.eq("status", status))
                .order("desc")
                .take(limit);
        return docs.map((d) => fromDoc(d) as RuleProposal);
      },
      async insertProposal(p) {
        const id = await db.insert("ruleProposals", compact(p));
        return { ...p, id } as RuleProposal;
      },
      async updateProposal(p) {
        await db.replace(p.id as Id<"ruleProposals">, compact(toFields(p)));
      },
    },
    alignments: {
      async find(l, r) {
        const doc = await db
          .query("alignmentOverrides")
          .withIndex("by_artifacts", (q) => q.eq("leftArtifactId", l).eq("rightArtifactId", r))
          .unique();
        return doc ? (fromDoc(doc) as AlignmentOverride) : null;
      },
      async insert(row) {
        const id = await db.insert("alignmentOverrides", {
          ...row,
          workId: row.workId as Id<"works">,
        });
        return { ...row, id } as AlignmentOverride;
      },
      async update(row) {
        const { id, ...fields } = row;
        await db.replace(id as Id<"alignmentOverrides">, {
          ...fields,
          workId: fields.workId as Id<"works">,
        });
      },
    },
    socialProfiles: {
      async list() {
        return (await db.query("socialProfiles").take(100)).map((d) => fromDoc(d) as SocialProfile);
      },
      async findById(id) {
        const doc = await db.get("socialProfiles", id as Id<"socialProfiles">).catch(() => null);
        return doc ? (fromDoc(doc) as SocialProfile) : null;
      },
      async insert(profile) {
        const id = await db.insert("socialProfiles", profile);
        return { ...profile, id } as SocialProfile;
      },
      async update(profile) {
        const { id, ...fields } = profile;
        await db.replace(id as Id<"socialProfiles">, fields);
      },
      async remove(id) {
        await db.delete(id as Id<"socialProfiles">);
      },
      async countWorksUsing(id) {
        return (
          await db
            .query("works")
            .withIndex("by_social_profile", (q) => q.eq("socialProfileId", id))
            .take(1000)
        ).length;
      },
    },
    teams: {
      async list() {
        return (await db.query("teams").take(1000)).map((d) => fromDoc(d) as Team);
      },
      async findById(id) {
        const doc = await db.get("teams", id as Id<"teams">).catch(() => null);
        return doc ? (fromDoc(doc) as Team) : null;
      },
      async insert(team) {
        const id = await db.insert("teams", compact(team));
        return { ...team, id } as Team;
      },
      async update(team) {
        await db.replace(team.id as Id<"teams">, compact(toFields(team)));
      },
      async remove(id) {
        await db.delete(id as Id<"teams">);
      },
      async countWorksUsing(id) {
        const owned = await db
          .query("works")
          .withIndex("by_owner_team", (q) => q.eq("ownerTeamId", id))
          .take(1000);
        // 制作担当は配列なので索引で引けない。制作物の数は多くない（年度で数百）ので上限つきで走査する
        const ownedIds = new Set(owned.map((w) => w._id));
        let production = 0;
        for (const w of await db.query("works").take(5000))
          if (!ownedIds.has(w._id) && w.productionTeamIds.includes(id)) production++;
        return owned.length + production;
      },
    },
    documents: {
      async findByWork(workId) {
        const doc = await db
          .query("documentDrafts")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .unique();
        return doc ? (fromDoc(doc) as DocumentDraft) : null;
      },
      async insert(draft) {
        const id = await db.insert("documentDrafts", {
          ...draft,
          workId: draft.workId as Id<"works">,
        });
        return { ...draft, id } as DocumentDraft;
      },
      async update(draft) {
        const { id, ...fields } = draft;
        await db.replace(id as Id<"documentDrafts">, {
          ...fields,
          workId: fields.workId as Id<"works">,
        });
      },
    },
    acl: {
      async listByWork(workId) {
        const docs = await db
          .query("workPermissions")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .collect();
        return docs.map(stripGrant);
      },
      async insert(grant) {
        await db.insert(
          "workPermissions",
          compact({ ...grant, workId: grant.workId as Id<"works"> }),
        );
      },
      async update(grant) {
        // ID を持たないドメイン型なので (作品, 主体, 付与時刻, レベル) で同定する
        const docs = await db
          .query("workPermissions")
          .withIndex("by_work", (q) => q.eq("workId", grant.workId as Id<"works">))
          .collect();
        const target =
          docs.find(
            (d) =>
              d.principalType === grant.principalType &&
              d.principalId === grant.principalId &&
              d.grantedAt === grant.grantedAt &&
              d.permission === grant.permission &&
              d.revokedAt === undefined,
          ) ??
          docs.find(
            (d) =>
              d.principalType === grant.principalType &&
              d.principalId === grant.principalId &&
              d.grantedAt === grant.grantedAt &&
              d.permission === grant.permission,
          );
        if (!target) throw new Error("workPermission not found");
        await db.replace(target._id, compact({ ...grant, workId: grant.workId as Id<"works"> }));
      },
    },
    approvals: {
      async append(event) {
        await db.insert(
          "approvalEvents",
          compact({ ...event, workId: event.workId as Id<"works"> }),
        );
        await syncWorkSummary(db, event.workId);
      },
      async listByWork(workId) {
        const docs = await db
          .query("approvalEvents")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .collect();
        return docs.map((d) => {
          const { _id, _creationTime, ...rest } = d;
          void _id;
          void _creationTime;
          return rest as ApprovalEvent;
        });
      },
      async insertConfirmation(confirmation) {
        const id = await db.insert("approvalConfirmations", {
          ...compact(confirmation),
          workId: confirmation.workId as Id<"works">,
          revisionId: confirmation.revisionId as Id<"revisions">,
          confirmerId: confirmation.confirmerId as Id<"users">,
        });
        return { ...confirmation, id };
      },
      async listConfirmationsByRevision(revisionId) {
        const docs = await db
          .query("approvalConfirmations")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .take(200);
        return docs
          .map((d) => fromDoc(d) as ApprovalConfirmation)
          .sort((a, b) => a.confirmedAt - b.confirmedAt);
      },
    },
    audit: {
      async record(entry) {
        await db.insert("auditEvents", compact(entry));
      },
    },
    feedback: {
      async pageThreads(cursor, limit) {
        // 作成順（_creationTime）で、前の続きから limit 件。移行の分割実行がこのカーソルで進む
        const docs = await db
          .query("feedbackThreads")
          .withIndex("by_creation_time", (q) =>
            cursor === null ? q : q.gt("_creationTime", cursor),
          )
          .take(limit);
        return {
          threads: docs.map((d) => fromDoc(d) as FeedbackThread),
          nextCursor: docs.length === limit ? docs[docs.length - 1]!._creationTime : null,
        };
      },
      async listPosts(threadId) {
        const docs = await db
          .query("feedbackPosts")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId as Id<"feedbackThreads">))
          .take(2000);
        return docs.map((d) => fromDoc(d) as FeedbackPost);
      },
      async findFile(id) {
        const doc = await db.get("feedbackFiles", id as Id<"feedbackFiles">).catch(() => null);
        return doc ? (fromDoc(doc) as FeedbackFile) : null;
      },
      async listReads(threadId) {
        const docs = await db
          .query("feedbackReads")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId as Id<"feedbackThreads">))
          .take(5000);
        return docs.map((d) => ({ userId: d.userId, readAt: d.readAt }));
      },
    },
    commentFiles: {
      async findFile(id) {
        const doc = await db.get("commentFiles", id as Id<"commentFiles">).catch(() => null);
        return doc ? (fromDoc(doc) as CommentFile) : null;
      },
      async insertFile(file) {
        const id = await db.insert(
          "commentFiles",
          compact({ ...file, workId: file.workId as Id<"works"> }) as Strip<Doc<"commentFiles">>,
        );
        return { ...file, id } as CommentFile;
      },
      async updateFile(file) {
        const { id, ...fields } = file;
        await db.replace(
          "commentFiles",
          id as Id<"commentFiles">,
          compact({ ...fields, workId: fields.workId as Id<"works"> }) as Strip<
            Doc<"commentFiles">
          >,
        );
      },
      async listByThread(threadId) {
        const docs = await db
          .query("commentFiles")
          .withIndex("by_thread_abandoned_created", (q) => q.eq("threadId", threadId))
          .take(2000);
        return docs.map((d) => fromDoc(d) as CommentFile);
      },
      async listUnattachedFilesBefore(before, limit) {
        const docs = await db
          .query("commentFiles")
          .withIndex("by_thread_abandoned_created", (q) =>
            q.eq("threadId", undefined).eq("abandonedAt", undefined).lte("createdAt", before),
          )
          .take(limit);
        return docs.map((d) => fromDoc(d) as CommentFile);
      },
      async listReleasedUnpurgedFiles(limit) {
        const abandoned = await db
          .query("commentFiles")
          .withIndex("by_purged_and_abandoned", (q) =>
            q.eq("purgedAt", undefined).gte("abandonedAt", 0),
          )
          .take(limit);
        const removed =
          abandoned.length >= limit
            ? []
            : await db
                .query("commentFiles")
                .withIndex("by_purged_and_removed", (q) =>
                  q.eq("purgedAt", undefined).gte("removedAt", 0),
                )
                .take(limit - abandoned.length);
        return [...abandoned, ...removed].map((d) => fromDoc(d) as CommentFile);
      },
    },
    idempotency: {
      async get(scope, key) {
        const doc = await db
          .query("idempotencyKeys")
          .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
          .unique();
        return doc ? { result: doc.result } : null;
      },
      async put(scope, key, result) {
        await db.insert("idempotencyKeys", { scope, key, result, createdAt: clock.now() });
      },
    },
  };
}

/** query 関数から読み取り専用で使う。書込みメソッドは呼ばれない前提（呼べばランタイムで失敗する）。 */
export function createReadContext(db: DatabaseReader): AppContext {
  return createAppContext(db as DatabaseWriter);
}

function stripAssignment(d: Doc<"reviewAssignments">): ReviewAssignment {
  const { _id, _creationTime, ...rest } = d;
  void _id;
  void _creationTime;
  return rest as ReviewAssignment;
}

function stripGrant(d: Doc<"workPermissions">): WorkPermissionGrant {
  const { _id, _creationTime, ...rest } = d;
  void _id;
  void _creationTime;
  return rest as WorkPermissionGrant;
}
