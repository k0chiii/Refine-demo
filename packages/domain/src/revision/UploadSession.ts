import { DomainError } from "../shared/DomainError.ts";
import type { UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Artifact, ArtifactRole, ArtifactType } from "./Artifact.ts";
import type { RevisionKind } from "./Revision.ts";

/**
 * 版提出の「準備」と「確定」を分離する（F-04 / §8.1 / A-02 / A-16）。
 * - ブラウザは準備（セッション作成）→ 各ファイルを R2 へ転送 → サーバー側で実体検証 → 確定、の順で進む。
 * - 確定（confirm）に成功した瞬間だけ Revision が生まれ、同一トランザクションで旧版を閉じる。
 * - 準備中・失敗・未検証の間は旧版の受付に一切影響しない。
 */
export type UploadSessionState = "open" | "confirmed" | "abandoned";

export interface UploadSession {
  id: string;
  workId: WorkId;
  submittedBy: UserId;
  kind: RevisionKind;
  reviewType: string;
  deadlineAt: Instant;
  changeSummary: string;
  focusNotes: string;
  state: UploadSessionState;
  createdAt: Instant;
  /** 放置されたセッションの清掃期限 */
  expiresAt: Instant;
  confirmedRevisionId?: string;
  /** 確定時に作る専門確認（§2.2-4）。 */
  requiredChecks?: Array<{ type: string; label: string; assigneeId?: string }>;
}

export type UploadItemStatus = "pending" | "uploaded" | "verified" | "failed";

export interface UploadItem {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  type: ArtifactType;
  role: ArtifactRole;
  /** 外部リンクの場合は objectKey を持たない */
  objectKey?: string;
  externalUrl?: string;
  declaredSize?: number;
  size?: number;
  sha256?: string;
  pageCount?: number;
  status: UploadItemStatus;
  failureMessage?: string;
}

export function assertSessionOpen(session: UploadSession, now: Instant): void {
  if (session.state !== "open")
    throw new DomainError("upload_session_not_open", {
      sessionId: session.id,
      state: session.state,
    });
  if (now >= session.expiresAt)
    throw new DomainError("upload_session_expired", { sessionId: session.id });
}

/** R2 上の実体確認が済んだことを記録する。失敗は failed として理由を残し、再実行（再アップロード）を許す。 */
export function markItemVerified(
  item: UploadItem,
  meta: { size: number; sha256: string; pageCount?: number },
): UploadItem {
  if (item.role === "external")
    throw new DomainError("upload_item_invalid_state", {
      itemId: item.id,
      reason: "external_link",
    });
  if (item.declaredSize !== undefined && item.declaredSize !== meta.size) {
    return {
      ...item,
      status: "failed",
      failureMessage: `サイズ不一致: 申告 ${item.declaredSize} / 実体 ${meta.size}`,
    };
  }
  const next: UploadItem = { ...item, status: "verified", size: meta.size, sha256: meta.sha256 };
  delete next.failureMessage;
  if (meta.pageCount !== undefined) next.pageCount = meta.pageCount;
  return next;
}

export function markItemFailed(item: UploadItem, message: string): UploadItem {
  return { ...item, status: "failed", failureMessage: message };
}

/** 確定可能条件: 1 件以上あり、外部リンク以外はすべて verified。満たさない場合は原因と対象ファイルを返す。 */
export function assertItemsReadyForConfirm(items: readonly UploadItem[]): void {
  if (items.length === 0) throw new DomainError("revision_no_artifacts");
  const notReady = items.filter((i) => i.role !== "external" && i.status !== "verified");
  if (notReady.length > 0) {
    throw new DomainError("revision_artifacts_not_verified", {
      items: notReady.map((i) => ({
        id: i.id,
        fileName: i.fileName,
        status: i.status,
        failureMessage: i.failureMessage ?? null,
      })),
    });
  }
}

export function toArtifact(item: UploadItem, revisionId: string): Omit<Artifact, "id"> {
  const a: Omit<Artifact, "id"> = {
    revisionId,
    type: item.type,
    role: item.role,
    fileName: item.fileName,
    mimeType: item.mimeType,
    status: item.role === "external" ? "verified" : item.status,
  };
  if (item.objectKey !== undefined) a.objectKey = item.objectKey;
  if (item.externalUrl !== undefined) a.externalUrl = item.externalUrl;
  if (item.sha256 !== undefined) a.sha256 = item.sha256;
  if (item.size !== undefined) a.size = item.size;
  if (item.pageCount !== undefined) a.pageCount = item.pageCount;
  return a;
}
