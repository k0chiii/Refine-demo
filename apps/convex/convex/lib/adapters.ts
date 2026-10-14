import type { AlignmentOverride, AppContext, Notification } from "@mf100/application";
import type {
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  DocumentDraft,
  SocialProfile,
  NotationRule,
  ProofreadingRun,
  RequiredCheck,
  ReviewAssignment,
  Revision,
  RuleCategory,
  RuleCategoryManager,
  RuleProposal,
  RuleRevision,
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

export function createAppContext(
  db: DatabaseWriter,
  clock: { now(): number } = new ConvexClock(),
): AppContext {
  const syncRoles = async (work: Work) => {
    const workId = work.id as Id<"works">;
    const existing = await db
      .query("workRoles")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .collect();
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
        const docs = await db
          .query("revisions")
          .withIndex("by_work", (q) => q.eq("workId", workId as Id<"works">))
          .collect();
        return docs.map((d) => fromDoc(d) as Revision);
      },
      async insert(revision) {
        const id = await db.insert("revisions", compact(revision as Strip<Doc<"revisions">>));
        return { ...revision, id } as Revision;
      },
      async update(revision) {
        await db.replace(
          revision.id as Id<"revisions">,
          compact(toFields(revision) as Strip<Doc<"revisions">>),
        );
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
          .withIndex("by_state_expires", (q) => q.eq("state", "abandoned"))
          .filter((q) => q.eq(q.field("purgedAt"), undefined))
          .take(limit);
        return docs.map((d) => fromDoc(d) as UploadSession);
      },
    },
    threads: {
      async findById(id) {
        const doc = await db.get("commentThreads", id as Id<"commentThreads">).catch(() => null);
        return doc ? (fromDoc(doc) as CommentThread) : null;
      },
      async listByRevision(revisionId) {
        const docs = await db
          .query("commentThreads")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
          .collect();
        return docs.map((d) => fromDoc(d) as CommentThread);
      },
      async insert(thread) {
        const id = await db.insert(
          "commentThreads",
          compact(thread as Strip<Doc<"commentThreads">>),
        );
        return { ...thread, id } as CommentThread;
      },
      async update(thread) {
        await db.replace(
          thread.id as Id<"commentThreads">,
          compact(toFields(thread) as Strip<Doc<"commentThreads">>),
        );
      },
      async appendEvent(event) {
        await db.insert(
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
          void _id;
          void _creationTime;
          return rest as CommentEvent;
        });
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
      async listUnresponded(limit) {
        const pending = await db
          .query("reviewAssignments")
          .withIndex("by_reviewer_state")
          .filter((q) => q.or(q.eq(q.field("state"), "pending"), q.eq(q.field("state"), "viewed")))
          .take(limit);
        return pending.map(stripAssignment);
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
    notifications: {
      async insert(n) {
        const id = await db.insert("notifications", compact(n));
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
          .withIndex("by_recipient_read", (q) =>
            q.eq("recipientId", userId).eq("readAt", undefined),
          )
          .take(100);
        return docs.length;
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
      async findRule(ruleId) {
        const d = await db
          .query("notationRules")
          .withIndex("by_ruleId", (q) => q.eq("ruleId", ruleId))
          .unique();
        return d ? (strip(d) as NotationRule) : null;
      },
      async insertRule(rule) {
        await db.insert("notationRules", compact(rule));
      },
      async updateRule(rule) {
        const d = await db
          .query("notationRules")
          .withIndex("by_ruleId", (q) => q.eq("ruleId", rule.ruleId))
          .unique();
        if (!d) throw new Error(`rule not found: ${rule.ruleId}`);
        await db.replace(d._id, compact(rule));
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
    },
    audit: {
      async record(entry) {
        await db.insert("auditEvents", compact(entry));
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
