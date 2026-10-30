import { DomainError } from "../shared/DomainError.ts";
import type { UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { Artifact, ArtifactOrigin, ArtifactRole, ArtifactType } from "./Artifact.ts";
import type { Revision, RevisionKind } from "./Revision.ts";
import type { RevisionDeclarations, SubmissionCheckId } from "../work/metadata.ts";
import { resolveStoredType } from "./graphicFiles.ts";

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
  deadlineAt?: Instant;
  /** 提出ダイアログの「緊急」トグル（確定時に版へ写す） */
  reviewUrgent?: boolean;
  changeSummary: string;
  focusNotes: string;
  state: UploadSessionState;
  createdAt: Instant;
  /** 放置されたセッションの清掃期限 */
  expiresAt: Instant;
  confirmedRevisionId?: string;
  /**
   * 準備した時点の作品の版の数（無効化した版を含む。版は削除しない）。サーバーが準備時に記録する。
   * 確定時に必ず今の版の数と比べ、間に別の提出が確定していれば競合として確定しない（§5.2-11）。
   * クライアントは省略も変更もできない。
   */
  baseRevisionCount: number;
  /** 確定時に作る専門確認（§2.2-4）。 */
  requiredChecks?: Array<{ type: string; label: string; assigneeId?: string }>;
  /** 提出時の申告・確認（確定時に版へ写す） */
  declarations?: RevisionDeclarations;
  selfChecks?: readonly SubmissionCheckId[];
  /** abandoned 後に R2 の孤立オブジェクトを全て削除し終えた時刻（D14 清掃） */
  purgedAt?: Instant;
}

export type UploadItemStatus = "pending" | "uploaded" | "verified" | "failed";

export interface UploadItem {
  id: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  type: ArtifactType;
  role: ArtifactRole;
  /** R2 キーの名前空間（準備時に予約）。試行ごとのキーはこの下に作る。外部リンクの場合は持たない */
  keyPrefix?: string;
  /**
   * 採用された試行のキー（実体の検証が済んだときだけ）。確定時に Artifact がこのキーを参照する。
   * 外部リンク・未検証の項目は持たない。
   */
  objectKey?: string;
  externalUrl?: string;
  declaredSize?: number;
  size?: number;
  sha256?: string;
  pageCount?: number;
  status: UploadItemStatus;
  failureMessage?: string;
  /** R2 上のオブジェクトを清掃で削除した時刻（objectKey は履歴のため残す） */
  purgedAt?: Instant;
  /** 由来（Figma から取り込む項目は準備時に fileKey・nodeId を持ち、取り込み完了でノード名などが埋まる） */
  origin?: ArtifactOrigin;
}

/** Figma から取り込んだときに Figma の応答から埋める値（ノード名・版・フレームの大きさ） */
export interface FigmaImportMeta {
  nodeName: string;
  figmaVersion?: string;
  lastModified?: string;
  box: { width: number; height: number };
}

/** ノード名からファイル名を作る（記号は "_"、空なら nodeId。拡張子 .png） */
export function figmaFrameFileName(nodeName: string, nodeId: string): string {
  const base =
    Array.from(nodeName)
      .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? "_" : c))
      .join("")
      .trim()
      .slice(0, 80) || `figma-${nodeId.replace(":", "-")}`;
  return `${base}.png`;
}

/**
 * 1 ファイルの大きさの上限。実体は Worker の 1 リクエストで受けるため、Cloudflare Workers の本文の上限（100 MB）に収める。
 * 超える本文は Worker に届く前に platform が断り、ブラウザには原因の分からない通信エラーになるので、
 * 準備のとき（申告サイズ）・画面で選んだとき・Worker が本文を受ける前に、同じ値で断って理由を返す。
 * Illustrator・InDesign の原本は数十 MB が普通なので収まる。リンクを貼って運用する大きな原本は上限を超える分だけ別の手段にする
 */
export const MAX_UPLOAD_BYTES = 100 * 1000 * 1000;

/** 申告されたサイズが上限内か。超えるときは upload_file_too_large（どのファイルか・上限を details に） */
export function assertUploadSizeWithinLimit(fileName: string, size: number | undefined): void {
  if (size !== undefined && size > MAX_UPLOAD_BYTES)
    throw new DomainError("upload_file_too_large", { fileName, size, limit: MAX_UPLOAD_BYTES });
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

/**
 * 確定時の競合比較（§5.2-11 競合する同時提出を一件だけ確定する）。
 * 準備した後に同じ作品で別の版が確定していれば、この提出は確定しない（準備し直してもらう）。
 */
export function assertSubmissionBaseCurrent(
  session: UploadSession,
  revisions: readonly Revision[],
): void {
  if (session.baseRevisionCount !== revisions.length)
    throw new DomainError("revision_submission_conflict", {
      sessionId: session.id,
      expected: session.baseRevisionCount ?? null,
      actual: revisions.length,
    });
}

/** 実体を受け付けられる項目か（ファイルの項目で、まだ検証が済んでいないもの） */
export function assertItemUploadable(item: UploadItem): void {
  if (item.role === "external" || item.keyPrefix === undefined)
    throw new DomainError("upload_item_invalid_state", {
      itemId: item.id,
      reason: "external_link",
    });
  if (item.status === "verified")
    throw new DomainError("upload_item_invalid_state", {
      itemId: item.id,
      reason: "already_verified",
    });
}

/**
 * R2 上の実体確認が済んだことを記録する。失敗は failed として理由を残し、再実行（再アップロード）を許す。
 * objectKey は検証した試行のキー。成功したときだけ項目が参照する（採用）。
 */
export function markItemVerified(
  item: UploadItem,
  meta: {
    size: number;
    sha256: string;
    objectKey: string;
    pageCount?: number;
    /**
     * Worker が実体の先頭を見た結果（.ai だけ。PDF の見出しがあれば true）。.ai の種類はこれで決まる
     * （true なら PDF として紙面に出せる。それ以外は other でダウンロードのみ）
     */
    pdfCompatible?: boolean;
    /** Figma から取り込んだ項目（origin.kind が figma）にだけ反映する。ノード名がファイル名になる */
    figma?: FigmaImportMeta;
  },
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
  const next: UploadItem = {
    ...item,
    status: "verified",
    size: meta.size,
    sha256: meta.sha256,
    objectKey: meta.objectKey,
    type: resolveStoredType(item, meta.pdfCompatible),
  };
  delete next.failureMessage;
  if (meta.pageCount !== undefined) next.pageCount = meta.pageCount;
  if (meta.figma && item.origin?.kind === "figma") {
    next.origin = {
      ...item.origin,
      nodeName: meta.figma.nodeName,
      box: meta.figma.box,
      ...(meta.figma.figmaVersion ? { figmaVersion: meta.figma.figmaVersion } : {}),
      ...(meta.figma.lastModified ? { lastModified: meta.figma.lastModified } : {}),
    };
    next.fileName = figmaFrameFileName(meta.figma.nodeName, item.origin.nodeId);
  }
  return next;
}

/** 失敗を記録する。検証済み（採用済み）の項目は、別の試行の失敗や遅れた補償で failed に戻さない */
export function markItemFailed(item: UploadItem, message: string): UploadItem {
  if (item.status === "verified") return item;
  return { ...item, status: "failed", failureMessage: message };
}

/** 確定可能条件: 1 件以上あり、外部リンク以外はすべて verified。満たさない場合は原因と対象ファイルを返す。 */
export function assertItemsReadyForConfirm(items: readonly UploadItem[]): void {
  if (items.length === 0) throw new DomainError("revision_no_artifacts");
  const notReady = items.filter(
    (i) => i.role !== "external" && (i.status !== "verified" || i.objectKey === undefined),
  );
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
  if (item.origin !== undefined) a.origin = item.origin;
  return a;
}
