import type {
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  DocumentDraft,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
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
  SocialProfile,
  Team,
} from "@mf100/domain";
import type {
  AlignmentOverride,
  AppContext,
  AuditEntry,
  Notification,
  RecentWork,
  StoredDashboardLayout,
  WorkPin,
} from "../ports.ts";

/**
 * インメモリのポート実装。ユースケースの単体テストと、将来の UI プロトタイプ用。
 * Convex アダプタと同じ契約（ID 払い出しはリポジトリ側）を満たす。
 */
/** プレーンなデータのみを扱うため JSON ベースの深いコピーで十分（undefined のキーは落ちる）。 */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class FakeClock {
  constructor(public current: number) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

class Table<T extends { id: string }> {
  private seq = 0;
  readonly rows = new Map<string, T>();
  constructor(private readonly prefix: string) {}
  insert(data: Omit<T, "id">): T {
    const id = `${this.prefix}_${++this.seq}`;
    const row = { ...(data as object), id } as T;
    this.rows.set(id, clone(row));
    return clone(row);
  }
  get(id: string): T | null {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  put(row: T): void {
    if (!this.rows.has(row.id)) throw new Error(`row not found: ${row.id}`);
    this.rows.set(row.id, clone(row));
  }
  all(): T[] {
    return [...this.rows.values()].map((r) => clone(r));
  }
}

export interface InMemoryContext extends AppContext {
  clock: FakeClock;
  state: {
    works: Table<Work>;
    revisions: Table<Revision>;
    artifacts: Table<Artifact>;
    sessions: Table<UploadSession>;
    items: Table<UploadItem>;
    threads: Table<CommentThread>;
    events: CommentEvent[];
    assignments: ReviewAssignment[];
    grants: WorkPermissionGrant[];
    approvals: ApprovalEvent[];
    checks: Table<RequiredCheck>;
    notifications: Table<Notification>;
    documents: Table<DocumentDraft>;
    socialProfiles: Table<SocialProfile>;
    teams: Table<Team>;
    alignments: Table<AlignmentOverride>;
    categories: Map<string, RuleCategory>;
    rules: Map<string, NotationRule>;
    ruleRevisions: RuleRevision[];
    managers: RuleCategoryManager[];
    proposals: Table<RuleProposal>;
    runs: Table<ProofreadingRun>;
    layouts: Map<string, StoredDashboardLayout>;
    pins: WorkPin[];
    recent: RecentWork[];
    feedbackThreads: Table<FeedbackThread>;
    feedbackPosts: Table<FeedbackPost>;
    feedbackFiles: Table<FeedbackFile>;
    attempts: Table<UploadAttempt>;
    /** `${userId}|${threadId}` → 最後に読んだ時刻 */
    feedbackReads: Map<string, number>;
    audit: AuditEntry[];
    idempotency: Map<string, unknown>;
    /** 表示名（テストで通知の文面を確かめるときに入れる）。ここに居る人を委員（名簿）とみなす */
    names: Map<string, string>;
  };
}

export function createInMemoryContext(now = Date.UTC(2026, 10, 1)): InMemoryContext {
  const state: InMemoryContext["state"] = {
    works: new Table<Work>("work"),
    revisions: new Table<Revision>("rev"),
    artifacts: new Table<Artifact>("art"),
    sessions: new Table<UploadSession>("ses"),
    items: new Table<UploadItem>("item"),
    threads: new Table<CommentThread>("thr"),
    events: [],
    assignments: [],
    grants: [],
    approvals: [],
    checks: new Table<RequiredCheck>("chk"),
    notifications: new Table<Notification>("ntf"),
    documents: new Table<DocumentDraft>("doc"),
    socialProfiles: new Table<SocialProfile>("sp"),
    teams: new Table<Team>("team"),
    alignments: new Table<AlignmentOverride>("aln"),
    categories: new Map(),
    rules: new Map(),
    ruleRevisions: [],
    managers: [],
    proposals: new Table<RuleProposal>("prp"),
    runs: new Table<ProofreadingRun>("run"),
    layouts: new Map(),
    pins: [],
    recent: [],
    feedbackThreads: new Table<FeedbackThread>("fbt"),
    feedbackPosts: new Table<FeedbackPost>("fbp"),
    feedbackFiles: new Table<FeedbackFile>("fbf"),
    attempts: new Table<UploadAttempt>("att"),
    feedbackReads: new Map(),
    audit: [],
    idempotency: new Map(),
    names: new Map(),
  };
  const clock = new FakeClock(now);
  return {
    clock,
    state,
    people: {
      displayName: async (id) => state.names.get(id) ?? null,
      listMembers: async (limit) =>
        [...state.names].slice(0, limit).map(([id, name]) => ({ id, name, email: null })),
      profiles: async (ids) =>
        ids.flatMap((id) =>
          state.names.has(id) ? [{ id, name: state.names.get(id)!, email: null }] : [],
        ),
    },
    works: {
      findById: async (id) => state.works.get(id),
      insert: async (w) => state.works.insert(w),
      update: async (w) => state.works.put(w),
      list: async (limit) => state.works.all().slice(0, limit),
    },
    revisions: {
      findById: async (id) => state.revisions.get(id),
      listByWork: async (workId) => state.revisions.all().filter((r) => r.workId === workId),
      insert: async (r) => state.revisions.insert(r),
      update: async (r) => state.revisions.put(r),
      listOpenExpired: async (t, limit) =>
        state.revisions
          .all()
          .filter((r) => r.reviewState === "open" && r.deadlineAt <= t)
          .slice(0, limit),
    },
    artifacts: {
      findById: async (id) => state.artifacts.get(id),
      listByRevision: async (revisionId) =>
        state.artifacts.all().filter((a) => a.revisionId === revisionId),
      insert: async (a) => state.artifacts.insert(a),
    },
    uploads: {
      findById: async (id) => state.sessions.get(id),
      insert: async (s) => state.sessions.insert(s),
      update: async (s) => state.sessions.put(s),
      listItems: async (sessionId) => state.items.all().filter((i) => i.sessionId === sessionId),
      findItem: async (id) => state.items.get(id),
      insertItem: async (i) => state.items.insert(i),
      updateItem: async (i) => state.items.put(i),
      listOpenExpired: async (t, limit) =>
        state.sessions
          .all()
          .filter((s) => s.state === "open" && s.expiresAt <= t)
          .slice(0, limit),
      listAbandonedUnpurged: async (limit) =>
        state.sessions
          .all()
          .filter((s) => s.state === "abandoned" && s.purgedAt === undefined)
          .slice(0, limit),
    },
    attempts: {
      findById: async (id) => state.attempts.get(id),
      insert: async (a) => state.attempts.insert(a),
      update: async (a) => state.attempts.put(a),
      listByTarget: async (target, targetId) =>
        state.attempts.all().filter((a) => a.target === target && a.targetId === targetId),
      listOrphanCandidates: async (reservedBefore, limit) =>
        state.attempts
          .all()
          .filter(
            (a) =>
              a.purgedAt === undefined &&
              (a.state === "discarded" ||
                (a.state === "reserved" && a.createdAt <= reservedBefore)),
          )
          .slice(0, limit),
    },
    threads: {
      findById: async (id) => state.threads.get(id),
      listByRevision: async (revisionId) =>
        state.threads.all().filter((t) => t.revisionId === revisionId),
      insert: async (t) => state.threads.insert(t),
      update: async (t) => state.threads.put(t),
      appendEvent: async (e) => {
        state.events.push(clone(e));
      },
      listEvents: async (threadId) =>
        state.events.filter((e) => e.threadId === threadId).map((e) => clone(e)),
    },
    assignments: {
      listByRevision: async (revisionId) =>
        state.assignments.filter((a) => a.revisionId === revisionId).map((a) => clone(a)),
      find: async (revisionId, reviewerId) => {
        const a = state.assignments.find(
          (x) => x.revisionId === revisionId && x.reviewerId === reviewerId,
        );
        return a ? clone(a) : null;
      },
      upsert: async (a) => {
        const i = state.assignments.findIndex(
          (x) => x.revisionId === a.revisionId && x.reviewerId === a.reviewerId,
        );
        if (i >= 0) state.assignments[i] = clone(a);
        else state.assignments.push(clone(a));
      },
      listUnresponded: async (limit) =>
        state.assignments
          .filter((a) => a.state === "pending" || a.state === "viewed")
          .map((a) => clone(a))
          .slice(0, limit),
    },
    acl: {
      listByWork: async (workId) =>
        state.grants.filter((g) => g.workId === workId).map((g) => clone(g)),
      insert: async (g) => {
        state.grants.push(clone(g));
      },
      update: async (g) => {
        // ID を持たないため (主体, 付与時刻, レベル) で同定し、複数一致時は有効なものを優先する
        const matches = state.grants
          .map((x, idx) => ({ x, idx }))
          .filter(
            ({ x }) =>
              x.workId === g.workId &&
              x.principalType === g.principalType &&
              x.principalId === g.principalId &&
              x.grantedAt === g.grantedAt &&
              x.permission === g.permission,
          );
        const i = (matches.find(({ x }) => x.revokedAt === undefined) ?? matches[0])?.idx ?? -1;
        if (i < 0) throw new Error("grant not found");
        state.grants[i] = clone(g);
      },
    },
    approvals: {
      append: async (e) => {
        state.approvals.push(clone(e));
      },
      listByWork: async (workId) =>
        state.approvals.filter((e) => e.workId === workId).map((e) => clone(e)),
    },
    audit: {
      record: async (e) => {
        state.audit.push(clone(e));
      },
    },
    checks: {
      findById: async (id) => state.checks.get(id),
      listByRevision: async (revisionId) =>
        state.checks.all().filter((c) => c.revisionId === revisionId),
      insert: async (c) => state.checks.insert(c),
      update: async (c) => state.checks.put(c),
    },
    notifications: {
      insert: async (n) => state.notifications.insert(n),
      listForUser: async (userId, limit) =>
        state.notifications
          .all()
          .filter((n) => n.recipientId === userId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit),
      findById: async (id) => state.notifications.get(id),
      update: async (n) => state.notifications.put(n),
      countUnread: async (userId) =>
        state.notifications.all().filter((n) => n.recipientId === userId && n.readAt === undefined)
          .length,
    },
    documents: {
      findByWork: async (workId) => state.documents.all().find((d) => d.workId === workId) ?? null,
      insert: async (d) => state.documents.insert(d),
      update: async (d) => state.documents.put(d),
    },
    socialProfiles: {
      list: async () => state.socialProfiles.all(),
      findById: async (id) => state.socialProfiles.get(id),
      insert: async (p) => state.socialProfiles.insert(p),
      update: async (p) => state.socialProfiles.put(p),
      remove: async (id) => {
        state.socialProfiles.rows.delete(id);
      },
      countWorksUsing: async (id) =>
        state.works.all().filter((w) => w.socialProfileId === id).length,
    },
    teams: {
      list: async () => state.teams.all(),
      findById: async (id) => state.teams.get(id),
      insert: async (t) => state.teams.insert(t),
      update: async (t) => state.teams.put(t),
      remove: async (id) => {
        state.teams.rows.delete(id);
      },
      countWorksUsing: async (id) =>
        state.works.all().filter((w) => w.ownerTeamId === id || w.productionTeamIds.includes(id))
          .length,
    },
    home: {
      findLayout: async (userId) => clone(state.layouts.get(userId) ?? null),
      saveLayout: async (layout) => {
        state.layouts.set(layout.userId, clone(layout));
      },
      removeLayout: async (userId) => {
        state.layouts.delete(userId);
      },
      listPins: async (userId) =>
        state.pins
          .filter((p) => p.userId === userId)
          .sort((a, b) => b.pinnedAt - a.pinnedAt)
          .map(clone),
      addPin: async (pin) => {
        state.pins.push(clone(pin));
      },
      removePin: async (userId, workId) => {
        state.pins = state.pins.filter((p) => !(p.userId === userId && p.workId === workId));
      },
      listRecent: async (userId) =>
        state.recent
          .filter((r) => r.userId === userId)
          .sort((a, b) => b.openedAt - a.openedAt)
          .map(clone),
      putRecent: async (row) => {
        state.recent = [
          ...state.recent.filter((r) => !(r.userId === row.userId && r.workId === row.workId)),
          clone(row),
        ];
      },
      removeRecent: async (userId, workId) => {
        state.recent = state.recent.filter((r) => !(r.userId === userId && r.workId === workId));
      },
    },
    alignments: {
      find: async (l, r) =>
        state.alignments.all().find((x) => x.leftArtifactId === l && x.rightArtifactId === r) ??
        null,
      insert: async (x) => state.alignments.insert(x),
      update: async (x) => state.alignments.put(x),
    },
    notation: {
      listCategories: async () => [...state.categories.values()].map(clone),
      upsertCategory: async (c) => {
        state.categories.set(c.code, clone(c));
      },
      listRules: async () => [...state.rules.values()].map(clone),
      findRule: async (id) => (state.rules.has(id) ? clone(state.rules.get(id)!) : null),
      insertRule: async (r) => {
        state.rules.set(r.ruleId, clone(r));
      },
      updateRule: async (r) => {
        state.rules.set(r.ruleId, clone(r));
      },
      appendRevision: async (r) => {
        state.ruleRevisions.push(clone(r));
      },
      listRevisions: async (id) => state.ruleRevisions.filter((r) => r.ruleId === id).map(clone),
      listManagers: async () => state.managers.map(clone),
      addManager: async (m) => {
        state.managers.push(clone(m));
      },
      removeManager: async (u, c) => {
        state.managers = state.managers.filter((m) => !(m.userId === u && m.categoryCode === c));
      },
      findProposal: async (id) => state.proposals.get(id),
      findOpenProposalByKey: async (k) =>
        state.proposals.all().find((p) => p.status === "open" && p.dedupeKey === k) ?? null,
      listProposals: async (status, limit) =>
        state.proposals
          .all()
          .filter((p) => status === null || p.status === status)
          .sort((a, b) => b.proposedAt - a.proposedAt)
          .slice(0, limit),
      insertProposal: async (p) => state.proposals.insert(p),
      updateProposal: async (p) => state.proposals.put(p),
    },
    proofreadingRuns: {
      findById: async (id) => state.runs.get(id),
      findByRevision: async (rid) => state.runs.all().find((r) => r.revisionId === rid) ?? null,
      insert: async (r) => state.runs.insert(r),
      update: async (r) => state.runs.put(r),
    },
    feedback: {
      findThread: async (id) => state.feedbackThreads.get(id),
      listThreads: async ({ workId, limit }) =>
        state.feedbackThreads
          .all()
          .filter((t) => workId === undefined || t.workId === workId)
          .sort((a, b) => b.lastPostAt - a.lastPostAt)
          .slice(0, limit),
      insertThread: async (t) => state.feedbackThreads.insert(t),
      updateThread: async (t) => state.feedbackThreads.put(t),
      findPost: async (id) => state.feedbackPosts.get(id),
      listPosts: async (threadId) =>
        state.feedbackPosts
          .all()
          .filter((p) => p.threadId === threadId)
          .sort((a, b) => a.createdAt - b.createdAt),
      insertPost: async (p) => state.feedbackPosts.insert(p),
      updatePost: async (p) => state.feedbackPosts.put(p),
      findFile: async (id) => state.feedbackFiles.get(id),
      insertFile: async (f) => state.feedbackFiles.insert(f),
      updateFile: async (f) => state.feedbackFiles.put(f),
      listUnattachedFilesBefore: async (before, limit) =>
        state.feedbackFiles
          .all()
          .filter(
            (f) => f.postId === undefined && f.abandonedAt === undefined && f.createdAt <= before,
          )
          .slice(0, limit),
      listAbandonedUnpurgedFiles: async (limit) =>
        state.feedbackFiles
          .all()
          .filter((f) => f.abandonedAt !== undefined && f.purgedAt === undefined)
          .slice(0, limit),
      readAt: async (userId, threadId) => state.feedbackReads.get(`${userId}|${threadId}`) ?? null,
      markRead: async (userId, threadId, at) => {
        const key = `${userId}|${threadId}`;
        state.feedbackReads.set(key, Math.max(at, state.feedbackReads.get(key) ?? 0));
      },
    },
    idempotency: {
      get: async (scope, key) =>
        state.idempotency.has(`${scope}|${key}`)
          ? { result: clone(state.idempotency.get(`${scope}|${key}`)) }
          : null,
      put: async (scope, key, result) => {
        state.idempotency.set(`${scope}|${key}`, clone(result));
      },
    },
  };
}
