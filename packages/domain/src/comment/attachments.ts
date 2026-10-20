import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import {
  feedbackFileType,
  type FeedbackFileStatus,
  type FeedbackFileType,
} from "../feedback/feedback.ts";
import { MAX_UPLOAD_BYTES } from "../revision/UploadSession.ts";

/**
 * コメント・返信の添付（利用者決定 2026-10-20「ファイル添付、画像添付もできると良い」「添付はできる限り圧縮して良い」）。
 * - FB の添付（feedback/feedback.ts）と同じ流れ: 準備（R2 のキーを予約）→ Hono が実体を検証 → コメントまたは返信に付ける。
 * - 画像は、ブラウザが縮小・再圧縮した実体（原本より小さいときだけ）と、一覧用のサムネイル（任意）を持つ。
 * - 付けられるのは、本人が同じ制作物に上げて検証済みになった、まだどこにも付けていない添付だけ。
 * - 読めるのは、その制作物を見られる人で、コメント（返信）が削除されていないとき。削除したら誰も読めず、清掃の対象になる。
 */

/** 1 つのコメント・返信に付けられるファイルの数 */
export const COMMENT_FILES_MAX = 10;
/** 1 ファイルの大きさの上限（アップロードする実体。版の提出物・FB と同じ） */
export const COMMENT_FILE_MAX_BYTES = MAX_UPLOAD_BYTES;
/** 添付の置き場（R2 のオブジェクトキーの頭）。版の提出物（works/…）・FB（feedback/…）と名前空間を分ける */
export const COMMENT_OBJECT_PREFIX = "comments/";
/** コメントに付けないまま放置された添付を清掃の対象にするまでの時間 */
export const COMMENT_FILE_TTL_MS = 24 * 60 * 60 * 1000;
/** サムネイルの大きさの上限（バイト）。一覧に何枚も並ぶので小さく保つ */
export const COMMENT_THUMB_MAX_BYTES = 512 * 1024;
/** サムネイルに使える形式 */
export const COMMENT_THUMB_MIMES = ["image/webp", "image/jpeg"] as const;
export type CommentThumbMime = (typeof COMMENT_THUMB_MIMES)[number];
/** 画像の幅・高さとして受け付ける上限（px）。申告の検査だけで、縮小はブラウザの仕事 */
export const COMMENT_IMAGE_DIMENSION_MAX = 65_535;

export type CommentFileType = FeedbackFileType;
export type CommentFileStatus = FeedbackFileStatus;

export interface CommentFile {
  id: string;
  workId: WorkId;
  /** 準備のときの版（返信に付けるときは、付けた先のスレッドの版に更新する） */
  revisionId: RevisionId;
  uploaderId: UserId;
  /** 保存するファイル名（ブラウザが再圧縮したら拡張子も変わる。ダウンロードの名前） */
  fileName: string;
  /** 利用者が選んだ元のファイル名（圧縮前） */
  originalName: string;
  mimeType: string;
  type: CommentFileType;
  declaredSize?: number;
  size?: number;
  /** 圧縮する前の大きさ（画像を縮小・再圧縮したときの記録。表示や検証には使わない） */
  originalSize?: number;
  sha256?: string;
  /** R2 キーの名前空間（準備時に予約）。試行ごとのキーはこの下に作る */
  keyPrefix?: string;
  /** 採用された試行のキー（実体の検証が済んだときだけ。それまでは空文字） */
  objectKey: string;
  status: CommentFileStatus;
  /** 画像の幅・高さ（px。表示の枠取りに使う。ブラウザの申告） */
  width?: number;
  height?: number;
  /** サムネイル（任意。画像だけ）。置き場は keyPrefix の下の固定キー */
  thumbObjectKey?: string;
  thumbSize?: number;
  thumbMime?: CommentThumbMime;
  /** 付けた先（付けるまでは未設定。付けた後は付け替えない）。返信に付けたときは eventId も */
  threadId?: string;
  eventId?: string;
  createdAt: Instant;
  failureMessage?: string;
  /** コメントに付けないまま期限を過ぎ、清掃の対象になった時刻 */
  abandonedAt?: Instant;
  /** 付けたコメント・返信が削除されて手放した時刻（清掃の対象。以後は誰も読めない） */
  removedAt?: Instant;
  /** R2 から実体を削除し終えた時刻（objectKey は履歴のため残す） */
  purgedAt?: Instant;
}

/** 画面に渡す添付の要約（コメント・返信の files） */
export interface CommentFileView {
  id: string;
  name: string;
  mime: string;
  size: number;
  type: CommentFileType;
  width?: number;
  height?: number;
  hasThumb: boolean;
}

// ---------------------------------------------------------------- 検査

const invalid = (field: string, reason: string, extra: Record<string, unknown> = {}): never => {
  throw new DomainError("comment_file_invalid", { field, reason, ...extra });
};

/** 添付の種類（FB と同じ分類）: PDF・画像・文書・その他。SVG は中にスクリプトを持てるので画像として扱わない（other） */
export function commentFileType(mimeType: string, fileName: string): CommentFileType {
  return feedbackFileType(mimeType, fileName);
}

/** 添付のファイル名の検査（前後の空白を除いて 1〜200 文字） */
export function validateCommentFileName(fileName: string): string {
  const n = fileName.trim();
  if (n === "") invalid("fileName", "required");
  if (Array.from(n).length > 200) invalid("fileName", "too_long", { max: 200 });
  return n;
}

/** 添付の数（重複を除いて 10 件まで） */
export function validateCommentFileIds(fileIds: readonly string[] | undefined): string[] {
  const ids = [...new Set(fileIds ?? [])];
  if (ids.length > COMMENT_FILES_MAX) invalid("files", "too_many", { max: COMMENT_FILES_MAX });
  return ids;
}

/** 準備のとき申告する値の検査（大きさは 0 以上・上限以内、画像の寸法は 1 以上の整数） */
export interface CommentFileDeclaration {
  fileName: string;
  originalName?: string;
  mimeType: string;
  size: number;
  originalSize?: number;
  width?: number;
  height?: number;
}

export interface ValidatedCommentFileDeclaration {
  fileName: string;
  originalName: string;
  mimeType: string;
  type: CommentFileType;
  size: number;
  originalSize?: number;
  width?: number;
  height?: number;
}

export function validateCommentFileDeclaration(
  d: CommentFileDeclaration,
): ValidatedCommentFileDeclaration {
  const fileName = validateCommentFileName(d.fileName);
  const originalName =
    d.originalName === undefined ? fileName : validateCommentFileName(d.originalName);
  if (!Number.isFinite(d.size) || d.size < 0) invalid("size", "invalid");
  if (d.size > COMMENT_FILE_MAX_BYTES)
    throw new DomainError("upload_file_too_large", {
      fileName,
      size: d.size,
      limit: COMMENT_FILE_MAX_BYTES,
    });
  if (d.originalSize !== undefined && (!Number.isFinite(d.originalSize) || d.originalSize < 0))
    invalid("originalSize", "invalid");
  const dimension = (field: string, value: number | undefined) => {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value < 1 || value > COMMENT_IMAGE_DIMENSION_MAX)
      invalid(field, "invalid");
    return value;
  };
  const width = dimension("width", d.width);
  const height = dimension("height", d.height);
  const mimeType = d.mimeType || "application/octet-stream";
  return {
    fileName,
    originalName,
    mimeType,
    type: commentFileType(mimeType, fileName),
    size: d.size,
    ...(d.originalSize !== undefined ? { originalSize: d.originalSize } : {}),
    // 寸法は画像のときだけ意味がある。片方だけの申告は捨てる
    ...(width !== undefined &&
    height !== undefined &&
    commentFileType(mimeType, fileName) === "image"
      ? { width, height }
      : {}),
  };
}

// ---------------------------------------------------------------- R2 のキー

/**
 * R2 キーの名前空間: comments/{制作物}/{添付 ID}/{ファイル名}。推測困難な ID で名前空間を分ける。
 * 実体はこの下の試行ごとのキー（uploadAttemptObjectKey）に置く。
 */
export function commentFileKeyPrefix(workId: WorkId, fileId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-぀-ヿ一-龯]+/g, "_").slice(0, 120) || "file";
  return `${COMMENT_OBJECT_PREFIX}${workId}/${fileId}/${safe}`;
}

/** サムネイルのキー（添付の名前空間の下の固定キー。試行のキー `…/attempts/{id}` と重ならない） */
export function commentThumbObjectKey(keyPrefix: string): string {
  return `${keyPrefix}/thumb`;
}

// ---------------------------------------------------------------- 検証・状態

/**
 * R2 上の実体確認が済んだことを記録する。申告サイズと違えば failed。
 * objectKey は検証した試行のキー。成功したときだけ添付が参照する（採用）。
 */
export function verifyCommentFile(
  file: CommentFile,
  meta: { size: number; sha256: string; objectKey: string },
): CommentFile {
  if (file.declaredSize !== undefined && file.declaredSize !== meta.size) {
    return {
      ...file,
      status: "failed",
      failureMessage: `サイズ不一致: 申告 ${file.declaredSize} / 実体 ${meta.size}`,
    };
  }
  if (meta.size > COMMENT_FILE_MAX_BYTES)
    return {
      ...file,
      status: "failed",
      failureMessage: `ファイルが大きすぎます: ${meta.size}`,
    };
  const next: CommentFile = {
    ...file,
    status: "verified",
    size: meta.size,
    sha256: meta.sha256,
    objectKey: meta.objectKey,
  };
  delete next.failureMessage;
  return next;
}

/** 失敗を記録する。検証済み（採用済み）の添付は、別の試行の失敗や遅れた補償で failed に戻さない */
export function failCommentFile(file: CommentFile, message: string): CommentFile {
  if (file.status === "verified") return file;
  return { ...file, status: "failed", failureMessage: message };
}

/** まだ手放されていない・どこにも付けていない添付か（アップロード・サムネイルを受けてよい状態） */
function isOpenForUpload(file: CommentFile): boolean {
  return (
    file.threadId === undefined &&
    file.abandonedAt === undefined &&
    file.removedAt === undefined &&
    file.keyPrefix !== undefined
  );
}

/** アップロードを受け付けられる添付か（本人の・コメントに付ける前の・放置されていない・未検証のもの） */
export function assertCommentFileUploadable(file: CommentFile, uploaderId: UserId): void {
  if (file.uploaderId !== uploaderId)
    throw new DomainError("comment_file_not_found", { fileId: file.id });
  if (!isOpenForUpload(file))
    throw new DomainError("comment_file_invalid", { fileId: file.id, reason: "closed" });
  if (file.status === "verified")
    throw new DomainError("comment_file_invalid", { fileId: file.id, reason: "already_verified" });
}

/** サムネイルを受け付けられる添付か（本人の・画像の・付ける前の・放置されていない・失敗していないもの） */
export function assertCommentThumbUploadable(file: CommentFile, uploaderId: UserId): void {
  if (file.uploaderId !== uploaderId)
    throw new DomainError("comment_file_not_found", { fileId: file.id });
  if (!isOpenForUpload(file) || file.status === "failed")
    throw new DomainError("comment_file_invalid", { fileId: file.id, reason: "closed" });
  if (file.type !== "image")
    throw new DomainError("comment_file_invalid", { fileId: file.id, reason: "thumb_not_image" });
}

export function isCommentThumbMime(mime: string): mime is CommentThumbMime {
  return (COMMENT_THUMB_MIMES as readonly string[]).includes(mime);
}

/** サムネイルの本文の検査: 形式（webp / jpeg）と大きさ（512 KB 以内、空は不可） */
export function validateCommentThumb(input: { mimeType: string; size: number }): CommentThumbMime {
  const mime = input.mimeType.toLowerCase().split(";")[0]!.trim();
  if (!isCommentThumbMime(mime)) invalid("thumb", "unsupported_type");
  if (!Number.isFinite(input.size) || input.size <= 0) invalid("thumb", "empty");
  if (input.size > COMMENT_THUMB_MAX_BYTES)
    invalid("thumb", "too_large", { max: COMMENT_THUMB_MAX_BYTES });
  return mime as CommentThumbMime;
}

/** サムネイルの保存を記録する（置き場は commentThumbObjectKey 固定） */
export function recordCommentThumb(
  file: CommentFile,
  meta: { size: number; mimeType: CommentThumbMime },
): CommentFile {
  if (file.keyPrefix === undefined)
    throw new DomainError("comment_file_invalid", { fileId: file.id, reason: "closed" });
  return {
    ...file,
    thumbObjectKey: commentThumbObjectKey(file.keyPrefix),
    thumbSize: meta.size,
    thumbMime: meta.mimeType,
  };
}

/** コメント・返信に付けられる添付か（本人が同じ制作物に上げた・検証済みの・まだどこにも付けていないもの） */
export function assertCommentFileAttachable(
  file: CommentFile | null,
  fileId: string,
  by: { uploaderId: UserId; workId: WorkId },
): CommentFile {
  if (
    !file ||
    file.uploaderId !== by.uploaderId ||
    file.workId !== by.workId ||
    file.status !== "verified" ||
    file.threadId !== undefined ||
    file.abandonedAt !== undefined ||
    file.removedAt !== undefined ||
    file.purgedAt !== undefined
  )
    throw new DomainError("comment_file_not_ready", {
      fileId,
      fileName: file?.fileName ?? null,
      status: file?.status ?? null,
    });
  return file;
}

/** コメント・返信に付ける（付けた後は付け替えない）。返信なら eventId も。版は付けた先のスレッドの版にそろえる */
export function attachCommentFile(
  file: CommentFile,
  to: { threadId: string; eventId?: string; revisionId: RevisionId },
): CommentFile {
  return {
    ...file,
    threadId: to.threadId,
    revisionId: to.revisionId,
    ...(to.eventId !== undefined ? { eventId: to.eventId } : {}),
  };
}

/** 放置された添付か（どこにも付けないまま期限を過ぎた） */
export function isCommentFileStale(file: CommentFile, now: Instant): boolean {
  return (
    file.threadId === undefined &&
    file.abandonedAt === undefined &&
    now - file.createdAt >= COMMENT_FILE_TTL_MS
  );
}

/** 付けたコメント・返信が削除されたので手放す（以後は誰も読めず、清掃が R2 から消す）。冪等 */
export function removeCommentFile(file: CommentFile, now: Instant): CommentFile {
  if (file.removedAt !== undefined) return file;
  return { ...file, removedAt: now };
}

// ---------------------------------------------------------------- 読み取り

/** 付けた先の状態（読み取りの判定に使う） */
export interface CommentFileHost {
  /** スレッドが削除されているか */
  threadDeleted: boolean;
  /** 返信に付けた添付で、その返信が削除されているか */
  replyDeleted: boolean;
}

/**
 * 読めるか。
 * - コメント・返信に付いた添付: その制作物を見られる人（canView）で、コメント（返信）が削除されていないとき。
 * - まだ付けていない添付: 上げた本人だけ（投稿前の確認用）。放置されたものは誰も読めない。
 * 実体が検証済みで、R2 から消されていないことも要る。
 */
export function canReadCommentFile(
  file: CommentFile,
  viewer: { userId: UserId; canView: boolean },
  host: CommentFileHost | null,
): boolean {
  if (!viewer.canView) return false;
  if (file.removedAt !== undefined || file.purgedAt !== undefined) return false;
  if (file.threadId === undefined) {
    return file.uploaderId === viewer.userId && file.abandonedAt === undefined;
  }
  if (host === null || host.threadDeleted) return false;
  if (file.eventId !== undefined && host.replyDeleted) return false;
  return true;
}

/** 読める状態にある実体か（検証済み・R2 から消されていない）。originals はそのまま、thumb はサムネイルがあるときだけ */
export function isCommentFileServable(file: CommentFile, variant: "original" | "thumb"): boolean {
  if (file.purgedAt !== undefined) return false;
  if (variant === "thumb") return file.thumbObjectKey !== undefined && file.thumbObjectKey !== "";
  return file.status === "verified";
}

/** 画面に渡す要約。検証済みで手放されていない添付だけ */
export function toCommentFileView(file: CommentFile): CommentFileView | null {
  if (file.status !== "verified" || file.removedAt !== undefined || file.purgedAt !== undefined)
    return null;
  return {
    id: file.id,
    name: file.fileName,
    mime: file.mimeType,
    size: file.size ?? file.declaredSize ?? 0,
    type: file.type,
    ...(file.width !== undefined && file.height !== undefined
      ? { width: file.width, height: file.height }
      : {}),
    hasThumb: file.thumbObjectKey !== undefined && file.thumbObjectKey !== "",
  };
}

/**
 * 清掃で R2 から消す実体のキー（原本とサムネイル）。
 * 画像は、サムネイルを置いたが記録が間に合わなかった場合に備え、名前空間の下の固定キーを常に含める（無ければ削除は何もしない）
 */
export function commentFileObjectKeys(file: CommentFile): string[] {
  const thumb =
    file.thumbObjectKey ??
    (file.type === "image" && file.keyPrefix !== undefined
      ? commentThumbObjectKey(file.keyPrefix)
      : "");
  return [file.objectKey, thumb].filter((k) => k !== "");
}
