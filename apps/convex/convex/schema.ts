import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vProposalContext,
  vProposalKind,
  vProposalStatus,
  vRuleCategoryFields,
  vRuleException,
  vRuleFields,
  vRuleSetSnapshot,
  vBotOrigin,
  vProofreadingRunFields,
  vFeedbackTemplateId,
} from "./lib/validators.ts";

/**
 * MF100 校正システムのスキーマ（要件 §6 の論理モデルを Convex に写像）。
 * - 内部 ID（_id）と業務上の旧 ID（legacyId）は別フィールド。
 * - 画面で全作品・全コメントを購読しないよう、担当・期限・版・状態にインデックスを張る。
 * - 認可は関数内で行う。テーブル構造だけで非公開作品の存在を隠すことはできないので、クエリ側で必ず絞る。
 */

const permissionLevel = v.union(
  v.literal("view"),
  v.literal("review"),
  v.literal("edit"),
  v.literal("manage"),
);
const principalType = v.union(v.literal("user"), v.literal("group"));
const lifecycle = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("on_hold"),
  v.literal("finalized"),
  v.literal("cancelled"),
);
const confidentiality = v.union(v.literal("normal"), v.literal("restricted"));
const mediaType = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("document"),
  v.literal("sns"),
  v.literal("video"),
  v.literal("web"),
  v.literal("figma"),
  v.literal("other"),
);
const revisionKind = v.union(v.literal("rough"), v.literal("standard"));
const reviewState = v.union(
  v.literal("scheduled"),
  v.literal("open"),
  v.literal("closed"),
  v.literal("void"),
);
const closedReason = v.union(v.literal("deadline"), v.literal("superseded"), v.literal("void"));
const artifactRole = v.union(v.literal("source"), v.literal("preview"), v.literal("external"));
const artifactType = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("document"),
  v.literal("other"),
  v.literal("external_link"),
);
const artifactStatus = v.union(
  v.literal("pending"),
  v.literal("uploaded"),
  v.literal("verified"),
  v.literal("failed"),
);
const threadKind = v.union(
  v.literal("correction"),
  v.literal("question"),
  v.literal("discussion"),
  v.literal("decision"),
);
const severity = v.union(
  v.literal("critical"),
  v.literal("major"),
  v.literal("minor"),
  v.literal("info"),
);
const resolution = v.union(
  v.literal("open"),
  v.literal("acknowledged"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("deferred"),
  v.literal("resolved"),
);
const assignmentState = v.union(
  v.literal("pending"),
  v.literal("viewed"),
  v.literal("responded"),
  v.literal("excused"),
);
const approvalAction = v.union(
  v.literal("finalized"),
  v.literal("reopened"),
  v.literal("exception_finalized"),
);

const rect = v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() });
const point = v.object({ x: v.number(), y: v.number() });
export const anchorValidator = v.union(
  v.object({ type: v.literal("pdf_rect"), artifactId: v.string(), page: v.number(), rect }),
  v.object({ type: v.literal("pdf_pin"), artifactId: v.string(), page: v.number(), point }),
  v.object({ type: v.literal("image_rect"), artifactId: v.string(), rect }),
  v.object({ type: v.literal("image_pin"), artifactId: v.string(), point }),
  v.object({ type: v.literal("external"), artifactId: v.string(), note: v.string() }),
  v.object({
    type: v.literal("text_range"),
    artifactId: v.string(),
    start: v.number(),
    end: v.number(),
    quote: v.string(),
  }),
);

export default defineSchema({
  ...authTables,

  /**
   * UserRef（§6）。IdP（Nogiku Auth）が正本で、アプリ側は参照に必要な最小限のみ保持する。
   * パスワード等の資格情報は一切保持しない（Convex Auth の OIDC フローはトークンのみ扱う）。
   */
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    /** Nogiku Auth の sub（User.id）。認可の主体識別子。 */
    nogikuSubject: v.optional(v.string()),
    source: v.optional(v.union(v.literal("nogiku"), v.literal("nogiku_mock"))),
    /** 校正システム管理者。業務上の校了権限ではない（§2.1）。 */
    isSystemAdmin: v.optional(v.boolean()),
    /** Nogiku Access から同期した組織権限名（後続）。NOGIKU_ACCESS_ENABLED=true のときだけ参照する。 */
    orgPermissions: v.optional(v.array(v.string())),
    lastLoginAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("by_nogikuSubject", ["nogikuSubject"]),

  works: defineTable({
    legacyId: v.optional(v.string()),
    year: v.number(),
    title: v.string(),
    purpose: v.string(),
    category: v.string(),
    mediaType,
    ownerTeamId: v.optional(v.string()),
    productionTeamIds: v.array(v.string()),
    relatedTeamIds: v.array(v.string()),
    managerIds: v.array(v.string()),
    creatorIds: v.array(v.string()),
    approverId: v.string(),
    deadlineAt: v.optional(v.number()),
    lifecycle,
    confidentiality,
    finalRevisionId: v.optional(v.string()),
    /** 表記統一のルールカテゴリ（人が選ぶ） */
    notationCategories: v.optional(v.array(v.string())),
    /** SNS 投稿で使うアカウント（socialProfiles の ID） */
    socialProfileId: v.optional(v.string()),
    version: v.number(),
  })
    .index("by_year", ["year"])
    .index("by_social_profile", ["socialProfileId"])
    .index("by_owner_team", ["ownerTeamId"])
    .index("by_lifecycle", ["lifecycle"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["year", "lifecycle"] }),

  /** 職責（制作者・校了者・主管）を「ユーザー → 作品」で引くための派生テーブル。works 書込み時に同期する。 */
  workRoles: defineTable({
    workId: v.id("works"),
    userId: v.string(),
    role: v.union(v.literal("creator"), v.literal("approver"), v.literal("manager")),
  })
    .index("by_user", ["userId"])
    .index("by_work", ["workId"]),

  /** WorkPermission（§6 / F-14）。取消は revokedAt を立てる。削除しない。 */
  workPermissions: defineTable({
    workId: v.id("works"),
    principalType,
    principalId: v.string(),
    permission: permissionLevel,
    grantedBy: v.string(),
    grantedAt: v.number(),
    revokedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_work", ["workId"])
    .index("by_principal", ["principalType", "principalId"]),

  revisions: defineTable({
    workId: v.id("works"),
    kind: revisionKind,
    sequence: v.number(),
    reviewType: v.string(),
    submittedBy: v.string(),
    submittedAt: v.number(),
    deadlineAt: v.number(),
    reviewState,
    reviewClosedReason: v.optional(closedReason),
    reviewClosedAt: v.optional(v.number()),
    supersededByRevisionId: v.optional(v.string()),
    changeSummary: v.string(),
    focusNotes: v.string(),
    snapshotHash: v.optional(v.string()),
    /** 提出時の表記統一ルールの組（ルール ID と版） */
    notationSnapshot: v.optional(vRuleSetSnapshot),
  })
    .index("by_work", ["workId"])
    .index("by_work_state", ["workId", "reviewState"])
    .index("by_state_deadline", ["reviewState", "deadlineAt"]),

  artifacts: defineTable({
    revisionId: v.id("revisions"),
    type: artifactType,
    role: artifactRole,
    fileName: v.string(),
    mimeType: v.string(),
    objectKey: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    sha256: v.optional(v.string()),
    size: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    status: artifactStatus,
    failureMessage: v.optional(v.string()),
  }).index("by_revision", ["revisionId"]),

  uploadSessions: defineTable({
    workId: v.id("works"),
    submittedBy: v.string(),
    kind: revisionKind,
    reviewType: v.string(),
    deadlineAt: v.number(),
    changeSummary: v.string(),
    focusNotes: v.string(),
    state: v.union(v.literal("open"), v.literal("confirmed"), v.literal("abandoned")),
    createdAt: v.number(),
    expiresAt: v.number(),
    confirmedRevisionId: v.optional(v.string()),
    requiredChecks: v.optional(
      v.array(
        v.object({ type: v.string(), label: v.string(), assigneeId: v.optional(v.string()) }),
      ),
    ),
    purgedAt: v.optional(v.number()),
  })
    .index("by_work", ["workId"])
    .index("by_submitter", ["submittedBy", "state"])
    .index("by_state_expires", ["state", "expiresAt"]),

  uploadItems: defineTable({
    sessionId: v.id("uploadSessions"),
    fileName: v.string(),
    mimeType: v.string(),
    type: artifactType,
    role: artifactRole,
    objectKey: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    declaredSize: v.optional(v.number()),
    size: v.optional(v.number()),
    sha256: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    status: artifactStatus,
    failureMessage: v.optional(v.string()),
    purgedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  commentThreads: defineTable({
    revisionId: v.id("revisions"),
    artifactId: v.optional(v.string()),
    authorId: v.string(),
    body: v.string(),
    kind: threadKind,
    severity,
    anchor: v.optional(anchorValidator),
    resolution,
    createdAt: v.number(),
    carriedFromThreadId: v.optional(v.string()),
    carriedToThreadId: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    editCount: v.optional(v.number()),
    /** 自動校正の指摘（投稿者はシステム） */
    origin: v.optional(vBotOrigin),
    /** 本文でメンションした人（制作物を見られる人だけ） */
    mentions: v.optional(v.array(v.string())),
  })
    .index("by_revision", ["revisionId"])
    .index("by_revision_resolution", ["revisionId", "resolution"]),

  commentEvents: defineTable({
    threadId: v.id("commentThreads"),
    eventType: v.union(
      v.literal("created"),
      v.literal("replied"),
      v.literal("decided"),
      v.literal("edited"),
      v.literal("carried_forward"),
      v.literal("assigned"),
    ),
    actorId: v.string(),
    reason: v.optional(v.string()),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_thread", ["threadId"]),

  reviewAssignments: defineTable({
    revisionId: v.id("revisions"),
    reviewerId: v.string(),
    reviewType: v.string(),
    state: assignmentState,
    viewedAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
  })
    .index("by_revision", ["revisionId"])
    .index("by_revision_reviewer", ["revisionId", "reviewerId"])
    .index("by_reviewer_state", ["reviewerId", "state"]),

  /** 専門確認（必須チェック）（§2.2-4） */
  requiredChecks: defineTable({
    revisionId: v.id("revisions"),
    type: v.union(
      v.literal("photo"),
      v.literal("name"),
      v.literal("language"),
      v.literal("rules"),
      v.literal("design"),
      v.literal("other"),
    ),
    label: v.string(),
    assigneeId: v.optional(v.string()),
    state: v.union(v.literal("pending"), v.literal("done"), v.literal("waived")),
    doneBy: v.optional(v.string()),
    doneAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_revision", ["revisionId"])
    .index("by_assignee_state", ["assigneeId", "state"]),

  /**
   * 文章の下書き（F-12 の前段）。1 制作物に 1 つ。本文はエディタ（ProseMirror）の JSON 文字列と平文。
   * 共同編集は後続（§3.2）なので、version による楽観的排他だけを行う。
   */
  /** SNS のアカウント（本体の設定。プレビューの見た目だけ。ログイン情報は持たない） */
  socialProfiles: defineTable({
    platform: v.union(v.literal("instagram"), v.literal("x")),
    displayName: v.string(),
    username: v.string(),
    avatar: v.optional(v.string()),
    bio: v.optional(v.string()),
    verified: v.boolean(),
    stats: v.optional(
      v.object({
        posts: v.optional(v.number()),
        followers: v.optional(v.number()),
        following: v.optional(v.number()),
      }),
    ),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }),

  /**
   * 組織（局 › 担当 の 2 階層。利用者決定 2026-10-15。管理画面で管理し、Nogiku との同期は後続）。
   * 局は parentId を持たず、担当は局の ID を parentId に持つ。制作物の ownerTeamId・productionTeamIds が指す。
   */
  teams: defineTable({
    name: v.string(),
    kind: v.union(v.literal("bureau"), v.literal("team")),
    parentId: v.optional(v.string()),
    order: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_parent", ["parentId"]),

  documentDrafts: defineTable({
    workId: v.id("works"),
    title: v.string(),
    content: v.string(),
    text: v.string(),
    version: v.number(),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_work", ["workId"]),

  /** 版比較の手動ページ対応（同じ添付の組で再利用。表示専用で、指摘の座標は書き換えない） */
  alignmentOverrides: defineTable({
    workId: v.id("works"),
    leftArtifactId: v.string(),
    rightArtifactId: v.string(),
    pairs: v.array(
      v.object({ left: v.union(v.number(), v.null()), right: v.union(v.number(), v.null()) }),
    ),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_artifacts", ["leftArtifactId", "rightArtifactId"]),

  /** 提出時の自動校正の実行（版ごとに 1 件） */
  proofreadingRuns: defineTable(vProofreadingRunFields).index("by_revision", ["revisionId"]),

  // ---------------------------------------------------------------- 表記統一
  /** カテゴリ（保存したものが既定カテゴリを上書きする） */
  ruleCategories: defineTable(vRuleCategoryFields).index("by_code", ["code"]),
  /** ルールの現在の版（削除せず enabled で無効化） */
  notationRules: defineTable(vRuleFields)
    .index("by_ruleId", ["ruleId"])
    .index("by_category", ["categoryCode"]),
  /** ルールの全版（校正結果は ruleId + revision でここを引く） */
  ruleRevisions: defineTable({
    ruleId: v.string(),
    revision: v.number(),
    rule: v.object(vRuleFields),
    operation: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("disable"),
      v.literal("enable"),
      v.literal("import"),
      v.literal("proposal"),
    ),
    reason: v.string(),
    actorId: v.string(),
    at: v.number(),
    proposalId: v.optional(v.string()),
  }).index("by_rule", ["ruleId", "revision"]),
  /** カテゴリ管理者（システム管理者が個人単位で設定） */
  ruleCategoryManagers: defineTable({
    userId: v.string(),
    categoryCode: v.string(),
    assignedBy: v.string(),
    assignedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_category", ["categoryCode"]),
  /** ルールの変更提案・誤表記の報告 */
  ruleProposals: defineTable({
    kind: vProposalKind,
    categoryCode: v.string(),
    ruleId: v.optional(v.string()),
    title: v.string(),
    correct: v.array(v.string()),
    incorrect: v.array(v.string()),
    patterns: v.array(v.string()),
    exceptions: v.array(vRuleException),
    reason: v.string(),
    context: vProposalContext,
    status: vProposalStatus,
    dedupeKey: v.string(),
    proposedBy: v.string(),
    proposedAt: v.number(),
    supporters: v.array(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    resultRuleId: v.optional(v.string()),
    resultRevision: v.optional(v.number()),
  })
    .index("by_status", ["status", "proposedAt"])
    .index("by_key", ["dedupeKey", "status"]),

  /**
   * 自分だけのダッシュボード（W-26）の節の構成。アカウントごとに 1 行（PC とスマホで共通）。
   * 知らない節の ID は読むときに捨て、あとから足した節は既定で末尾に足す（domain の normalizeDashboardLayout）。
   */
  dashboardLayouts: defineTable({
    userId: v.string(),
    widgets: v.array(
      v.object({
        id: v.string(),
        visible: v.boolean(),
        /** 表示件数: 3・5・null（すべて） */
        limit: v.union(v.number(), v.null()),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  /** ホームにピン留めした制作物（アカウントごと） */
  workPins: defineTable({
    userId: v.string(),
    workId: v.id("works"),
    pinnedAt: v.number(),
  })
    .index("by_userId_and_pinnedAt", ["userId", "pinnedAt"])
    .index("by_userId_and_workId", ["userId", "workId"]),

  /** 最近開いた制作物（エディタを開いたら記録。同じ制作物は 1 行。アカウントごとに上限まで） */
  recentWorks: defineTable({
    userId: v.string(),
    workId: v.id("works"),
    openedAt: v.number(),
  })
    .index("by_userId_and_openedAt", ["userId", "openedAt"])
    .index("by_userId_and_workId", ["userId", "workId"]),

  // ---------------------------------------------------------------- 制作のフィードバック（表現の議論）
  /**
   * スレッド（制作物ごとに複数）。正式な校正（版・コメント）とは別の表。
   * 参加者（投稿したことのある人）は通知の宛先。人数は限られるので配列で持つ。
   */
  feedbackThreads: defineTable({
    workId: v.id("works"),
    title: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    lastPostAt: v.number(),
    postCount: v.number(),
    participantIds: v.array(v.string()),
  })
    .index("by_work", ["workId", "lastPostAt"])
    .index("by_last_post", ["lastPostAt"]),

  /** 投稿。削除は deletedAt（論理削除）。リアクションは絵文字ごとに押した人 */
  feedbackPosts: defineTable({
    threadId: v.id("feedbackThreads"),
    workId: v.id("works"),
    authorId: v.string(),
    body: v.string(),
    mentions: v.array(v.string()),
    fileIds: v.array(v.string()),
    template: v.optional(vFeedbackTemplateId),
    reactions: v.array(v.object({ emoji: v.string(), userIds: v.array(v.string()) })),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  }).index("by_thread", ["threadId", "createdAt"]),

  /**
   * 投稿の添付（R2 の feedback/ の下）。準備 → Hono で実体検証 → 投稿に付ける。
   * 付けないまま 24 時間たったものは abandonedAt を付け、Hono の清掃で R2 から消す（purgedAt）。
   */
  feedbackFiles: defineTable({
    workId: v.id("works"),
    uploaderId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    type: v.union(v.literal("pdf"), v.literal("image"), v.literal("document"), v.literal("other")),
    declaredSize: v.optional(v.number()),
    size: v.optional(v.number()),
    sha256: v.optional(v.string()),
    objectKey: v.string(),
    status: artifactStatus,
    postId: v.optional(v.string()),
    createdAt: v.number(),
    failureMessage: v.optional(v.string()),
    abandonedAt: v.optional(v.number()),
    purgedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId", "createdAt"])
    .index("by_uploader", ["uploaderId", "createdAt"])
    .index("by_purged_and_abandoned", ["purgedAt", "abandonedAt"]),

  /** 既読の印（人 × スレッドで 1 行） */
  feedbackReads: defineTable({
    userId: v.string(),
    threadId: v.id("feedbackThreads"),
    readAt: v.number(),
  }).index("by_user_thread", ["userId", "threadId"]),

  /** アプリ内通知（F-11）。外部送信（Slack）は後続で NotificationJob に分離する。 */
  notifications: defineTable({
    recipientId: v.string(),
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    workId: v.optional(v.string()),
    revisionId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_recipient", ["recipientId", "createdAt"])
    // 未読の数・「すべて既読」は未読（readAt なし）だけをこの索引で読む。createdAt で「押した時刻まで」に区切る
    .index("by_recipient_read_created", ["recipientId", "readAt", "createdAt"]),

  approvalEvents: defineTable({
    workId: v.id("works"),
    revisionId: v.string(),
    actorId: v.string(),
    action: approvalAction,
    requiredChecksSnapshot: v.any(),
    exceptionReason: v.optional(v.string()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_work", ["workId"]),

  /**
   * 独立確認（D2）。制作者＝校了権限者の制作物で、制作者・校了権限者以外の人が
   * 自分の操作で「この版を確認した」と記録したもの。校了はこの記録を版ごとに確かめる（申告の ID は使わない）。
   */
  approvalConfirmations: defineTable({
    workId: v.id("works"),
    revisionId: v.id("revisions"),
    confirmerId: v.id("users"),
    confirmedAt: v.number(),
    note: v.optional(v.string()),
  }).index("by_revision", ["revisionId"]),

  auditEvents: defineTable({
    entityType: v.string(),
    entityId: v.string(),
    operation: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    at: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_at", ["at"]),

  idempotencyKeys: defineTable({
    scope: v.string(),
    key: v.string(),
    result: v.any(),
    createdAt: v.number(),
  }).index("by_scope_key", ["scope", "key"]),
});
