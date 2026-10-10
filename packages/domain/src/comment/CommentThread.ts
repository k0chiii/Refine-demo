import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId, RevisionId, ThreadId, UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Anchor } from "./Anchor.ts";

/** スレッド種別（§9.1 設計案） */
export const threadKinds = ["correction", "question", "discussion", "decision"] as const;
export type ThreadKind = (typeof threadKinds)[number];

/** 重大度は独立属性。「重大指摘」の定義は D6 で承認待ちのため、ポリシー側で閾値を設定できるようにする。 */
export const severities = ["critical", "major", "minor", "info"] as const;
export type Severity = (typeof severities)[number];

/** Comment.resolution（§5.1）。accepted=反映すると判断、resolved=反映済みなど確認された。単一フラグに統合しない。 */
export const resolutions = ["open", "acknowledged", "accepted", "rejected", "deferred", "resolved"] as const;
export type Resolution = (typeof resolutions)[number];

export interface CommentThread {
  id: ThreadId;
  revisionId: RevisionId;
  artifactId?: ArtifactId;
  authorId: UserId;
  /** 原文は不変。訂正は CommentEvent として別に記録する。 */
  body: string;
  kind: ThreadKind;
  severity: Severity;
  anchor?: Anchor;
  resolution: Resolution;
  createdAt: Instant;
  /** 前版からの引き継ぎ元 */
  carriedFromThreadId?: ThreadId;
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
    throw new DomainError("comment_invalid_resolution_transition", { from: thread.resolution, to: action });
  }
  if (requiresReason(action) && (reason === undefined || reason.trim() === "")) {
    throw new DomainError("comment_reason_required", { action });
  }
  return { ...thread, resolution: action };
}

/** 校了をブロックする「未対応の重大な指摘」か。閾値はポリシーで差し替え可能（D6）。 */
export function isBlockingForApproval(thread: CommentThread, blockingSeverities: readonly Severity[]): boolean {
  if (thread.kind === "discussion") return false;
  if (!blockingSeverities.includes(thread.severity)) return false;
  return thread.resolution === "open" || thread.resolution === "acknowledged" || thread.resolution === "accepted";
}

export type CommentEventType =
  | "created"
  | "replied"
  | "decided"
  | "edited"
  | "carried_forward";

export interface CommentEvent {
  threadId: ThreadId;
  eventType: CommentEventType;
  actorId: UserId;
  reason?: string;
  payload?: Record<string, unknown>;
  createdAt: Instant;
}
