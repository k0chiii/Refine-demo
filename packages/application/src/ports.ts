import type {
  ApprovalConfirmation,
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentThread,
  DocumentDraft,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
  Instant,
  ManualPair,
  NotationRule,
  ProofreadingRun,
  Principal,
  RequiredCheck,
  ReviewAssignment,
  Revision,
  RuleCategory,
  RuleCategoryManager,
  RuleProposal,
  RuleRevision,
  RevisionId,
  UploadItem,
  UploadSession,
  UserId,
  Work,
  WorkId,
  WorkPermissionGrant,
  SocialProfile,
  Team,
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
  /** 全ての制作物（管理者の集計用。上限つき） */
  list(limit: number): Promise<Work[]>;
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
  | "revision_voided"
  | "auto_proofread_done"
  | "rule_proposed"
  | "rule_proposal_decided"
  | "mentioned"
  | "feedback_posted"
  | "feedback_mentioned";

export interface Notification {
  id: string;
  recipientId: UserId;
  kind: NotificationKind;
  title: string;
  body: string;
  workId?: WorkId;
  revisionId?: RevisionId;
  /** コメントのスレッド。feedback_* の通知ではフィードバックのスレッド */
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
  /** 独立確認（D2）の記録。確認者本人の操作でだけ追加する。消さない（取り消しは新しい記録で表す） */
  insertConfirmation(confirmation: Omit<ApprovalConfirmation, "id">): Promise<ApprovalConfirmation>;
  /** その版に記録された独立確認（古い順） */
  listConfirmationsByRevision(revisionId: RevisionId): Promise<ApprovalConfirmation[]>;
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

/** SNS のアカウント（本体の設定） */
export interface SocialProfileRepository {
  list(): Promise<SocialProfile[]>;
  findById(id: string): Promise<SocialProfile | null>;
  insert(profile: Omit<SocialProfile, "id">): Promise<SocialProfile>;
  update(profile: SocialProfile): Promise<void>;
  remove(id: string): Promise<void>;
  /** このアカウントを割り当てている制作物の数（使っているものは消せない） */
  countWorksUsing(id: string): Promise<number>;
}

/** 組織（局 › 担当）。管理画面で管理する（Nogiku との同期は後続） */
export interface TeamRepository {
  list(): Promise<Team[]>;
  findById(id: string): Promise<Team | null>;
  insert(t: Omit<Team, "id">): Promise<Team>;
  update(t: Team): Promise<void>;
  remove(id: string): Promise<void>;
  /** この局・担当を主管担当か制作担当にしている制作物の数（使っているものは消せない） */
  countWorksUsing(id: string): Promise<number>;
}

/** 文章の下書き（1 制作物に 1 つ） */
export interface DocumentDraftRepository {
  findByWork(workId: WorkId): Promise<DocumentDraft | null>;
  insert(draft: Omit<DocumentDraft, "id">): Promise<DocumentDraft>;
  update(draft: DocumentDraft): Promise<void>;
}

/** 版比較の手動ページ対応（同じ添付の組で再利用する） */
export interface AlignmentOverride {
  id: string;
  workId: WorkId;
  leftArtifactId: string;
  rightArtifactId: string;
  pairs: ManualPair[];
  updatedBy: UserId;
  updatedAt: Instant;
}
export interface AlignmentOverrideRepository {
  find(leftArtifactId: string, rightArtifactId: string): Promise<AlignmentOverride | null>;
  insert(row: Omit<AlignmentOverride, "id">): Promise<AlignmentOverride>;
  update(row: AlignmentOverride): Promise<void>;
}

/** 委員（一度でもサインインした人）の名簿の行 */
export interface PersonProfile {
  id: UserId;
  name: string;
  email: string | null;
}

/** 人の表示名（通知の本文に「誰が」を書くため）と、委員の名簿（メンションの候補） */
export interface PeopleDirectory {
  /** 分からなければ null */
  displayName(userId: UserId): Promise<string | null>;
  /** 委員の一覧（上限つき。並びは問わない） */
  listMembers(limit: number): Promise<PersonProfile[]>;
  /**
   * 指定した人のうち委員である人（知らない ID は返さない）。
   * 制作物の職責（制作者・校了権限者・主管）に知らない人を入れない確認にも使う。
   */
  profiles(userIds: readonly UserId[]): Promise<PersonProfile[]>;
}

/**
 * 自分だけのダッシュボード（W-26）の保存先。アカウントごとの節の構成・ピン留め・最近開いた制作物。
 * 個人の表示設定なので監査ログには残さない（業務データではない）。
 */
export interface StoredDashboardLayout {
  userId: UserId;
  /** 形は保存時に正規化するが、読むときも信用しない（normalizeDashboardLayout を通す） */
  widgets: Array<{ id: string; visible: boolean; limit: number | null }>;
  updatedAt: Instant;
}
export interface WorkPin {
  userId: UserId;
  workId: WorkId;
  pinnedAt: Instant;
}
export interface RecentWork {
  userId: UserId;
  workId: WorkId;
  openedAt: Instant;
}
export interface HomeRepository {
  findLayout(userId: UserId): Promise<StoredDashboardLayout | null>;
  saveLayout(layout: StoredDashboardLayout): Promise<void>;
  removeLayout(userId: UserId): Promise<void>;
  /** 新しい順 */
  listPins(userId: UserId): Promise<WorkPin[]>;
  addPin(pin: WorkPin): Promise<void>;
  removePin(userId: UserId, workId: WorkId): Promise<void>;
  /** 新しい順 */
  listRecent(userId: UserId): Promise<RecentWork[]>;
  /** 同じ制作物は 1 行（開いた時刻を更新） */
  putRecent(row: RecentWork): Promise<void>;
  removeRecent(userId: UserId, workId: WorkId): Promise<void>;
}

/**
 * 制作のフィードバック（表現の議論）。スレッド・投稿・添付・既読の印。
 * 正式な校正（版・コメント）とは別の表で持つ。
 */
export interface FeedbackRepository {
  findThread(id: string): Promise<FeedbackThread | null>;
  /** 最後の投稿が新しい順。workId を渡すとその制作物のスレッドだけ */
  listThreads(opts: { workId?: string; limit: number }): Promise<FeedbackThread[]>;
  insertThread(thread: Omit<FeedbackThread, "id">): Promise<FeedbackThread>;
  updateThread(thread: FeedbackThread): Promise<void>;
  findPost(id: string): Promise<FeedbackPost | null>;
  /** 古い順 */
  listPosts(threadId: string): Promise<FeedbackPost[]>;
  insertPost(post: Omit<FeedbackPost, "id">): Promise<FeedbackPost>;
  updatePost(post: FeedbackPost): Promise<void>;
  findFile(id: string): Promise<FeedbackFile | null>;
  insertFile(file: Omit<FeedbackFile, "id">): Promise<FeedbackFile>;
  updateFile(file: FeedbackFile): Promise<void>;
  /** 投稿に付いていない・放置扱いでない・createdAt <= before の添付 */
  listUnattachedFilesBefore(before: Instant, limit: number): Promise<FeedbackFile[]>;
  /** 放置扱いで、R2 の実体の削除がまだ終わっていない添付 */
  listAbandonedUnpurgedFiles(limit: number): Promise<FeedbackFile[]>;
  /** その人がそのスレッドを最後に読んだ時刻（未読の判定） */
  readAt(userId: UserId, threadId: string): Promise<Instant | null>;
  markRead(userId: UserId, threadId: string, at: Instant): Promise<void>;
}

export interface AppContext {
  clock: Clock;
  people: PeopleDirectory;
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
  socialProfiles: SocialProfileRepository;
  teams: TeamRepository;
  alignments: AlignmentOverrideRepository;
  notation: NotationRepository;
  proofreadingRuns: ProofreadingRunRepository;
  home: HomeRepository;
  feedback: FeedbackRepository;
  audit: AuditLogger;
  idempotency: IdempotencyStore;
}

/**
 * 表記統一（ルール・カテゴリ・履歴・カテゴリ管理者・変更提案）。
 * カテゴリは保存したものが既定値（defaultRuleCategories）を上書きする（未保存の既定カテゴリはそのまま使える）。
 */
export interface NotationRepository {
  listCategories(): Promise<RuleCategory[]>;
  upsertCategory(category: RuleCategory): Promise<void>;
  listRules(): Promise<NotationRule[]>;
  findRule(ruleId: string): Promise<NotationRule | null>;
  insertRule(rule: NotationRule): Promise<void>;
  updateRule(rule: NotationRule): Promise<void>;
  appendRevision(revision: RuleRevision): Promise<void>;
  listRevisions(ruleId: string): Promise<RuleRevision[]>;
  listManagers(): Promise<RuleCategoryManager[]>;
  addManager(manager: RuleCategoryManager): Promise<void>;
  removeManager(userId: string, categoryCode: string): Promise<void>;
  findProposal(id: string): Promise<RuleProposal | null>;
  findOpenProposalByKey(dedupeKey: string): Promise<RuleProposal | null>;
  listProposals(status: RuleProposal["status"] | null, limit: number): Promise<RuleProposal[]>;
  insertProposal(proposal: Omit<RuleProposal, "id">): Promise<RuleProposal>;
  updateProposal(proposal: RuleProposal): Promise<void>;
}

/** 自動校正の実行（版ごとに 1 件） */
export interface ProofreadingRunRepository {
  findById(id: string): Promise<ProofreadingRun | null>;
  findByRevision(revisionId: string): Promise<ProofreadingRun | null>;
  insert(run: Omit<ProofreadingRun, "id">): Promise<ProofreadingRun>;
  update(run: ProofreadingRun): Promise<void>;
}

export type { Principal };
