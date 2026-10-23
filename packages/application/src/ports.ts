import type {
  ApprovalConfirmation,
  ApprovalEvent,
  Artifact,
  CommentEvent,
  CommentFile,
  ReactionEntry,
  CommentThread,
  DocumentDraft,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
  Instant,
  ManualPair,
  NotationRule,
  NotificationPrefs,
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
  UploadAttempt,
  UploadAttemptTarget,
  UploadItem,
  UploadSession,
  UserId,
  Work,
  WorkId,
  WorkPermissionGrant,
  SocialProfile,
  Team,
  MemberGroup,
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
  /**
   * 期限接近リマインドの候補: 受付中かつ after < deadlineAt <= upTo の版を締切の早い順に 1 ページ。
   * cursor は前のページの continueCursor（最初は null）。同じ after/upTo で続きを読む。
   */
  listOpenDueWithin(
    range: { after: Instant; upTo: Instant },
    page: { cursor: string | null; limit: number },
  ): Promise<{ page: Revision[]; continueCursor: string | null }>;
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

/**
 * R2 への転送の試行（版の提出物・フィードバックの添付で共通）。採用・破棄・清掃の記録。
 * 試行ごとに別のキーを使うので、採用された実体を他の試行が変更することはない。
 */
export interface UploadAttemptRepository {
  findById(id: string): Promise<UploadAttempt | null>;
  insert(attempt: Omit<UploadAttempt, "id">): Promise<UploadAttempt>;
  update(attempt: UploadAttempt): Promise<void>;
  /** その項目（添付）の試行 */
  listByTarget(target: UploadAttemptTarget, targetId: string): Promise<UploadAttempt[]>;
  /** 清掃の候補: R2 から未削除で、破棄済みのもの、または createdAt <= reservedBefore の予約のまま */
  listOrphanCandidates(reservedBefore: Instant, limit: number): Promise<UploadAttempt[]>;
}

export interface ThreadRepository {
  findById(id: string): Promise<CommentThread | null>;
  /** FB から移したスレッド（移行元の FB のスレッド ID で引く。無ければ null） */
  findByMigratedFrom(feedbackThreadId: string): Promise<CommentThread | null>;
  /** 版のスレッド。削除済み（deletedAt あり）は含めない（一覧・件数・未解決・校了の判定はこれで足りる） */
  listByRevision(revisionId: RevisionId): Promise<CommentThread[]>;
  insert(thread: Omit<CommentThread, "id">): Promise<CommentThread>;
  update(thread: CommentThread): Promise<void>;
  /** イベントを追記する。払い出されたイベントの ID を返す（返信に添付を付けるとき使う） */
  appendEvent(event: CommentEvent): Promise<string>;
  listEvents(threadId: string): Promise<CommentEvent[]>;
  /** 返信（イベント）のリアクションを置き換える（空にすると持たない状態に戻す） */
  setEventReactions(eventId: string, reactions: ReactionEntry[]): Promise<void>;
  /** その人がスレッドを最後に読んだ時刻（未読の判定。読んだことが無ければ null） */
  readAt(userId: UserId, threadId: string): Promise<Instant | null>;
  /** 読んだ印を付ける（すでにそれ以降まで読んでいれば何もしない） */
  markRead(userId: UserId, threadId: string, at: Instant): Promise<void>;
  /** その人が最後に読んだ時刻を、まとめて引く（読んだことの無いスレッドは含めない） */
  readsOf(userId: UserId, threadIds: readonly string[]): Promise<Map<string, Instant>>;
}

export interface ReviewAssignmentRepository {
  listByRevision(revisionId: RevisionId): Promise<ReviewAssignment[]>;
  find(revisionId: RevisionId, reviewerId: UserId): Promise<ReviewAssignment | null>;
  upsert(assignment: ReviewAssignment): Promise<void>;
  /** 名簿から外れた未完了の割当を消す。行が無くても成功する。 */
  delete(revisionId: RevisionId, reviewerId: UserId): Promise<void>;
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
  /** コメントのスレッド。旧 FB の通知（feedback_*）に保存してあるのは FB のスレッドで、読むときに移し先のコメントへ付け替える */
  threadId?: string;
  /** 通知のもとになった操作をした人（端末の通知に「誰が」を出す）。システム起点（締切・自動校正）は無い */
  actorId?: UserId;
  /** 端末の通知に載せてよい短い抜粋（コメントの冒頭など）。見られない人の通知には無い */
  preview?: string;
  createdAt: Instant;
  readAt?: Instant;
}

export interface NotificationRepository {
  insert(notification: Omit<Notification, "id">): Promise<Notification>;
  /** 既読を含む新しい順 */
  listForUser(userId: UserId, limit: number): Promise<Notification[]>;
  /** 未読（readAt なし）で createdAt <= createdAtOrBefore のものを古い順に最大 limit 件（未読の索引で読む） */
  listUnreadForUser(
    userId: UserId,
    opts: { createdAtOrBefore: Instant; limit: number },
  ): Promise<Notification[]>;
  findById(id: string): Promise<Notification | null>;
  update(notification: Notification): Promise<void>;
  countUnread(userId: UserId): Promise<number>;
}

/** 通知の受け取り方（利用者ごと。端末への通知にだけ効く）。行が無ければ既定（domain DEFAULT_NOTIFICATION_PREFS） */
export interface NotificationPrefsRecord extends NotificationPrefs {
  userId: UserId;
  updatedAt: Instant;
}

export interface NotificationPrefsRepository {
  find(userId: UserId): Promise<NotificationPrefsRecord | null>;
  save(prefs: NotificationPrefsRecord): Promise<void>;
}

/** 端末への通知（Web Push）の購読。端末（ブラウザ）ごとに 1 件。endpoint で一意 */
export interface PushSubscriptionRecord {
  id: string;
  userId: UserId;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** 設定画面で端末を見分けるための短い説明（ブラウザ名など）。任意 */
  device?: string;
  createdAt: Instant;
  lastSuccessAt?: Instant;
  /** 続けて失敗した回数（成功で 0 に戻る） */
  failureCount: number;
}

export interface PushSubscriptionRepository {
  findById(id: string): Promise<PushSubscriptionRecord | null>;
  findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  listByUser(userId: UserId): Promise<PushSubscriptionRecord[]>;
  insert(sub: Omit<PushSubscriptionRecord, "id">): Promise<PushSubscriptionRecord>;
  update(sub: PushSubscriptionRecord): Promise<void>;
  delete(id: string): Promise<void>;
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

/** メンバーのグループ（校正者の割り当て・メンションでまとめて選ぶ人の集まり）。管理画面で管理する */
export interface MemberGroupRepository {
  list(): Promise<MemberGroup[]>;
  findById(id: string): Promise<MemberGroup | null>;
  insert(g: Omit<MemberGroup, "id">): Promise<MemberGroup>;
  update(g: MemberGroup): Promise<void>;
  remove(id: string): Promise<void>;
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
  /** 表示名（ふりがな。無い人は漢字の名前。domain の personDisplayName） */
  name: string;
  email: string | null;
  /** Nogiku の name（漢字の名前）。検索で漢字でも当たるように持つ。表示には使わない */
  nameKanji?: string | null;
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
 * ピン留め（制作物のページの「ピン留め」）の保存先。アカウントごと。
 * 個人の表示設定なので監査ログには残さない（業務データではない）。
 * 旧ホームの節の構成（dashboardLayouts）・最近開いた制作物（recentWorks）は、入口を制作・校正に分けたときに使わなくなった
 * （利用者決定 2026-10-19）。保存済みの行があるため、テーブルは schema に残している。
 */
export interface WorkPin {
  userId: UserId;
  workId: WorkId;
  pinnedAt: Instant;
}
export interface HomeRepository {
  /** 新しい順 */
  listPins(userId: UserId): Promise<WorkPin[]>;
  addPin(pin: WorkPin): Promise<void>;
  removePin(userId: UserId, workId: WorkId): Promise<void>;
}

/**
 * 旧 FB（フィードバック）の読み取り。コメントへの移行（usecases/feedbackMigration.ts）だけが使う。
 * FB の機能は廃止した（利用者決定 2026-10-20）ので、書き込みの口は持たない。
 */
export interface FeedbackRepository {
  /** 作成順に limit 件。cursor は前の結果の nextCursor（最初は null）。最後まで読んだら nextCursor は null */
  pageThreads(
    cursor: number | null,
    limit: number,
  ): Promise<{ threads: FeedbackThread[]; nextCursor: number | null }>;
  /** 古い順（削除された投稿も含む） */
  listPosts(threadId: string): Promise<FeedbackPost[]>;
  findFile(id: string): Promise<FeedbackFile | null>;
  /** そのスレッドを最後に読んだ時刻（人ごと） */
  listReads(threadId: string): Promise<Array<{ userId: UserId; readAt: Instant }>>;
}

/**
 * コメント・返信の添付。準備 → Hono で実体検証 → コメント（返信）に付ける。
 * 付けた先のコメントが削除されたら手放し（removedAt）、付けないまま 24 時間たったら放置扱い（abandonedAt）にして、R2 の清掃の対象にする。
 */
export interface CommentFileRepository {
  findFile(id: string): Promise<CommentFile | null>;
  insertFile(file: Omit<CommentFile, "id">): Promise<CommentFile>;
  updateFile(file: CommentFile): Promise<void>;
  /** そのスレッドに付いた添付すべて（コメント本体と返信の分） */
  listByThread(threadId: string): Promise<CommentFile[]>;
  /** どこにも付いていない・放置扱いでない・createdAt <= before の添付 */
  listUnattachedFilesBefore(before: Instant, limit: number): Promise<CommentFile[]>;
  /** 放置扱いまたは手放した添付で、R2 の実体の削除がまだ終わっていないもの */
  listReleasedUnpurgedFiles(limit: number): Promise<CommentFile[]>;
}

export interface AppContext {
  clock: Clock;
  people: PeopleDirectory;
  works: WorkRepository;
  revisions: RevisionRepository;
  artifacts: ArtifactRepository;
  uploads: UploadSessionRepository;
  attempts: UploadAttemptRepository;
  threads: ThreadRepository;
  assignments: ReviewAssignmentRepository;
  acl: AclRepository;
  approvals: ApprovalRepository;
  checks: RequiredCheckRepository;
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  notificationPrefs: NotificationPrefsRepository;
  documents: DocumentDraftRepository;
  socialProfiles: SocialProfileRepository;
  teams: TeamRepository;
  groups: MemberGroupRepository;
  alignments: AlignmentOverrideRepository;
  notation: NotationRepository;
  proofreadingRuns: ProofreadingRunRepository;
  home: HomeRepository;
  feedback: FeedbackRepository;
  commentFiles: CommentFileRepository;
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
  /** 指定したカテゴリのルールだけ（索引で引く。制作物に当てるルールの組を作るときに、無関係なカテゴリのルールを読まない） */
  listRulesInCategories(categoryCodes: readonly string[]): Promise<NotationRule[]>;
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
