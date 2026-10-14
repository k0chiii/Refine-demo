import type {
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  DocumentDraft,
  Instant,
  Principal,
  RequiredCheck,
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
  /** open のまま expiresAt を過ぎたセッション */
  listOpenExpired(now: Instant, limit: number): Promise<UploadSession[]>;
  /** abandoned で、R2 の孤立オブジェクト清掃がまだ終わっていないセッション */
  listAbandonedUnpurged(limit: number): Promise<UploadSession[]>;
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
  /** 期限接近リマインド用: 未確認（pending/viewed）の割当 */
  listUnresponded(limit: number): Promise<ReviewAssignment[]>;
}

export interface RequiredCheckRepository {
  findById(id: string): Promise<RequiredCheck | null>;
  listByRevision(revisionId: RevisionId): Promise<RequiredCheck[]>;
  insert(check: Omit<RequiredCheck, "id">): Promise<RequiredCheck>;
  update(check: RequiredCheck): Promise<void>;
}

/**
 * アプリ内通知（F-11）。業務データの正本は「自分の校正待ち」と版の状態であり、通知は補助（§10-1）。
 * Slack 等の外部送信は NotificationJob として別途キューイングする（後続）。
 */
export type NotificationKind =
  | "revision_submitted"
  | "review_assigned"
  | "comment_posted"
  | "comment_decided"
  | "comment_assigned"
  | "check_requested"
  | "check_completed"
  | "deadline_approaching"
  | "work_finalized"
  | "work_reopened"
  | "revision_voided";

export interface Notification {
  id: string;
  recipientId: UserId;
  kind: NotificationKind;
  title: string;
  body: string;
  workId?: WorkId;
  revisionId?: RevisionId;
  threadId?: string;
  createdAt: Instant;
  readAt?: Instant;
}

export interface NotificationRepository {
  insert(notification: Omit<Notification, "id">): Promise<Notification>;
  listForUser(userId: UserId, limit: number): Promise<Notification[]>;
  findById(id: string): Promise<Notification | null>;
  update(notification: Notification): Promise<void>;
  countUnread(userId: UserId): Promise<number>;
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

/** 文章の下書き（1 制作物に 1 つ） */
export interface DocumentDraftRepository {
  findByWork(workId: WorkId): Promise<DocumentDraft | null>;
  insert(draft: Omit<DocumentDraft, "id">): Promise<DocumentDraft>;
  update(draft: DocumentDraft): Promise<void>;
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
  checks: RequiredCheckRepository;
  notifications: NotificationRepository;
  documents: DocumentDraftRepository;
  audit: AuditLogger;
  idempotency: IdempotencyStore;
}

export type { Principal };
