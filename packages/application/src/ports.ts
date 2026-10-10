import type {
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  Instant,
  Principal,
  ReviewAssignment,
  Revision,
  RevisionId,
  UploadItem,
  UploadSession,
  UserId,
  Work,
  WorkId,
  WorkPermissionGrant,
} from "@mf100/domain";

/**
 * アプリケーション層が依存する抽象（ポート）。
 * 実装（アダプタ）は apps/convex（Convex ctx.db）と packages/application/testing（インメモリ）。
 * すべてのユースケースは 1 つのトランザクション境界（Convex では 1 mutation）の中で呼ばれる前提。
 */
export interface Clock {
  now(): Instant;
}

export interface WorkRepository {
  findById(id: WorkId): Promise<Work | null>;
  insert(work: Omit<Work, "id">): Promise<Work>;
  update(work: Work): Promise<void>;
}

export interface RevisionRepository {
  findById(id: RevisionId): Promise<Revision | null>;
  listByWork(workId: WorkId): Promise<Revision[]>;
  insert(revision: Omit<Revision, "id">): Promise<Revision>;
  update(revision: Revision): Promise<void>;
  /** 期限到来で閉じる候補（受付中かつ deadlineAt <= now）。 */
  listOpenExpired(now: Instant, limit: number): Promise<Revision[]>;
}

export interface ArtifactRepository {
  findById(id: string): Promise<Artifact | null>;
  listByRevision(revisionId: RevisionId): Promise<Artifact[]>;
  insert(artifact: Omit<Artifact, "id">): Promise<Artifact>;
}

export interface UploadSessionRepository {
  findById(id: string): Promise<UploadSession | null>;
  insert(session: Omit<UploadSession, "id">): Promise<UploadSession>;
  update(session: UploadSession): Promise<void>;
  listItems(sessionId: string): Promise<UploadItem[]>;
  findItem(itemId: string): Promise<UploadItem | null>;
  insertItem(item: Omit<UploadItem, "id">): Promise<UploadItem>;
  updateItem(item: UploadItem): Promise<void>;
}

export interface ThreadRepository {
  findById(id: string): Promise<CommentThread | null>;
  listByRevision(revisionId: RevisionId): Promise<CommentThread[]>;
  insert(thread: Omit<CommentThread, "id">): Promise<CommentThread>;
  update(thread: CommentThread): Promise<void>;
  appendEvent(event: CommentEvent): Promise<void>;
  listEvents(threadId: string): Promise<CommentEvent[]>;
}

export interface ReviewAssignmentRepository {
  listByRevision(revisionId: RevisionId): Promise<ReviewAssignment[]>;
  find(revisionId: RevisionId, reviewerId: UserId): Promise<ReviewAssignment | null>;
  upsert(assignment: ReviewAssignment): Promise<void>;
}

export interface AclRepository {
  /** 取消済みを含む全履歴。認可判定では isGrantActive で絞る。 */
  listByWork(workId: WorkId): Promise<WorkPermissionGrant[]>;
  insert(grant: WorkPermissionGrant): Promise<void>;
  update(grant: WorkPermissionGrant): Promise<void>;
}

export interface ApprovalRepository {
  append(event: ApprovalEvent): Promise<void>;
  listByWork(workId: WorkId): Promise<ApprovalEvent[]>;
}

export interface AuditEntry {
  entityType: string;
  entityId: string;
  operation: string;
  actorId: UserId;
  requestId?: string;
  before?: unknown;
  after?: unknown;
  at: Instant;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

/**
 * 冪等キー（§5.2-7 / A-10）。
 * scope は「誰が・どの対象に対して」を含めて衝突を防ぐ。保存された結果はそのまま返す。
 */
export interface IdempotencyStore {
  get(scope: string, key: string): Promise<{ result: unknown } | null>;
  put(scope: string, key: string, result: unknown): Promise<void>;
}

export interface AppContext {
  clock: Clock;
  works: WorkRepository;
  revisions: RevisionRepository;
  artifacts: ArtifactRepository;
  uploads: UploadSessionRepository;
  threads: ThreadRepository;
  assignments: ReviewAssignmentRepository;
  acl: AclRepository;
  approvals: ApprovalRepository;
  audit: AuditLogger;
  idempotency: IdempotencyStore;
}

export type { Principal };
