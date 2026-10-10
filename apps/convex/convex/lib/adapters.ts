import type { AppContext } from "@mf100/application";
import type {
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  ReviewAssignment,
  Revision,
  UploadItem,
  UploadSession,
  Work,
  WorkPermissionGrant,
} from "@mf100/domain";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";

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

export function createAppContext(db: DatabaseWriter, clock: { now(): number } = new ConvexClock()): AppContext {
  const syncRoles = async (work: Work) => {
    const workId = work.id as Id<"works">;
    const existing = await db.query("workRoles").withIndex("by_work", (q) => q.eq("workId", workId)).collect();
    for (const row of existing) await db.delete(row._id);
    const rows: Array<{ userId: string; role: "creator" | "approver" | "manager" }> = [
      ...work.creatorIds.map((userId) => ({ userId, role: "creator" as const })),
      ...work.managerIds.map((userId) => ({ userId, role: "manager" as const })),
      { userId: work.approverId, role: "approver" as const },
    ];
    for (const r of rows) await db.insert("workRoles", { workId, ...r });
  };

  return {
    clock,
    works: {
      async findById(id) {
        const doc = await db.get("works", id as Id<"works">).catch(() => null);
        return doc ? (fromDoc(doc) as Work) : null;
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
    },
    revisions: {
      async findById(id) {
        const doc = await db.get("revisions", id as Id<"revisions">).catch(() => null);
        return doc ? (fromDoc(doc) as Revision) : null;
      },
      async listByWork(workId) {
        const docs = await db.query("revisions").withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">)).collect();
        return docs.map((d) => fromDoc(d) as Revision);
      },
      async insert(revision) {
        const id = await db.insert("revisions", compact(revision as Strip<Doc<"revisions">>));
        return { ...revision, id } as Revision;
      },
      async update(revision) {
        await db.replace(revision.id as Id<"revisions">, compact(toFields(revision) as Strip<Doc<"revisions">>));
      },
      async listOpenExpired(now, limit) {
        const docs = await db
          .query("revisions")
          .withIndex("by_state_deadline", (q) => q.eq("reviewState", "open").lte("deadlineAt", now))
          .take(limit);
        return docs.map((d) => fromDoc(d) as Revision);
      },
    },
    artifacts: {
      async findById(id) {
        const doc = await db.get("artifacts", id as Id<"artifacts">).catch(() => null);
        return doc ? (fromDoc(doc) as Artifact) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db.query("artifacts").withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">)).collect();
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
        const id = await db.insert("uploadSessions", compact(session as Strip<Doc<"uploadSessions">>));
        return { ...session, id } as UploadSession;
      },
      async update(session) {
        await db.replace(session.id as Id<"uploadSessions">, compact(toFields(session) as Strip<Doc<"uploadSessions">>));
      },
      async listItems(sessionId) {
        const docs = await db.query("uploadItems").withIndex("by_session", (q) => q.eq("sessionId", sessionId as Id<"uploadSessions">)).collect();
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
      async updateItem(item) {
        await db.replace(item.id as Id<"uploadItems">, compact(toFields(item) as Strip<Doc<"uploadItems">>));
      },
    },
    threads: {
      async findById(id) {
        const doc = await db.get("commentThreads", id as Id<"commentThreads">).catch(() => null);
        return doc ? (fromDoc(doc) as CommentThread) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db.query("commentThreads").withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">)).collect();
        return docs.map((d) => fromDoc(d) as CommentThread);
      },
      async insert(thread) {
        const id = await db.insert("commentThreads", compact(thread as Strip<Doc<"commentThreads">>));
        return { ...thread, id } as CommentThread;
      },
      async update(thread) {
        await db.replace(thread.id as Id<"commentThreads">, compact(toFields(thread) as Strip<Doc<"commentThreads">>));
      },
      async appendEvent(event) {
        await db.insert("commentEvents", compact({ ...event, threadId: event.threadId as Id<"commentThreads"> }));
      },
      async listEvents(threadId) {
        const docs = await db.query("commentEvents").withIndex("by_thread", (q) => q.eq("threadId", threadId as Id<"commentThreads">)).collect();
        return docs.map((d) => {
          const { _id, _creationTime, ...rest } = d;
          void _id;
          void _creationTime;
          return rest as CommentEvent;
        });
      },
    },
    assignments: {
      async listByRevision(revisionId) {
        const docs = await db.query("reviewAssignments").withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">)).collect();
        return docs.map(stripAssignment);
      },
      async find(revisionId, reviewerId) {
        const doc = await db
          .query("reviewAssignments")
          .withIndex("by_revision_reviewer", (q) => q.eq("revisionId", revisionId as Id<"revisions">).eq("reviewerId", reviewerId))
          .unique();
        return doc ? stripAssignment(doc) : null;
      },
      async upsert(assignment) {
        const existing = await db
          .query("reviewAssignments")
          .withIndex("by_revision_reviewer", (q) => q.eq("revisionId", assignment.revisionId as Id<"revisions">).eq("reviewerId", assignment.reviewerId))
          .unique();
        const fields = compact({ ...assignment, revisionId: assignment.revisionId as Id<"revisions"> });
        if (existing) await db.replace(existing._id, fields);
        else await db.insert("reviewAssignments", fields);
      },
    },
    acl: {
      async listByWork(workId) {
        const docs = await db.query("workPermissions").withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">)).collect();
        return docs.map(stripGrant);
      },
      async insert(grant) {
        await db.insert("workPermissions", compact({ ...grant, workId: grant.workId as Id<"works"> }));
      },
      async update(grant) {
        // ID を持たないドメイン型なので (作品, 主体, 付与時刻, レベル) で同定する
        const docs = await db.query("workPermissions").withIndex("by_work", (q) => q.eq("workId", grant.workId as Id<"works">)).collect();
        const target = docs.find(
          (d) => d.principalType === grant.principalType && d.principalId === grant.principalId && d.grantedAt === grant.grantedAt && d.permission === grant.permission && d.revokedAt === undefined,
        ) ?? docs.find((d) => d.principalType === grant.principalType && d.principalId === grant.principalId && d.grantedAt === grant.grantedAt && d.permission === grant.permission);
        if (!target) throw new Error("workPermission not found");
        await db.replace(target._id, compact({ ...grant, workId: grant.workId as Id<"works"> }));
      },
    },
    approvals: {
      async append(event) {
        await db.insert("approvalEvents", compact({ ...event, workId: event.workId as Id<"works"> }));
      },
      async listByWork(workId) {
        const docs = await db.query("approvalEvents").withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">)).collect();
        return docs.map((d) => {
          const { _id, _creationTime, ...rest } = d;
          void _id;
          void _creationTime;
          return rest as ApprovalEvent;
        });
      },
    },
    audit: {
      async record(entry) {
        await db.insert("auditEvents", compact(entry));
      },
    },
    idempotency: {
      async get(scope, key) {
        const doc = await db.query("idempotencyKeys").withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key)).unique();
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
