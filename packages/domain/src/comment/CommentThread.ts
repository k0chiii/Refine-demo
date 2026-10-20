import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId, RevisionId, ThreadId, UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Anchor } from "./Anchor.ts";
import type { BotOrigin } from "../notation/autoProofread.ts";
import type { ReactionEntry } from "../shared/reactions.ts";
import { type CommentBodyFormat, validateCommentBody } from "./body.ts";

/** スレッド種別（§9.1 設計案） */
export const threadKinds = ["correction", "question", "discussion", "decision"] as const;
export type ThreadKind = (typeof threadKinds)[number];

/** 重大度は独立属性。「重大指摘」の定義は D6 で承認待ちのため、ポリシー側で閾値を設定できるようにする。 */
export const severities = ["critical", "major", "minor", "info"] as const;
export type Severity = (typeof severities)[number];

/** Comment.resolution（§5.1）。accepted=反映すると判断、resolved=反映済みなど確認された。単一フラグに統合しない。 */
export const resolutions = [
  "open",
  "acknowledged",
  "accepted",
  "rejected",
  "deferred",
  "resolved",
] as const;
export type Resolution = (typeof resolutions)[number];

export interface CommentThread {
  id: ThreadId;
  revisionId: RevisionId;
  artifactId?: ArtifactId;
  authorId: UserId;
  /** 原文は不変。訂正は CommentEvent として別に記録する。 */
  body: string;
  /** 本文の書式。無ければ旧来の平文（保存済みの行はすべてこれ。移行しない） */
  bodyFormat?: CommentBodyFormat;
  kind: ThreadKind;
  severity: Severity;
  anchor?: Anchor;
  resolution: Resolution;
  createdAt: Instant;
  /** 前版からの引き継ぎ元 */
  carriedFromThreadId?: ThreadId;
  /** 次版へ引き継いだ先（引き継ぎ済みの目印。元スレッドは書き換えない） */
  carriedToThreadId?: ThreadId;
  /** 対応担当者（F-07）。採否判断者が割り当てる。 */
  assigneeId?: UserId;
  /** 本文の訂正回数。訂正前の本文は CommentEvent("edited") に残す（§5.2-9）。 */
  editCount?: number;
  /** 自動校正の指摘（投稿者はシステム）。人の投稿では設定しない */
  origin?: BotOrigin;
  /** 本文でメンションした人（制作物を見られる人だけ。validateMentions） */
  mentions?: UserId[];
  /**
   * 投稿者が削除した時刻（論理削除。原文と履歴は CommentEvent に残す）。
   * 削除済みのスレッドは件数・未解決・校了の判定・紙面の印から外れる（deletion.ts）。
   */
  deletedAt?: Instant;
  /** 旧仕様の名残（削除時に他の人の返信が残っていた）。今は読まない・書かない。削除したものは一覧に出さない。保存済みの行との互換のために型・スキーマに残す */
  deletedKeepsReplies?: boolean;
  /** 添付（CommentFile の ID。付けた順）。無ければ持たない。返信の添付は CommentEvent.payload.fileIds */
  fileIds?: string[];
  /** リアクション（FB と同じ絵文字・同じ規則。comment/reactions.ts）。誰も付けていなければ持たない */
  reactions?: ReactionEntry[];
}

export type DecisionAction = Exclude<Resolution, "open">;

/** 採否判断の遷移。理由は rejected / deferred で必須（C4 / A-07）。 */
const allowed: Record<Resolution, readonly Resolution[]> = {
  open: ["acknowledged", "accepted", "rejected", "deferred", "resolved"],
  acknowledged: ["accepted", "rejected", "deferred", "resolved"],
  accepted: ["resolved", "deferred", "rejected"],
  rejected: ["accepted", "deferred"], // 再検討を許す。履歴は CommentEvent に残る。
  deferred: ["accepted", "rejected", "resolved"],
  resolved: ["accepted"], // 誤って解決済みにした場合の差し戻し
};

export function requiresReason(action: DecisionAction): boolean {
  return action === "rejected" || action === "deferred";
}

export function decideThread(
  thread: CommentThread,
  action: DecisionAction,
  reason: string | undefined,
): CommentThread {
  if (!allowed[thread.resolution].includes(action)) {
    throw new DomainError("comment_invalid_resolution_transition", {
      from: thread.resolution,
      to: action,
    });
  }
  if (requiresReason(action) && (reason === undefined || reason.trim() === "")) {
    throw new DomainError("comment_reason_required", { action });
  }
  return { ...thread, resolution: action };
}

/** 校了をブロックする「未対応の重大な指摘」か。閾値はポリシーで差し替え可能（D6）。 */
export function isBlockingForApproval(
  thread: CommentThread,
  blockingSeverities: readonly Severity[],
): boolean {
  if (thread.kind === "discussion") return false;
  if (!blockingSeverities.includes(thread.severity)) return false;
  return (
    thread.resolution === "open" ||
    thread.resolution === "acknowledged" ||
    thread.resolution === "accepted"
  );
}

export type CommentEventType =
  | "created"
  | "replied"
  | "decided"
  | "edited"
  | "carried_forward"
  | "assigned"
  /** スレッドの削除（投稿者のみ。論理削除） */
  | "deleted"
  /** 返信の削除（payload.replyEventId が削除した返信。返信の本文は元のイベントに残す） */
  | "reply_deleted";

/**
 * 投稿者本人のみ、未判断（open/acknowledged）の間だけ訂正できる。訂正前の本文は呼び出し側がイベントに残す。
 * 書式は訂正後の本文の書式に置き換わる（指定が無ければ平文）。
 */
export function editThreadBody(
  thread: CommentThread,
  actorId: UserId,
  body: string,
  bodyFormat?: string,
): CommentThread {
  if (thread.authorId !== actorId)
    throw new DomainError("comment_edit_not_author", { threadId: thread.id });
  if (thread.resolution !== "open" && thread.resolution !== "acknowledged") {
    throw new DomainError("comment_invalid_resolution_transition", {
      from: thread.resolution,
      to: "edited",
    });
  }
  if (body.trim() === "") throw new DomainError("comment_reason_required", { action: "edit" });
  const format = validateCommentBody(body, bodyFormat);
  const { bodyFormat: _previous, ...rest } = thread;
  void _previous;
  return {
    ...rest,
    body,
    ...(format ? { bodyFormat: format } : {}),
    editCount: (thread.editCount ?? 0) + 1,
  };
}

/**
 * 前版の未解決指摘を次版へ引き継ぐ（F-07 / §3.2 の人手版）。
 * 原指摘は書き換えず deferred にし、新版に carriedFromThreadId 付きの新スレッドを作る。位置は次版で再指定する。
 */
export function planCarryForward(
  source: CommentThread,
  targetRevisionId: RevisionId,
  now: Instant,
): { target: Omit<CommentThread, "id">; sourceAfter: CommentThread } {
  if (source.carriedToThreadId)
    throw new DomainError("comment_already_carried", { threadId: source.id });
  if (source.revisionId === targetRevisionId)
    throw new DomainError("comment_carry_same_revision", { threadId: source.id });
  const sourceAfter: CommentThread =
    source.resolution === "open" ||
    source.resolution === "acknowledged" ||
    source.resolution === "accepted"
      ? { ...source, resolution: "deferred" }
      : source;
  const target: Omit<CommentThread, "id"> = {
    revisionId: targetRevisionId,
    authorId: source.authorId,
    body: source.body,
    ...(source.bodyFormat ? { bodyFormat: source.bodyFormat } : {}),
    kind: source.kind,
    severity: source.severity,
    resolution: "open",
    createdAt: now,
    carriedFromThreadId: source.id,
  };
  if (source.assigneeId !== undefined) target.assigneeId = source.assigneeId;
  // 自動校正の指摘は持ち越しても自動校正の指摘として表示する（根拠のルールと版も引き継ぐ）
  if (source.origin !== undefined) target.origin = source.origin;
  return { target, sourceAfter };
}

/** 次版へ持ち越す候補: 未対応・持越・採用済み未反映の指摘（反映済み・不採用は対象外）。 */
export function isCarryCandidate(thread: CommentThread): boolean {
  if (thread.carriedToThreadId) return false;
  return ["open", "acknowledged", "accepted", "deferred"].includes(thread.resolution);
}

export interface CommentEvent {
  /** 保存済みのイベントの ID（返信の削除で対象を指す。追記する時は付けない） */
  id?: string;
  threadId: ThreadId;
  eventType: CommentEventType;
  actorId: UserId;
  reason?: string;
  payload?: Record<string, unknown>;
  /** 返信（replied）へのリアクション。ほかの種類のイベントには付かない */
  reactions?: ReactionEntry[];
  createdAt: Instant;
}
