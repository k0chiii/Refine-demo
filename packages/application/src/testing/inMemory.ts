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
import type { AppContext, AuditEntry } from "../ports.ts";

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
    audit: AuditEntry[];
    idempotency: Map<string, unknown>;
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
    audit: [],
    idempotency: new Map(),
  };
  const clock = new FakeClock(now);
  return {
    clock,
    state,
    works: {
      findById: async (id) => state.works.get(id),
      insert: async (w) => state.works.insert(w),
      update: async (w) => state.works.put(w),
    },
    revisions: {
      findById: async (id) => state.revisions.get(id),
      listByWork: async (workId) => state.revisions.all().filter((r) => r.workId === workId),
      insert: async (r) => state.revisions.insert(r),
      update: async (r) => state.revisions.put(r),
      listOpenExpired: async (t, limit) => state.revisions.all().filter((r) => r.reviewState === "open" && r.deadlineAt <= t).slice(0, limit),
    },
    artifacts: {
      findById: async (id) => state.artifacts.get(id),
      listByRevision: async (revisionId) => state.artifacts.all().filter((a) => a.revisionId === revisionId),
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
    },
    threads: {
      findById: async (id) => state.threads.get(id),
      listByRevision: async (revisionId) => state.threads.all().filter((t) => t.revisionId === revisionId),
      insert: async (t) => state.threads.insert(t),
      update: async (t) => state.threads.put(t),
      appendEvent: async (e) => {
        state.events.push(clone(e));
      },
      listEvents: async (threadId) => state.events.filter((e) => e.threadId === threadId).map((e) => clone(e)),
    },
    assignments: {
      listByRevision: async (revisionId) => state.assignments.filter((a) => a.revisionId === revisionId).map((a) => clone(a)),
      find: async (revisionId, reviewerId) => {
        const a = state.assignments.find((x) => x.revisionId === revisionId && x.reviewerId === reviewerId);
        return a ? clone(a) : null;
      },
      upsert: async (a) => {
        const i = state.assignments.findIndex((x) => x.revisionId === a.revisionId && x.reviewerId === a.reviewerId);
        if (i >= 0) state.assignments[i] = clone(a);
        else state.assignments.push(clone(a));
      },
    },
    acl: {
      listByWork: async (workId) => state.grants.filter((g) => g.workId === workId).map((g) => clone(g)),
      insert: async (g) => {
        state.grants.push(clone(g));
      },
      update: async (g) => {
        // ID を持たないため (主体, 付与時刻, レベル) で同定し、複数一致時は有効なものを優先する
        const matches = state.grants
          .map((x, idx) => ({ x, idx }))
          .filter(({ x }) => x.workId === g.workId && x.principalType === g.principalType && x.principalId === g.principalId && x.grantedAt === g.grantedAt && x.permission === g.permission);
        const i = (matches.find(({ x }) => x.revokedAt === undefined) ?? matches[0])?.idx ?? -1;
        if (i < 0) throw new Error("grant not found");
        state.grants[i] = clone(g);
      },
    },
    approvals: {
      append: async (e) => {
        state.approvals.push(clone(e));
      },
      listByWork: async (workId) => state.approvals.filter((e) => e.workId === workId).map((e) => clone(e)),
    },
    audit: {
      record: async (e) => {
        state.audit.push(clone(e));
      },
    },
    idempotency: {
      get: async (scope, key) => (state.idempotency.has(`${scope}|${key}`) ? { result: clone(state.idempotency.get(`${scope}|${key}`)) } : null),
      put: async (scope, key, result) => {
        state.idempotency.set(`${scope}|${key}`, clone(result));
      },
    },
  };
}
