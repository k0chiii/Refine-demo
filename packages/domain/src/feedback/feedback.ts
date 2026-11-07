import type { Anchor } from "../comment/Anchor.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { ReactionEntry } from "../shared/reactions.ts";

/**
 * 制作のフィードバック（表現の議論）の旧データの型。利用者決定 2026-10-20「FB はコメントへ統合する」で、
 * 機能は廃止し、既存のスレッドは migration.ts でコメントへ移す。ここに残すのは、その移行と削除に要る型だけ。
 * FB の表（feedbackThreads / feedbackPosts / feedbackFiles / feedbackReads）は、本番で移行と削除を流した後の変更で schema から落とす。
 */

/** 投稿テンプレートの ID（旧データの投稿が持つ。テンプレート自体は廃止） */
export const feedbackTemplateIds = ["creator_first", "creator_update", "reviewer"] as const;
export type FeedbackTemplateId = (typeof feedbackTemplateIds)[number];

export interface FeedbackThread {
  id: string;
  workId: WorkId;
  title: string;
  createdBy: UserId;
  createdAt: Instant;
  /** 最後に投稿された時刻（一覧の並び・未読の判定） */
  lastPostAt: Instant;
  /** 削除されていない投稿の数 */
  postCount: number;
  /** 投稿したことのある人（通知の宛先） */
  participantIds: UserId[];
  /**
   * 版の上の場所についての相談（利用者決定 2026-10-15: コメントは指摘して解決するもの、FB は解決しない話し合い。
   * FB もコメントと同じように範囲を指定して立てられる）。revisionId だけなら「この版について」、anchor があれば紙面の場所
   */
  revisionId?: RevisionId;
  anchor?: Anchor;
  /**
   * 削除（論理削除。利用者指示 2026-10-19: システム管理者はスレッドも削除できる）。
   * 削除したスレッドと中の投稿は、一覧・集計・開く画面のどこにも出さない（行と投稿は監査のために残す）
   */
  deletedAt?: Instant;
}

export type FeedbackReactionEntry = ReactionEntry;

export interface FeedbackPost {
  id: string;
  threadId: string;
  workId: WorkId;
  authorId: UserId;
  body: string;
  mentions: UserId[];
  fileIds: string[];
  template?: FeedbackTemplateId;
  reactions: FeedbackReactionEntry[];
  createdAt: Instant;
  editedAt?: Instant;
  /** 削除（論理削除）。スレッドの投稿・件数・最後の投稿・未読から外し、一覧に印も残さない。添付は読めなくなる */
  deletedAt?: Instant;
}

export type FeedbackFileType = "pdf" | "image" | "document" | "other";
export type FeedbackFileStatus = "pending" | "uploaded" | "verified" | "failed";

export interface FeedbackFile {
  id: string;
  workId: WorkId;
  uploaderId: UserId;
  fileName: string;
  mimeType: string;
  type: FeedbackFileType;
  declaredSize?: number;
  size?: number;
  sha256?: string;
  /** R2 キーの名前空間（準備時に予約）。試行ごとのキーはこの下に作る */
  keyPrefix?: string;
  /** 採用された試行のキー（実体の検証が済んだときだけ。それまでは空文字） */
  objectKey: string;
  status: FeedbackFileStatus;
  /** 付けた投稿（付けるまでは未設定。付けた後は他の投稿に付け替えない） */
  postId?: string;
  createdAt: Instant;
  failureMessage?: string;
  /** 投稿に付けないまま期限を過ぎ、清掃の対象になった時刻 */
  abandonedAt?: Instant;
  /** R2 から実体を削除し終えた時刻（objectKey は履歴のため残す） */
  purgedAt?: Instant;
}
